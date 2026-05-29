const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { auth, JWT_SECRET } = require('../middleware/auth');
const { getUser, getUserByEmail, createUser, updateUser, updateMFA, saveOTP, clearOTP, uid } = require('../db');
const { generateOTP, hashOTP, verifyOTP } = require('../utils/otp');
const { sendEmail, otpEmailHTML } = require('../utils/mailer');
const { sendSMS } = require('../utils/sms');

const router  = express.Router();
const limiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });
const APP_NAME = process.env.APP_NAME || 'GigTrack Pro';

function makeFullToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}
function makePendingToken(userId) {
  return jwt.sign({ sub: userId, pending_mfa: true }, JWT_SECRET, { expiresIn: '10m' });
}
function verifyPendingToken(t) {
  try {
    const p = jwt.verify(t, JWT_SECRET);
    if (!p.pending_mfa) return null;
    return p.sub;
  } catch { return null; }
}

async function dispatchOTP(user, otp) {
  const method = user.mfa_method || 'email';
  let sent = false;
  if (method === 'sms' || method === 'both') {
    if (user.phone) sent = await sendSMS(user.phone, APP_NAME + ' login code: ' + otp + '. Expires in 10 minutes.');
  }
  if (method === 'email' || method === 'both' || !sent) {
    sent = await sendEmail({ to: user.email, subject: APP_NAME + ' - Your login code', html: otpEmailHTML(otp, APP_NAME) });
  }
  return sent;
}

// ─── SIGNUP ───────────────────────────────────────────
router.post('/signup', limiter, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim() || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await getUserByEmail(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const user = { id: uid(), name: name.trim(), email: email.toLowerCase(), password_hash: hash, role: 'driver' };
    await createUser(user);
    // No MFA on signup — first login will trigger it if configured
    res.json({ token: makeFullToken(user), role: user.role, name: user.name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── LOGIN (step 1) ───────────────────────────────────
router.post('/login', limiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const user = await getUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // If MFA not configured, log straight in
    if (!user.mfa_method || user.mfa_method === 'none') {
      return res.json({ token: makeFullToken(user), role: user.role, name: user.name });
    }

    // Generate and send OTP
    const otp      = generateOTP();
    const otpHash  = hashOTP(otp, user.id);
    const expires  = new Date(Date.now() + 10 * 60 * 1000);
    await saveOTP(user.id, otpHash, expires.toISOString());
    const sent = await dispatchOTP(user, otp);

    const method = user.mfa_method;
    const hint   = method === 'sms'  ? 'text to ' + (user.phone || '').slice(-4).padStart(10,'*')
                 : method === 'both' ? 'email and text'
                 : 'email to ' + user.email.replace(/(.{2}).+(@.+)/, '$1***$2');

    res.json({
      pending_mfa: true,
      pending_token: makePendingToken(user.id),
      method,
      hint: 'Code sent via ' + hint,
      dev_note: process.env.NODE_ENV !== 'production' && !sent ? '(email/SMS not configured — check server logs)' : undefined,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── VERIFY OTP (step 2) ──────────────────────────────
router.post('/verify-otp', limiter, async (req, res) => {
  const { pending_token, otp } = req.body;
  if (!pending_token || !otp) return res.status(400).json({ error: 'pending_token and otp required' });
  const userId = verifyPendingToken(pending_token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  try {
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.otp_hash || !user.otp_expires) return res.status(401).json({ error: 'No pending verification. Please log in again.' });
    if (new Date() > new Date(user.otp_expires)) return res.status(401).json({ error: 'Code expired. Please log in again.' });
    const valid = verifyOTP(otp.trim(), user.id, user.otp_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect code. Please try again.' });
    await clearOTP(user.id);
    res.json({ token: makeFullToken(user), role: user.role, name: user.name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── RESEND OTP ───────────────────────────────────────
router.post('/resend-otp', limiter, async (req, res) => {
  const { pending_token } = req.body;
  const userId = verifyPendingToken(pending_token);
  if (!userId) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  try {
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const otp     = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await saveOTP(user.id, hashOTP(otp, user.id), expires.toISOString());
    await dispatchOTP(user, otp);
    res.json({ ok: true, hint: 'New code sent' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── GET PROFILE ──────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role,
               plan: user.plan, state: user.state, state_tax_rate: user.state_tax_rate,
               phone: user.phone, mfa_method: user.mfa_method });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── UPDATE PROFILE ───────────────────────────────────
router.put('/me', auth, async (req, res) => {
  const { name, state, state_tax_rate } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    await updateUser({ id: req.userId, name: name.trim(), state: state||'', state_tax_rate: parseFloat(state_tax_rate)||0 });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── SETUP MFA ────────────────────────────────────────
router.put('/mfa', auth, async (req, res) => {
  const { phone, mfa_method } = req.body;
  const allowed = ['none','email','sms','both'];
  if (!allowed.includes(mfa_method)) return res.status(400).json({ error: 'mfa_method must be: none, email, sms, or both' });
  if ((mfa_method === 'sms' || mfa_method === 'both') && !phone?.trim())
    return res.status(400).json({ error: 'Phone number required for SMS verification' });
  try {
    await updateMFA(req.userId, phone?.trim()||'', mfa_method);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

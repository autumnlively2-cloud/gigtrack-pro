const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getUserByEmail, createUser, updateUser, getUser, uid } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
}

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await getUserByEmail(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: uid(), email: email.toLowerCase(), password_hash: hash, name, plan: 'free' };
    await createUser(user);
    const token = sign(user);
    res.json({ token, user: { id: user.id, name, email: user.email, plan: 'free' } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await getUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = sign(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password_hash, ...safe } = user;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/profile', require('../middleware/auth'), async (req, res) => {
  try {
    const { name, state, state_tax_rate, monthly_goal, mileage_rate, tax_year, business_name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    await updateUser({
      id: req.userId, name,
      state: state || '',
      state_tax_rate: parseFloat(state_tax_rate) || 4.0,
      monthly_goal:   parseFloat(monthly_goal)   || 5000,
      mileage_rate:   parseFloat(mileage_rate)   || 0.67,
      tax_year:       parseInt(tax_year)         || new Date().getFullYear(),
      business_name:  business_name || '',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

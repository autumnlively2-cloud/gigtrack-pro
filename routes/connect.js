const express = require('express');
const https   = require('https');
const crypto  = require('crypto');
const auth    = require('../middleware/auth');
const { requirePlan } = require('../middleware/auth');
const { getConnections, getConnection, upsertConnection, disconnectPlatform, uid } = require('../db');

const router = express.Router();

function createState(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', process.env.JWT_SECRET).update(b64).digest('hex');
  return b64 + '.' + sig;
}
function verifyState(state) {
  const dot = state.lastIndexOf('.');
  if (dot === -1) throw new Error('Malformed state');
  const b64 = state.slice(0, dot);
  const sig  = state.slice(dot + 1);
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(b64).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')))
    throw new Error('Invalid state signature');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
}

const PLATFORM_CONFIG = {
  uber: {
    name: 'Uber', authUrl: 'https://login.uber.com/oauth/v2/authorize', tokenUrl: 'https://login.uber.com/oauth/v2/token',
    scope: 'profile history', clientId: () => process.env.UBER_CLIENT_ID, clientSecret: () => process.env.UBER_CLIENT_SECRET, plans: ['pro','business'],
  },
  ubereats: {
    name: 'Uber Eats', authUrl: 'https://login.uber.com/oauth/v2/authorize', tokenUrl: 'https://login.uber.com/oauth/v2/token',
    scope: 'eats.deliveries', clientId: () => process.env.UBER_CLIENT_ID, clientSecret: () => process.env.UBER_CLIENT_SECRET, plans: ['pro','business'],
  },
  lyft: {
    name: 'Lyft', authUrl: 'https://api.lyft.com/oauth/authorize', tokenUrl: 'https://api.lyft.com/oauth/token',
    scope: 'rides.read', clientId: () => process.env.LYFT_CLIENT_ID, clientSecret: () => process.env.LYFT_CLIENT_SECRET, plans: ['pro','business'],
  },
};
const CSV_PLATFORMS = {
  doordash:   { name: 'DoorDash',    plans: ['free','pro','business'] },
  instacart:  { name: 'Instacart',   plans: ['pro','business'] },
  amazonflex: { name: 'Amazon Flex', plans: ['pro','business'] },
};

router.get('/', auth, async (req, res) => {
  try {
    const rows = await getConnections(req.userId);
    const map = {};
    rows.forEach(r => { map[r.platform] = r; });
    res.json(map);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:platform/start', auth, requirePlan('pro'), (req, res) => {
  const { platform } = req.params;
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) return res.status(404).json({ error: 'Platform not found or uses CSV import' });
  const clientId = cfg.clientId();
  if (!clientId || clientId.startsWith('your_')) return res.status(503).json({ error: cfg.name + ' OAuth not configured' });
  const appUrl = process.env.APP_URL || 'http://localhost:3001';
  const redirectUri = appUrl + '/api/connect/' + platform + '/callback';
  const state = createState({ userId: req.userId, platform });
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: cfg.scope, state });
  res.json({ url: cfg.authUrl + '?' + params });
});

router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query;
  const appUrl = process.env.APP_URL || 'http://localhost:3001';
  if (error) return res.redirect(appUrl + '/#connections?error=' + encodeURIComponent(error));
  if (!code || !state) return res.redirect(appUrl + '/#connections?error=missing_params');
  let userId, statePlatform;
  try {
    const decoded = verifyState(state);
    userId = decoded.userId; statePlatform = decoded.platform;
  } catch { return res.redirect(appUrl + '/#connections?error=invalid_state'); }
  if (statePlatform !== platform) return res.redirect(appUrl + '/#connections?error=state_mismatch');
  const cfg = PLATFORM_CONFIG[platform];
  const redirectUri = appUrl + '/api/connect/' + platform + '/callback';
  try {
    const tokenData = await exchangeCode(cfg, code, redirectUri);
    await upsertConnection({
      id: uid(), user_id: userId, platform,
      access_token: tokenData.access_token || '', refresh_token: tokenData.refresh_token || '',
      token_expires: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : '',
      connected: 1, total_earnings: 0, total_trips: 0, total_miles: 0,
      last_synced: new Date().toISOString(), status: 'connected',
    });
    res.redirect(appUrl + '/#connections?connected=' + platform);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(appUrl + '/#connections?error=' + encodeURIComponent(err.message));
  }
});

router.post('/:platform/disconnect', auth, async (req, res) => {
  try {
    await disconnectPlatform(req.userId, req.params.platform);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:platform/csv-connected', auth, async (req, res) => {
  const { platform } = req.params;
  if (!CSV_PLATFORMS[platform]) return res.status(404).json({ error: 'Platform not found' });
  try {
    const { total_earnings, total_trips } = req.body;
    await upsertConnection({
      id: uid(), user_id: req.userId, platform,
      access_token: '', refresh_token: '', token_expires: '',
      connected: 1, total_earnings: parseFloat(total_earnings) || 0,
      total_trips: parseInt(total_trips) || 0, total_miles: 0,
      last_synced: new Date().toISOString(), status: 'csv',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/uber/profile', auth, requirePlan('pro'), async (req, res) => {
  try {
    const conn = await getConnection(req.userId, 'uber') || await getConnection(req.userId, 'ubereats');
    if (!conn || !conn.connected || !conn.access_token) return res.status(401).json({ error: 'Uber not connected' });
    const profile = await uberRequest('/v1.2/me', conn.access_token);
    res.json(profile);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

function exchangeCode(cfg, code, redirectUri) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId(), client_secret: cfg.clientSecret() }).toString();
    const url = new URL(cfg.tokenUrl);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let data = '';
      response.on('data', c => data += c);
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error_description || json.error));
          else resolve(json);
        } catch { reject(new Error('Invalid token response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function uberRequest(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.uber.com', path, method: 'GET', headers: { Authorization: 'Bearer ' + token } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response')); } });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = router;

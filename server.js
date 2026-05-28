require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Stripe webhook needs raw body ───────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// ─── Middleware ───────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/income',  require('./routes/income'));
app.use('/api/expenses',require('./routes/expenses'));
app.use('/api/mileage', require('./routes/mileage'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/connect', require('./routes/connect'));

// ─── Summary / Dashboard ─────────────────────────
const auth = require('./middleware/auth');
const { getUser, getMonthlyBreakdown, getConnections } = require('./db');

app.get('/api/summary', auth, (req, res) => {
  const { db } = require('./db');
  const user = getUser.get(req.userId);

  const income   = db.prepare('SELECT COALESCE(SUM(gross+tips+bonuses),0) as total, COUNT(*) as cnt FROM income WHERE user_id=?').get(req.userId);
  const expenses = db.prepare('SELECT COALESCE(SUM(amount*business_pct/100),0) as total, COUNT(*) as cnt FROM expenses WHERE user_id=?').get(req.userId);
  const mileage  = db.prepare('SELECT COALESCE(SUM(MAX(0,end_odo-start_odo)),0) as total, COUNT(*) as cnt FROM mileage WHERE user_id=?').get(req.userId);
  const { inc, exp, mil, byPlat, byCat } = getMonthlyBreakdown(req.userId);
  const connections = getConnections.all(req.userId);

  // Include synced connection earnings in totals
  const connEarnings = connections.filter(c => c.connected).reduce((a,c) => a + (c.total_earnings||0), 0);
  const totalIncome  = income.total + connEarnings;
  const totalExp     = expenses.total;
  const mileRate     = user.mileage_rate || 0.67;
  const totalMiles   = mileage.total;
  const mileDed      = totalMiles * mileRate;
  const netProfit    = totalIncome - totalExp - mileDed;

  const seTax   = Math.max(0, netProfit * 0.9235 * 0.153);
  const fedTax  = Math.max(0, netProfit * 0.12);
  const stateTax = Math.max(0, netProfit * (user.state_tax_rate||0) / 100);
  const totalTax = seTax + fedTax + stateTax;

  res.json({
    totalIncome, totalExp, totalMiles, mileDed, netProfit,
    seTax, fedTax, stateTax, totalTax, quarterlyPayment: totalTax / 4,
    mileRate,
    incomeCount: income.cnt, expenseCount: expenses.cnt, mileageCount: mileage.cnt,
    monthly: { inc, exp, mil },
    byPlatform: byPlat,
    byCategory: byCat,
    connections: connections.reduce((m,c) => { m[c.platform]=c; return m; }, {}),
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan, monthly_goal: user.monthly_goal, tax_year: user.tax_year, state: user.state, state_tax_rate: user.state_tax_rate, mileage_rate: user.mileage_rate },
  });
});

// ─── Serve PWA ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 GigTrack Pro running on http://localhost:${PORT}`);
  console.log(`   Open on mobile: find your computer's IP + :${PORT}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? '✓ configured' : '✗ not configured (add to .env)'}`);
  console.log(`   Uber:   ${process.env.UBER_CLIENT_ID && !process.env.UBER_CLIENT_ID.startsWith('your_') ? '✓ configured' : '✗ not configured (add to .env)'}`);
  console.log(`   DB:     gigtrack.db\n`);
});

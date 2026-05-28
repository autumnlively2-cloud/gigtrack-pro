require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// Ensure upload directories exist
['uploads', 'uploads/receipts'].forEach(dir =>
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true })
);

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Stripe webhook needs raw body ───────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// ─── Middleware ───────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/income',   require('./routes/income'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/mileage',  require('./routes/mileage'));
app.use('/api/billing',  require('./routes/billing'));
app.use('/api/connect',  require('./routes/connect'));
app.use('/api/receipts', require('./routes/receipts'));

// ─── Summary / Dashboard ─────────────────────────
const auth = require('./middleware/auth');
const { getUser, getSummaryTotals, getMonthlyBreakdown, getConnections } = require('./db');

app.get('/api/summary', auth, async (req, res) => {
  try {
    const [user, totals, monthly, connections] = await Promise.all([
      getUser(req.userId),
      getSummaryTotals(req.userId),
      getMonthlyBreakdown(req.userId),
      getConnections(req.userId),
    ]);

    const { income, expenses, mileage } = totals;
    const mileRate  = user.mileage_rate || 0.67;
    const totalIncome = income.total;
    const totalExp    = expenses.total;
    const totalMiles  = mileage.total;
    const mileDed     = totalMiles * mileRate;
    const netProfit   = totalIncome - totalExp - mileDed;

    const seTax    = Math.max(0, netProfit * 0.9235 * 0.153);
    const fedTax   = Math.max(0, netProfit * 0.12);
    const stateTax = Math.max(0, netProfit * (user.state_tax_rate || 0) / 100);
    const totalTax = seTax + fedTax + stateTax;

    const { inc, exp, mil, byPlat, byCat } = monthly;

    res.json({
      totalIncome, totalExp, totalMiles, mileDed, netProfit,
      seTax, fedTax, stateTax, totalTax, quarterlyPayment: totalTax / 4,
      mileRate,
      incomeCount: income.cnt, expenseCount: expenses.cnt, mileageCount: mileage.cnt,
      monthly: { inc, exp, mil },
      byPlatform: byPlat,
      byCategory: byCat,
      connections: connections.reduce((m, c) => { m[c.platform] = c; return m; }, {}),
      user: {
        id: user.id, name: user.name, email: user.email, plan: user.plan,
        monthly_goal: user.monthly_goal, tax_year: user.tax_year,
        state: user.state, state_tax_rate: user.state_tax_rate, mileage_rate: user.mileage_rate,
      },
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Serve PWA ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start (wait for DB) ──────────────────────────
const { initDb } = require('./db');
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 GigTrack Pro running on http://localhost:${PORT}`);
      console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? '✓ configured' : '✗ not configured'}`);
      console.log(`   Uber:   ${process.env.UBER_CLIENT_ID && !process.env.UBER_CLIENT_ID.startsWith('your_') ? '✓ configured' : '✗ not configured'}`);
      console.log(`   DB:     PostgreSQL (${process.env.DATABASE_URL ? '✓ connected' : '✗ DATABASE_URL missing'})\n`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });

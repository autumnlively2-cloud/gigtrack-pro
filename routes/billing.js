const express = require('express');
const auth    = require('../middleware/auth');
const { getUser, setUserPlan, getUserByEmail } = require('../db');

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_YOUR')) {
    return null;
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PLANS = {
  pro:      { price: process.env.STRIPE_PRICE_PRO,      label: 'Pro',      amount: 999  },
  business: { price: process.env.STRIPE_PRICE_BUSINESS, label: 'Business', amount: 1999 },
};

// POST /api/billing/checkout  → create Stripe checkout session
router.post('/checkout', auth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to .env' });
  }

  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!PLANS[plan].price) return res.status(503).json({ error: `STRIPE_PRICE_${plan.toUpperCase()} not set in .env` });

  const user = getUser.get(req.userId);
  const appUrl = process.env.APP_URL || 'http://localhost:3001';

  try {
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PLANS[plan].price, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success&plan=${plan}`,
      cancel_url:  `${appUrl}/?checkout=cancel`,
      metadata: { userId: req.userId, plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/portal  → Stripe customer portal
router.post('/portal', auth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const user = getUser.get(req.userId);
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.APP_URL || 'http://localhost:3001'}/#account`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/status
router.get('/status', auth, (req, res) => {
  const user = getUser.get(req.userId);
  res.json({
    plan: user.plan,
    stripe_configured: !!getStripe(),
    has_billing: !!user.stripe_customer_id,
  });
});

// POST /api/billing/webhook  → Stripe webhook (raw body required)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, plan } = session.metadata || {};
    if (userId && plan) {
      setUserPlan.run({
        id: userId, plan,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
      });
      console.log(`✓ Upgraded user ${userId} to ${plan}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    // Downgrade to free — find user by stripe_customer_id
    const { db } = require('../db');
    db.prepare('UPDATE users SET plan=? WHERE stripe_customer_id=?').run('free', sub.customer);
  }

  res.json({ received: true });
});

module.exports = router;

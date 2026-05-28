const express = require('express');
const auth    = require('../middleware/auth');
const { getExpenses, createExpense, deleteExpense, uid } = require('../db');

const router = express.Router();

router.get('/', auth, (req, res) => {
  res.json(getExpenses.all(req.userId));
});

router.post('/', auth, (req, res) => {
  try {
    const { date, category, description, amount, business_pct, receipt_url } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: 'date, category, amount required' });
    const row = {
      id: uid(), user_id: req.userId,
      date, category, description: description || '',
      amount: parseFloat(amount) || 0,
      business_pct: parseFloat(business_pct) || 100,
      receipt_url: receipt_url || ''
    };
    createExpense.run(row);
    res.json({ ok: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, (req, res) => {
  deleteExpense.run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = router;

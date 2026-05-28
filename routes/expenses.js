const express = require('express');
const auth    = require('../middleware/auth');
const { getExpenses, createExpense, updateExpense, deleteExpense, uid } = require('../db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 500;
    const offset = parseInt(req.query.offset) || 0;
    res.json(await getExpenses(req.userId, limit, offset));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { date, category, description, amount, business_pct, receipt_url } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: 'date, category, amount required' });
    const row = {
      id: uid(), user_id: req.userId,
      date, category, description: description || '',
      amount: parseFloat(amount) || 0,
      business_pct: parseFloat(business_pct) || 100,
      receipt_url: receipt_url || '',
    };
    await createExpense(row);
    res.json({ ok: true, id: row.id });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { date, category, description, amount, business_pct, receipt_url } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: 'date, category, amount required' });
    const changed = await updateExpense({
      id: req.params.id, user_id: req.userId,
      date, category, description: description || '',
      amount: parseFloat(amount) || 0,
      business_pct: parseFloat(business_pct) || 100,
      receipt_url: receipt_url || '',
    });
    if (changed === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteExpense(req.params.id, req.userId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

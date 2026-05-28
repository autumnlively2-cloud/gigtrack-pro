const express = require('express');
const auth    = require('../middleware/auth');
const { getMileage, createMileage, updateMileage, deleteMileage, uid } = require('../db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 500;
    const offset = parseInt(req.query.offset) || 0;
    res.json(await getMileage(req.userId, limit, offset));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { platform, date, start_odo, end_odo, purpose } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const parsedStart = parseFloat(start_odo) || 0;
    const parsedEnd   = parseFloat(end_odo)   || 0;
    if (parsedEnd < parsedStart) return res.status(400).json({ error: 'end_odo must be >= start_odo' });
    const row = { id: uid(), user_id: req.userId, platform: platform || '', date, start_odo: parsedStart, end_odo: parsedEnd, purpose: purpose || '', source: 'manual' };
    await createMileage(row);
    res.json({ ok: true, id: row.id });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { platform, date, start_odo, end_odo, purpose } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const parsedStart = parseFloat(start_odo) || 0;
    const parsedEnd   = parseFloat(end_odo)   || 0;
    if (parsedEnd < parsedStart) return res.status(400).json({ error: 'end_odo must be >= start_odo' });
    const changed = await updateMileage({ id: req.params.id, user_id: req.userId, platform: platform || '', date, start_odo: parsedStart, end_odo: parsedEnd, purpose: purpose || '' });
    if (changed === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteMileage(req.params.id, req.userId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

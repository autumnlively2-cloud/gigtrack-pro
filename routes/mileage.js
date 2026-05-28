const express = require('express');
const auth    = require('../middleware/auth');
const { getMileage, createMileage, deleteMileage, uid } = require('../db');

const router = express.Router();

router.get('/', auth, (req, res) => {
  res.json(getMileage.all(req.userId));
});

router.post('/', auth, (req, res) => {
  try {
    const { platform, date, start_odo, end_odo, purpose } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const row = {
      id: uid(), user_id: req.userId,
      platform: platform || '',
      date, start_odo: parseFloat(start_odo) || 0,
      end_odo: parseFloat(end_odo) || 0,
      purpose: purpose || '',
      source: 'manual'
    };
    createMileage.run(row);
    res.json({ ok: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, (req, res) => {
  deleteMileage.run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = router;

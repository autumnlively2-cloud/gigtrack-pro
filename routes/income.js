const express = require('express');
const multer  = require('multer');
const path    = require('path');
const auth    = require('../middleware/auth');
const { getIncome, createIncome, deleteIncome, incomeExists, uid } = require('../db');
const parseDoorDash  = require('../parsers/doordash');
const parseInstacart = require('../parsers/instacart');
const parseUberEats  = require('../parsers/ubereats');
const parseAmazonFlex = require('../parsers/amazonflex');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads/') });

// GET /api/income
router.get('/', auth, (req, res) => {
  const rows = getIncome.all(req.userId);
  res.json(rows);
});

// POST /api/income  (manual entry)
router.post('/', auth, (req, res) => {
  try {
    const { platform, platform_key, date, orders, gross, tips, bonuses } = req.body;
    if (!date || !platform) return res.status(400).json({ error: 'date and platform required' });
    const row = {
      id: uid(), user_id: req.userId,
      platform, platform_key: platform_key || platform.toLowerCase().replace(/\s+/g,''),
      date, orders: parseInt(orders)||0,
      gross: parseFloat(gross)||0, tips: parseFloat(tips)||0, bonuses: parseFloat(bonuses)||0,
      source: 'manual', platform_ref: ''
    };
    createIncome.run(row);
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/income/:id
router.delete('/:id', auth, (req, res) => {
  deleteIncome.run(req.params.id, req.userId);
  res.json({ ok: true });
});

// POST /api/income/import/:platform  (CSV upload)
router.post('/import/:platform', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const parsers = { doordash: parseDoorDash, instacart: parseInstacart, ubereats: parseUberEats, amazonflex: parseAmazonFlex };
  const parser = parsers[req.params.platform];
  if (!parser) return res.status(400).json({ error: 'Unknown platform' });

  try {
    const rows = await parser(req.file.path);
    let imported = 0, dupes = 0;

    for (const row of rows) {
      if (row.platform_ref) {
        const exists = incomeExists.get(req.userId, row.platform_ref);
        if (exists) { dupes++; continue; }
      }
      createIncome.run({ ...row, id: uid(), user_id: req.userId, source: 'csv' });
      imported++;
    }

    // Clean up temp file
    require('fs').unlink(req.file.path, () => {});
    res.json({ ok: true, imported, dupes, total: rows.length });
  } catch (err) {
    console.error('CSV import error:', err);
    res.status(422).json({ error: 'Failed to parse CSV. Please check the file format.' });
  }
});

module.exports = router;

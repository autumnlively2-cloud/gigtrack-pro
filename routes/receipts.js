const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const auth    = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  dest: path.join(__dirname, '../uploads/receipts/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only image files are supported'));
  },
});

const CATEGORIES = [
  'Gas & Fuel', 'Vehicle Maintenance', 'Car Wash', 'Phone & Data',
  'Food & Drink', 'Parking & Tolls', 'Insurance', 'Equipment',
  'Software & Apps', 'Health', 'Clothing & Uniform', 'Other',
];

function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

router.post('/scan', auth, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  try {
    const anthropic = getAnthropic();
    if (!anthropic) {
      fs.unlink(filePath, () => {});
      return res.status(503).json({ error: 'Receipt scanning not configured. Add ANTHROPIC_API_KEY to enable.' });
    }

    const imageData = fs.readFileSync(filePath);
    const base64    = imageData.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `You are a receipt parser. Extract these fields from this receipt image and return ONLY valid JSON with no extra text:
{
  "date": "YYYY-MM-DD or null if unclear",
  "amount": numeric total amount as a number or null,
  "merchant": "store or vendor name or null",
  "description": "brief description of what was purchased",
  "category": one of exactly: ${CATEGORIES.map(c => `"${c}"`).join(', ')}
}
If a field cannot be determined, use null. For category, pick the closest match from the list. Today is ${new Date().toISOString().slice(0,10)}.`,
          },
        ],
      }],
    });

    fs.unlink(filePath, () => {});

    const raw = message.content[0]?.text?.trim() || '';
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(422).json({ error: 'Could not read receipt. Try a clearer photo.' });
    }

    // Sanitise
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      date:        parsed.date        || today,
      amount:      parsed.amount      != null ? Math.abs(Number(parsed.amount)) : null,
      merchant:    parsed.merchant    || '',
      description: parsed.description || parsed.merchant || '',
      category:    CATEGORIES.includes(parsed.category) ? parsed.category : 'Other',
    });

  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error('Receipt scan error:', err.message);
    res.status(500).json({ error: 'Scan failed. Please enter the expense manually.' });
  }
});

module.exports = router;

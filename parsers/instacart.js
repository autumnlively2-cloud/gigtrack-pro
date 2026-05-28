/**
 * Instacart CSV Parser
 *
 * From: Instacart Shopper app → Earnings → Export
 * Columns: Date, Batch Pay, Tip, Peak Boost, Other Pay, Total
 */
const fs = require('fs');
const { parse } = require('csv-parse/sync');

module.exports = async function parseInstacart(filePath) {
  const raw     = fs.readFileSync(filePath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  if (!records.length) throw new Error('CSV appears to be empty');

  return records.map(r => {
    const date = normalizeDate(r.Date || r.date || r['Completion Date'] || '');
    if (!date) return null;

    const gross   = pm(r['Batch Pay'] || r['Base Pay'] || r['batch_pay'] || r.Earnings || '0');
    const tips    = pm(r.Tip || r.Tips || r.tip || '0');
    const bonuses = pm(r['Peak Boost'] || r['Quality Bonus'] || r['Other Pay'] || r.bonus || '0');

    return {
      platform: 'Instacart', platform_key: 'instacart',
      date, orders: parseInt(r.Items || r['Number of Items'] || '0') || 0,
      gross, tips, bonuses,
      platform_ref: `ic_${date}_${(r['Order ID'] || r['Batch ID'] || '').slice(0, 20)}`,
    };
  }).filter(Boolean);
};

function pm(v) { return parseFloat((v||'0').toString().replace(/[$,\s]/g,''))||0; }

function normalizeDate(raw) {
  if (!raw) return '';
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return '';
}

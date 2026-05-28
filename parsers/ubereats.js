/**
 * Uber Eats CSV Parser
 * From: Uber Driver app → Earnings → Download CSV
 */
const fs = require('fs');
const { parse } = require('csv-parse/sync');

module.exports = async function parseUberEats(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  if (!records.length) throw new Error('CSV empty');

  return records.map(r => {
    const date = normalizeDate(r['Trip/Order Date'] || r.Date || r.date || '');
    if (!date) return null;
    const gross   = pm(r['Fare'] || r['Trip Earnings'] || r['Earnings'] || r['Base Fare'] || '0');
    const tips    = pm(r['Tips'] || r['Tip'] || '0');
    const bonuses = pm(r['Boost'] || r['Surge'] || r['Promotion'] || r['Quest Bonus'] || '0');
    return {
      platform: 'Uber Eats', platform_key: 'ubereats',
      date, orders: 1,
      gross, tips, bonuses,
      platform_ref: `ue_${r['Trip ID'] || r['Order ID'] || date}`,
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

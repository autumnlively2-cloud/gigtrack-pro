/**
 * Amazon Flex CSV Parser
 * From: Amazon Flex app → Earnings → Download
 */
const fs = require('fs');
const { parse } = require('csv-parse/sync');

module.exports = async function parseAmazonFlex(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  if (!records.length) throw new Error('CSV empty');

  return records.map(r => {
    const date = normalizeDate(r['Date'] || r['Service Date'] || r['Block Date'] || '');
    if (!date) return null;
    const gross = pm(r['Total'] || r['Block Pay'] || r['Earnings'] || r['Amount'] || '0');
    const tips  = pm(r['Tips'] || r['Tip'] || '0');
    return {
      platform: 'Amazon Flex', platform_key: 'amazonflex',
      date, orders: parseInt(r['Packages'] || r['Stops'] || '0') || 0,
      gross, tips, bonuses: 0,
      platform_ref: `af_${r['Block ID'] || r['Order ID'] || date}`,
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

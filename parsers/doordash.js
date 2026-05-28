/**
 * DoorDash CSV Parser
 *
 * Handles the Dasher earnings export from:
 * Dasher app → Earnings → (select week) → Share/Export
 *
 * Typical columns exported:
 *   Date, Type, Description, Amount
 *   — OR —
 *   Date, Earnings, Tips, Bonus, Total, Miles
 */
const fs   = require('fs');
const { parse } = require('csv-parse/sync');

module.exports = async function parseDoorDash(filePath) {
  const raw    = fs.readFileSync(filePath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  if (!records.length) throw new Error('CSV appears to be empty');

  const cols = Object.keys(records[0]).map(c => c.toLowerCase().trim());

  // ── Format A: transaction-level (Date, Type, Description, Amount) ──
  if (cols.includes('type') && cols.includes('amount')) {
    const grouped = {};
    for (const r of records) {
      const date = normalizeDate(r.Date || r.date || '');
      if (!date) continue;
      if (!grouped[date]) grouped[date] = { date, gross: 0, tips: 0, bonuses: 0, orders: 0, refs: [] };

      const amount = parseFloat((r.Amount || r.amount || '0').replace(/[$,]/g, '')) || 0;
      const type   = (r.Type || r.type || '').toLowerCase();

      if (type.includes('tip'))        grouped[date].tips    += amount;
      else if (type.includes('bonus') || type.includes('peak') || type.includes('challenge')) grouped[date].bonuses += amount;
      else if (type.includes('base') || type.includes('delivery') || type.includes('pay'))   { grouped[date].gross += amount; grouped[date].orders++; }
      else                             grouped[date].gross   += amount;

      const ref = r['Order #'] || r['order_id'] || r['Description'] || '';
      if (ref) grouped[date].refs.push(ref.slice(0, 40));
    }
    return Object.values(grouped).map(d => ({
      platform: 'DoorDash', platform_key: 'doordash',
      date: d.date, orders: d.orders,
      gross: round(d.gross), tips: round(d.tips), bonuses: round(d.bonuses),
      platform_ref: `dd_${d.date}_${d.refs.join('-').slice(0, 30)}`,
    }));
  }

  // ── Format B: summary-level (Date, Earnings, Tips, Bonus, Total, Miles) ──
  if (cols.includes('earnings') || cols.includes('base pay')) {
    return records
      .map(r => {
        const date = normalizeDate(r.Date || r.date || '');
        if (!date) return null;
        const gross   = parseMoney(r.Earnings || r['Base Pay'] || r.earnings || '0');
        const tips    = parseMoney(r.Tips || r.tips || '0');
        const bonuses = parseMoney(r.Bonus || r.Bonuses || r.bonus || r['Peak Pay'] || '0');
        return {
          platform: 'DoorDash', platform_key: 'doordash',
          date, orders: parseInt(r.Orders || r['Deliveries'] || '0') || 0,
          gross, tips, bonuses,
          platform_ref: `dd_${date}`,
        };
      })
      .filter(Boolean);
  }

  // ── Format C: weekly pay summary ──
  return records
    .map(r => {
      const date = normalizeDate(Object.values(r)[0] || '');
      if (!date) return null;
      const vals = Object.values(r).map(v => parseMoney(v));
      const gross = vals[1] || 0;
      const tips  = vals[2] || 0;
      return { platform: 'DoorDash', platform_key: 'doordash', date, orders: 0, gross, tips, bonuses: 0, platform_ref: `dd_${date}` };
    })
    .filter(Boolean);
};

function parseMoney(v) {
  return parseFloat((v || '0').toString().replace(/[$,\s]/g, '')) || 0;
}

function round(n) { return Math.round(n * 100) / 100; }

function normalizeDate(raw) {
  if (!raw) return '';
  // Try ISO
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // MM/DD/YYYY or M/D/YYYY
  m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  // Mon DD, YYYY
  m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const mo = months[m[1].toLowerCase().slice(0,3)];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2,'0')}`;
  }
  return '';
}

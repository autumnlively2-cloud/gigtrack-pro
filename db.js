require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function uid() {
  return crypto.randomUUID();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                     TEXT PRIMARY KEY,
      email                  TEXT UNIQUE NOT NULL,
      password_hash          TEXT NOT NULL,
      name                   TEXT NOT NULL,
      plan                   TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      state                  TEXT DEFAULT '',
      state_tax_rate         DOUBLE PRECISION DEFAULT 4.0,
      monthly_goal           DOUBLE PRECISION DEFAULT 5000,
      mileage_rate           DOUBLE PRECISION DEFAULT 0.670,
      tax_year               INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
      business_name          TEXT DEFAULT '',
      created_at             TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS income (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL,
      platform_key TEXT NOT NULL DEFAULT '',
      date         TEXT NOT NULL,
      orders       INTEGER DEFAULT 0,
      gross        DOUBLE PRECISION DEFAULT 0,
      tips         DOUBLE PRECISION DEFAULT 0,
      bonuses      DOUBLE PRECISION DEFAULT 0,
      source       TEXT DEFAULT 'manual',
      platform_ref TEXT DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date         TEXT NOT NULL,
      category     TEXT NOT NULL,
      description  TEXT DEFAULT '',
      amount       DOUBLE PRECISION NOT NULL,
      business_pct DOUBLE PRECISION DEFAULT 100,
      receipt_url  TEXT DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS mileage (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform   TEXT DEFAULT '',
      date       TEXT NOT NULL,
      start_odo  DOUBLE PRECISION DEFAULT 0,
      end_odo    DOUBLE PRECISION DEFAULT 0,
      purpose    TEXT DEFAULT '',
      source     TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS platform_connections (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform       TEXT NOT NULL,
      access_token   TEXT DEFAULT '',
      refresh_token  TEXT DEFAULT '',
      token_expires  TEXT DEFAULT '',
      connected      INTEGER DEFAULT 0,
      total_earnings DOUBLE PRECISION DEFAULT 0,
      total_trips    INTEGER DEFAULT 0,
      total_miles    DOUBLE PRECISION DEFAULT 0,
      last_synced    TEXT DEFAULT '',
      status         TEXT DEFAULT 'disconnected',
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_income_user   ON income(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_mileage_user  ON mileage(user_id, date);
  `);
}

async function getUser(id) {
  const res = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  return res.rows[0] || null;
}
async function getUserByEmail(email) {
  const res = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return res.rows[0] || null;
}
async function createUser({ id, email, password_hash, name, plan }) {
  await pool.query(
    'INSERT INTO users (id, email, password_hash, name, plan) VALUES ($1,$2,$3,$4,$5)',
    [id, email, password_hash, name, plan]
  );
}
async function updateUser({ id, name, state, state_tax_rate, monthly_goal, mileage_rate, tax_year, business_name }) {
  await pool.query(
    `UPDATE users SET name=$1, state=$2, state_tax_rate=$3, monthly_goal=$4,
       mileage_rate=$5, tax_year=$6, business_name=$7 WHERE id=$8`,
    [name, state, state_tax_rate, monthly_goal, mileage_rate, tax_year, business_name, id]
  );
}
async function setUserPlan({ id, plan, stripe_customer_id, stripe_subscription_id }) {
  await pool.query(
    'UPDATE users SET plan=$1, stripe_customer_id=$2, stripe_subscription_id=$3 WHERE id=$4',
    [plan, stripe_customer_id, stripe_subscription_id, id]
  );
}
async function setUserPlanByCustomerId(stripeCustomerId, plan) {
  await pool.query('UPDATE users SET plan=$1 WHERE stripe_customer_id=$2', [plan, stripeCustomerId]);
}

async function getIncome(userId, limit = 500, offset = 0) {
  const res = await pool.query(
    `SELECT *, (gross + tips + bonuses) AS total FROM income WHERE user_id=$1
     ORDER BY date DESC, created_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(limit, 1000), offset]
  );
  return res.rows;
}
async function getIncomeById(id, userId) {
  const res = await pool.query(
    'SELECT *, (gross + tips + bonuses) AS total FROM income WHERE id=$1 AND user_id=$2',
    [id, userId]
  );
  return res.rows[0] || null;
}
async function createIncome({ id, user_id, platform, platform_key, date, orders, gross, tips, bonuses, source, platform_ref }) {
  await pool.query(
    `INSERT INTO income (id, user_id, platform, platform_key, date, orders, gross, tips, bonuses, source, platform_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, user_id, platform, platform_key, date, orders, gross, tips, bonuses, source, platform_ref]
  );
}
async function updateIncome({ id, user_id, platform, platform_key, date, orders, gross, tips, bonuses }) {
  const res = await pool.query(
    `UPDATE income SET platform=$1, platform_key=$2, date=$3, orders=$4, gross=$5, tips=$6, bonuses=$7
     WHERE id=$8 AND user_id=$9`,
    [platform, platform_key, date, orders, gross, tips, bonuses, id, user_id]
  );
  return res.rowCount;
}
async function deleteIncome(id, userId) {
  await pool.query('DELETE FROM income WHERE id=$1 AND user_id=$2', [id, userId]);
}
async function incomeExists(userId, platformRef) {
  const res = await pool.query(
    `SELECT id FROM income WHERE user_id=$1 AND platform_ref=$2 AND platform_ref != ''`,
    [userId, platformRef]
  );
  return res.rows[0] || null;
}

async function getExpenses(userId, limit = 500, offset = 0) {
  const res = await pool.query(
    `SELECT *, (amount * business_pct / 100.0) AS deductible FROM expenses WHERE user_id=$1
     ORDER BY date DESC, created_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(limit, 1000), offset]
  );
  return res.rows;
}
async function createExpense({ id, user_id, date, category, description, amount, business_pct, receipt_url }) {
  await pool.query(
    `INSERT INTO expenses (id, user_id, date, category, description, amount, business_pct, receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, user_id, date, category, description, amount, business_pct, receipt_url]
  );
}
async function updateExpense({ id, user_id, date, category, description, amount, business_pct, receipt_url }) {
  const res = await pool.query(
    `UPDATE expenses SET date=$1, category=$2, description=$3, amount=$4, business_pct=$5, receipt_url=$6
     WHERE id=$7 AND user_id=$8`,
    [date, category, description, amount, business_pct, receipt_url, id, user_id]
  );
  return res.rowCount;
}
async function deleteExpense(id, userId) {
  await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [id, userId]);
}

async function getMileage(userId, limit = 500, offset = 0) {
  const res = await pool.query(
    `SELECT *, GREATEST(0, end_odo - start_odo) AS miles FROM mileage WHERE user_id=$1
     ORDER BY date DESC, created_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(limit, 1000), offset]
  );
  return res.rows;
}
async function createMileage({ id, user_id, platform, date, start_odo, end_odo, purpose, source }) {
  await pool.query(
    `INSERT INTO mileage (id, user_id, platform, date, start_odo, end_odo, purpose, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, user_id, platform, date, start_odo, end_odo, purpose, source]
  );
}
async function updateMileage({ id, user_id, platform, date, start_odo, end_odo, purpose }) {
  const res = await pool.query(
    `UPDATE mileage SET platform=$1, date=$2, start_odo=$3, end_odo=$4, purpose=$5
     WHERE id=$6 AND user_id=$7`,
    [platform, date, start_odo, end_odo, purpose, id, user_id]
  );
  return res.rowCount;
}
async function deleteMileage(id, userId) {
  await pool.query('DELETE FROM mileage WHERE id=$1 AND user_id=$2', [id, userId]);
}

async function getConnections(userId) {
  const res = await pool.query('SELECT * FROM platform_connections WHERE user_id=$1', [userId]);
  return res.rows;
}
async function getConnection(userId, platform) {
  const res = await pool.query(
    'SELECT * FROM platform_connections WHERE user_id=$1 AND platform=$2', [userId, platform]
  );
  return res.rows[0] || null;
}
async function upsertConnection({ id, user_id, platform, access_token, refresh_token, token_expires, connected, total_earnings, total_trips, total_miles, last_synced, status }) {
  await pool.query(
    `INSERT INTO platform_connections
       (id, user_id, platform, access_token, refresh_token, token_expires, connected, total_earnings, total_trips, total_miles, last_synced, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, platform) DO UPDATE SET
       access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
       token_expires=EXCLUDED.token_expires, connected=EXCLUDED.connected,
       total_earnings=EXCLUDED.total_earnings, total_trips=EXCLUDED.total_trips,
       total_miles=EXCLUDED.total_miles, last_synced=EXCLUDED.last_synced, status=EXCLUDED.status`,
    [id, user_id, platform, access_token, refresh_token, token_expires, connected, total_earnings, total_trips, total_miles, last_synced, status]
  );
}
async function disconnectPlatform(userId, platform) {
  await pool.query(
    `UPDATE platform_connections SET connected=0, access_token='', refresh_token='', status='disconnected'
     WHERE user_id=$1 AND platform=$2`, [userId, platform]
  );
}

async function getSummaryTotals(userId) {
  const [income, expenses, mileage] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(gross+tips+bonuses),0) AS total, COUNT(*) AS cnt FROM income WHERE user_id=$1`, [userId]),
    pool.query(`SELECT COALESCE(SUM(amount*business_pct/100),0) AS total, COUNT(*) AS cnt FROM expenses WHERE user_id=$1`, [userId]),
    pool.query(`SELECT COALESCE(SUM(GREATEST(0,end_odo-start_odo)),0) AS total, COUNT(*) AS cnt FROM mileage WHERE user_id=$1`, [userId]),
  ]);
  return {
    income:   { total: parseFloat(income.rows[0].total),   cnt: parseInt(income.rows[0].cnt) },
    expenses: { total: parseFloat(expenses.rows[0].total), cnt: parseInt(expenses.rows[0].cnt) },
    mileage:  { total: parseFloat(mileage.rows[0].total),  cnt: parseInt(mileage.rows[0].cnt) },
  };
}
async function getMonthlyBreakdown(userId) {
  const [inc, exp, mil, byPlat, byCat] = await Promise.all([
    pool.query(`SELECT TO_CHAR(date::date,'MM') AS m, SUM(gross+tips+bonuses) AS v FROM income WHERE user_id=$1 GROUP BY m`, [userId]),
    pool.query(`SELECT TO_CHAR(date::date,'MM') AS m, SUM(amount*business_pct/100) AS v FROM expenses WHERE user_id=$1 GROUP BY m`, [userId]),
    pool.query(`SELECT TO_CHAR(date::date,'MM') AS m, SUM(GREATEST(0,end_odo-start_odo)) AS v FROM mileage WHERE user_id=$1 GROUP BY m`, [userId]),
    pool.query(`SELECT platform_key, SUM(gross+tips+bonuses) AS v FROM income WHERE user_id=$1 GROUP BY platform_key`, [userId]),
    pool.query(`SELECT category, SUM(amount*business_pct/100) AS v FROM expenses WHERE user_id=$1 GROUP BY category`, [userId]),
  ]);
  return { inc: inc.rows, exp: exp.rows, mil: mil.rows, byPlat: byPlat.rows, byCat: byCat.rows };
}

module.exports = {
  pool, uid, initDb,
  getUser, getUserByEmail, createUser, updateUser, setUserPlan, setUserPlanByCustomerId,
  getIncome, getIncomeById, createIncome, updateIncome, deleteIncome, incomeExists,
  getExpenses, createExpense, updateExpense, deleteExpense,
  getMileage, createMileage, updateMileage, deleteMileage,
  getConnections, getConnection, upsertConnection, disconnectPlatform,
  getSummaryTotals, getMonthlyBreakdown,
};

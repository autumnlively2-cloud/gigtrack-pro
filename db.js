const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gigtrack.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────
//  SCHEMA
// ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    state         TEXT DEFAULT '',
    state_tax_rate REAL DEFAULT 4.0,
    monthly_goal  REAL DEFAULT 5000,
    mileage_rate  REAL DEFAULT 0.670,
    tax_year      INTEGER DEFAULT (strftime('%Y', 'now')),
    business_name TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL,
    platform_key TEXT NOT NULL DEFAULT '',
    date         TEXT NOT NULL,
    orders       INTEGER DEFAULT 0,
    gross        REAL DEFAULT 0,
    tips         REAL DEFAULT 0,
    bonuses      REAL DEFAULT 0,
    total        REAL GENERATED ALWAYS AS (gross + tips + bonuses) VIRTUAL,
    source       TEXT DEFAULT 'manual',
    platform_ref TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    category     TEXT NOT NULL,
    description  TEXT DEFAULT '',
    amount       REAL NOT NULL,
    business_pct REAL DEFAULT 100,
    deductible   REAL GENERATED ALWAYS AS (amount * business_pct / 100) VIRTUAL,
    receipt_url  TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mileage (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT DEFAULT '',
    date         TEXT NOT NULL,
    start_odo    REAL DEFAULT 0,
    end_odo      REAL DEFAULT 0,
    miles        REAL GENERATED ALWAYS AS (MAX(0, end_odo - start_odo)) VIRTUAL,
    purpose      TEXT DEFAULT '',
    source       TEXT DEFAULT 'manual',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS platform_connections (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    access_token    TEXT DEFAULT '',
    refresh_token   TEXT DEFAULT '',
    token_expires   TEXT DEFAULT '',
    connected       INTEGER DEFAULT 0,
    total_earnings  REAL DEFAULT 0,
    total_trips     INTEGER DEFAULT 0,
    total_miles     REAL DEFAULT 0,
    last_synced     TEXT DEFAULT '',
    status          TEXT DEFAULT 'disconnected',
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, platform)
  );

  CREATE INDEX IF NOT EXISTS idx_income_user   ON income(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_mileage_user  ON mileage(user_id, date);
`);

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// User
const getUser    = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const createUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, name, plan)
  VALUES (@id, @email, @password_hash, @name, @plan)
`);
const updateUser = db.prepare(`
  UPDATE users SET name=@name, state=@state, state_tax_rate=@state_tax_rate,
    monthly_goal=@monthly_goal, mileage_rate=@mileage_rate, tax_year=@tax_year,
    business_name=@business_name
  WHERE id=@id
`);
const setUserPlan = db.prepare(`
  UPDATE users SET plan=@plan, stripe_customer_id=@stripe_customer_id,
    stripe_subscription_id=@stripe_subscription_id
  WHERE id=@id
`);

// Income
const getIncome    = db.prepare('SELECT * FROM income WHERE user_id=? ORDER BY date DESC, created_at DESC');
const getIncomeById = db.prepare('SELECT * FROM income WHERE id=? AND user_id=?');
const createIncome = db.prepare(`
  INSERT INTO income (id, user_id, platform, platform_key, date, orders, gross, tips, bonuses, source, platform_ref)
  VALUES (@id, @user_id, @platform, @platform_key, @date, @orders, @gross, @tips, @bonuses, @source, @platform_ref)
`);
const deleteIncome = db.prepare('DELETE FROM income WHERE id=? AND user_id=?');
const incomeExists = db.prepare('SELECT id FROM income WHERE user_id=? AND platform_ref=? AND platform_ref != ""');

// Expenses
const getExpenses    = db.prepare('SELECT * FROM expenses WHERE user_id=? ORDER BY date DESC, created_at DESC');
const createExpense  = db.prepare(`
  INSERT INTO expenses (id, user_id, date, category, description, amount, business_pct, receipt_url)
  VALUES (@id, @user_id, @date, @category, @description, @amount, @business_pct, @receipt_url)
`);
const deleteExpense  = db.prepare('DELETE FROM expenses WHERE id=? AND user_id=?');

// Mileage
const getMileage     = db.prepare('SELECT * FROM mileage WHERE user_id=? ORDER BY date DESC, created_at DESC');
const createMileage  = db.prepare(`
  INSERT INTO mileage (id, user_id, platform, date, start_odo, end_odo, purpose, source)
  VALUES (@id, @user_id, @platform, @date, @start_odo, @end_odo, @purpose, @source)
`);
const deleteMileage  = db.prepare('DELETE FROM mileage WHERE id=? AND user_id=?');

// Connections
const getConnections    = db.prepare('SELECT * FROM platform_connections WHERE user_id=?');
const getConnection     = db.prepare('SELECT * FROM platform_connections WHERE user_id=? AND platform=?');
const upsertConnection  = db.prepare(`
  INSERT INTO platform_connections (id, user_id, platform, access_token, refresh_token, token_expires, connected, total_earnings, total_trips, total_miles, last_synced, status)
  VALUES (@id, @user_id, @platform, @access_token, @refresh_token, @token_expires, @connected, @total_earnings, @total_trips, @total_miles, @last_synced, @status)
  ON CONFLICT(user_id, platform) DO UPDATE SET
    access_token=@access_token, refresh_token=@refresh_token, token_expires=@token_expires,
    connected=@connected, total_earnings=@total_earnings, total_trips=@total_trips,
    total_miles=@total_miles, last_synced=@last_synced, status=@status
`);
const disconnectPlatform = db.prepare(`
  UPDATE platform_connections SET connected=0, access_token='', refresh_token='', status='disconnected'
  WHERE user_id=? AND platform=?
`);

// Summary (aggregates)
function getSummary(userId) {
  const income   = db.prepare('SELECT SUM(gross+tips+bonuses) as total, COUNT(*) as cnt FROM income WHERE user_id=?').get(userId);
  const expenses = db.prepare('SELECT SUM(amount*business_pct/100) as total, COUNT(*) as cnt FROM expenses WHERE user_id=?').get(userId);
  const mileage  = db.prepare('SELECT SUM(MAX(0,end_odo-start_odo)) as total, COUNT(*) as cnt FROM mileage WHERE user_id=?').get(userId);
  const monthly  = db.prepare(`
    SELECT strftime('%m', date) as month,
      SUM(gross+tips+bonuses) as income,
      0 as expenses,
      0 as miles
    FROM income WHERE user_id=? GROUP BY month
  `).all(userId);
  return { income, expenses, mileage, monthly };
}

function getMonthlyBreakdown(userId) {
  const inc = db.prepare(`SELECT strftime('%m', date) as m, SUM(gross+tips+bonuses) as v FROM income WHERE user_id=? GROUP BY m`).all(userId);
  const exp = db.prepare(`SELECT strftime('%m', date) as m, SUM(amount*business_pct/100) as v FROM expenses WHERE user_id=? GROUP BY m`).all(userId);
  const mil = db.prepare(`SELECT strftime('%m', date) as m, SUM(MAX(0,end_odo-start_odo)) as v FROM mileage WHERE user_id=? GROUP BY m`).all(userId);
  const byPlat = db.prepare(`SELECT platform_key, SUM(gross+tips+bonuses) as v FROM income WHERE user_id=? GROUP BY platform_key`).all(userId);
  const byCat  = db.prepare(`SELECT category, SUM(amount*business_pct/100) as v FROM expenses WHERE user_id=? GROUP BY category`).all(userId);
  return { inc, exp, mil, byPlat, byCat };
}

module.exports = {
  db, uid,
  getUser, getUserByEmail, createUser, updateUser, setUserPlan,
  getIncome, getIncomeById, createIncome, deleteIncome, incomeExists,
  getExpenses, createExpense, deleteExpense,
  getMileage, createMileage, deleteMileage,
  getConnections, getConnection, upsertConnection, disconnectPlatform,
  getSummary, getMonthlyBreakdown,
};

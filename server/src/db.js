/**
 * SQLite 存储层：节点 / 指标 / 动作 / 告警 / 令牌 / 运维人员 / 会话 / 审计 / 配置
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'monitor.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT,
  label TEXT,
  note TEXT,
  os TEXT,
  arch TEXT,
  agent_version TEXT,
  ip TEXT,
  token_hash TEXT,
  status TEXT DEFAULT 'online',
  last_seen_at INTEGER,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  cpu REAL,
  mem_pct REAL,
  mem_used_mb INTEGER,
  mem_total_mb INTEGER,
  load1 REAL,
  disk_pct REAL,
  net_rx_rate INTEGER,
  net_tx_rate INTEGER,
  uptime_sec INTEGER,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_server_ts ON metrics(server_id, ts DESC);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  params TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  requested_by TEXT,
  approved_by TEXT,
  created_at INTEGER,
  approved_at INTEGER,
  finished_at INTEGER,
  output TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_server ON actions(server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  rule TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'warn',
  message TEXT,
  value TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER,
  resolved_at INTEGER,
  notified INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS install_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_server_id INTEGER,
  created_by TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  ip TEXT,
  ua TEXT,
  created_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER
);
`;

db.exec(SCHEMA);

/* ---------------- 默认配置 ---------------- */

const DEFAULT_SETTINGS = {
    'alert.cpuPct': '85',
    'alert.memPct': '90',
    'alert.diskPct': '85',
    'alert.loadPerCore': '2.5',
    'alert.offlineSeconds': '90',
    'alert.serviceFailed': '1',
    'alert.cooldownSeconds': '600',
    'metric.retentionDays': '30',
    'metric.reportIntervalMs': '10000',
    'smtp.host': process.env.SMTP_HOST || '',
    'smtp.port': process.env.SMTP_PORT || '465',
    'smtp.user': process.env.SMTP_USER || '',
    'smtp.pass': process.env.SMTP_PASS || '',
    'notify.emails': process.env.NOTIFY_EMAILS || ''
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
);

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!getSettingStmt.get(k)) setSettingStmt.run(k, v, Date.now());
}

function getSetting(key, fallback = '') {
    const row = getSettingStmt.get(key);
    return row ? row.value : fallback;
}

function getSettings(prefix = '') {
    const rows = prefix
        ? db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(prefix + '%')
        : db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
}

function setSetting(key, value) {
    setSettingStmt.run(key, String(value), Date.now());
}

module.exports = { db, DB_FILE, getSetting, getSettings, setSetting, DEFAULT_SETTINGS };

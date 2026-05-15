/**
 * lib/database.js — Wrapper SQLite (better-sqlite3)
 *
 * Tabel:
 *  - users   (jid, name, exp, level, money, premium, banned, created_at)
 *  - groups  (jid, name, welcome, antilink, banned, created_at)
 *  - settings(key, value)
 */
const path = require('path');
const fs   = require('fs');

let SQLite;
try {
  SQLite = require('better-sqlite3');
} catch (e) {
  console.error('[database] better-sqlite3 belum terpasang. Jalankan: npm install');
  throw e;
}

const { databaseFile } = require('../config');

class Database {
  constructor(file = databaseFile) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new SQLite(file);
    this.db.pragma('journal_mode = WAL');
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        jid       TEXT PRIMARY KEY,
        name      TEXT,
        exp       INTEGER DEFAULT 0,
        level     INTEGER DEFAULT 0,
        money     INTEGER DEFAULT 0,
        premium   INTEGER DEFAULT 0,
        banned    INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS groups (
        jid       TEXT PRIMARY KEY,
        name      TEXT,
        welcome   INTEGER DEFAULT 0,
        antilink  INTEGER DEFAULT 0,
        banned    INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  // ===== USERS =====
  ensureUser(jid, name = '') {
    const row = this.db.prepare('SELECT jid FROM users WHERE jid = ?').get(jid);
    if (!row) {
      this.db.prepare('INSERT INTO users (jid, name) VALUES (?, ?)').run(jid, name || '');
    } else if (name) {
      this.db.prepare('UPDATE users SET name = ? WHERE jid = ?').run(name, jid);
    }
  }
  getUser(jid)               { return this.db.prepare('SELECT * FROM users WHERE jid = ?').get(jid); }
  setUser(jid, field, value) { return this.db.prepare(`UPDATE users SET ${field} = ? WHERE jid = ?`).run(value, jid); }
  addExp(jid, amount = 10)   {
    this.ensureUser(jid);
    this.db.prepare('UPDATE users SET exp = exp + ? WHERE jid = ?').run(amount, jid);
  }
  addMoney(jid, amount)      {
    this.ensureUser(jid);
    this.db.prepare('UPDATE users SET money = money + ? WHERE jid = ?').run(amount, jid);
  }
  isPremium(jid)             { return !!this.getUser(jid)?.premium; }
  isBanned(jid)              { return !!this.getUser(jid)?.banned; }

  // ===== GROUPS =====
  ensureGroup(jid, name = '') {
    const row = this.db.prepare('SELECT jid FROM groups WHERE jid = ?').get(jid);
    if (!row) {
      this.db.prepare('INSERT INTO groups (jid, name) VALUES (?, ?)').run(jid, name || '');
    } else if (name) {
      this.db.prepare('UPDATE groups SET name = ? WHERE jid = ?').run(name, jid);
    }
  }
  getGroup(jid)               { return this.db.prepare('SELECT * FROM groups WHERE jid = ?').get(jid); }
  setGroup(jid, field, value) { return this.db.prepare(`UPDATE groups SET ${field} = ? WHERE jid = ?`).run(value, jid); }

  // ===== SETTINGS =====
  setSetting(key, value)      {
    this.db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  }
  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  // ===== STATS =====
  stats() {
    const u = this.db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const g = this.db.prepare('SELECT COUNT(*) as c FROM groups').get().c;
    return { users: u, groups: g };
  }

  close() { this.db.close(); }
}

module.exports = Database;

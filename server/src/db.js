import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const DATA_DIR = path.resolve('data');
const DOCS_DB_PATH = path.join(DATA_DIR, 'oa_docs.db');
const FAQ_DB_PATH = path.join(DATA_DIR, 'oa_faq.db');

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function openDb(dbPath) {
  ensureDataDir();
  return new sqlite3.Database(dbPath);
}

export function openDocsDb() {
  return openDb(DOCS_DB_PATH);
}

export function openFaqDb() {
  return openDb(FAQ_DB_PATH);
}

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export async function initDocsDb(db) {
  await run(db, 'PRAGMA journal_mode = DELETE');
  await run(db, 'PRAGMA synchronous = FULL');
  await run(db, 'PRAGMA temp_store = MEMORY');

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      content TEXT,
      updated_at TEXT
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER,
      url TEXT,
      title TEXT,
      chunk TEXT,
      tokens INTEGER,
      FOREIGN KEY (doc_id) REFERENCES docs(id)
    )`
  );

  await run(
    db,
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk,
      url,
      title,
      content='chunks',
      content_rowid='id'
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )`
  );
}

export async function initFaqDb(db) {
  await run(db, 'PRAGMA journal_mode = WAL');
  await run(db, 'PRAGMA synchronous = NORMAL');
  await run(db, 'PRAGMA temp_store = MEMORY');

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT,
      answer TEXT,
      enabled INTEGER DEFAULT 1,
      updated_at TEXT
    )`
  );

  await run(
    db,
    `CREATE VIRTUAL TABLE IF NOT EXISTS admin_qa_fts USING fts5(
      question,
      answer,
      content='admin_qa',
      content_rowid='id'
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT,
      answer TEXT,
      sources TEXT,
      created_at TEXT
    )`
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at)`
  );
}

export async function rebuildDocsFts(db) {
  await run(db, `DELETE FROM chunks_fts`);
  await run(db, `INSERT INTO chunks_fts(rowid, chunk, url, title)
                SELECT id, chunk, url, title FROM chunks`);
}

export async function rebuildFaqFts(db) {
  await run(db, `DELETE FROM admin_qa_fts`);
  await run(db, `INSERT INTO admin_qa_fts(rowid, question, answer)
                SELECT id, question, answer FROM admin_qa WHERE enabled = 1`);
}

export async function setMeta(db, key, value) {
  await run(
    db,
    `INSERT INTO meta(key, value)
     VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function getMeta(db, key) {
  return get(db, 'SELECT value FROM meta WHERE key = ?', [key]);
}

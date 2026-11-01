import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
process.umask(0o077);
export const DATA = process.env.TOKIFY_DATA || path.join(ROOT, 'data');
export const DIRS = {
  audio: path.join(DATA, 'audio'),
  covers: path.join(DATA, 'covers'),
  custom: path.join(DATA, 'custom-covers'),
  tmp: path.join(DATA, 'tmp'),
  uploads: path.join(DATA, 'uploads'),
};
for (const d of [DATA, ...Object.values(DIRS)]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'library.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, created INTEGER, seen INTEGER);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,            -- TikTok music id
  link TEXT,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  status TEXT NOT NULL,           -- pending | ok | failed
  error TEXT,
  samples INTEGER DEFAULT 0,      -- effective length at 48 kHz after silence trim
  trim_start INTEGER DEFAULT 0,
  gain REAL DEFAULT 0,            -- dB applied when mixing (loudness match)
  audio_file TEXT,
  cover_file TEXT,
  custom_cover TEXT,
  color TEXT,                     -- glow color from the cover
  source_name TEXT,               -- name of the import it first came from
  saved_at TEXT,                  -- date from the TikTok export
  added INTEGER,
  ver INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,             -- import | custom
  custom_cover TEXT,
  shuffle INTEGER DEFAULT 0,
  transition TEXT DEFAULT 'crossfade',
  created INTEGER,
  ver INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE CASCADE,
  pos REAL,
  PRIMARY KEY (playlist_id, track_id)
);
`);

const trackColumns = new Set(db.prepare('PRAGMA table_info(tracks)').all().map((c) => c.name));
for (const [name, definition] of [['origin', "TEXT NOT NULL DEFAULT 'tiktok'"], ['original_name', 'TEXT'], ['original_file', 'TEXT'], ['title_override', 'TEXT'], ['author_override', 'TEXT'], ['base_trim_start', 'INTEGER'], ['base_samples', 'INTEGER'], ['clip_start', 'INTEGER'], ['clip_end', 'INTEGER']]) {
  if (!trackColumns.has(name)) db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${definition}`);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_external_upload ON playlists(kind) WHERE kind = 'external'");

export const kv = {
  get(k) { const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k); return r ? JSON.parse(r.v) : undefined; },
  set(k, v) { db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v)); },
};

if (!kv.get('secret')) kv.set('secret', crypto.randomBytes(32).toString('hex'));
export const SECRET = kv.get('secret');
export const MEDIA_KEY = crypto.createHmac('sha256', SECRET).update('media').digest('hex').slice(0, 32);

export const uid = () => crypto.randomBytes(9).toString('base64url');

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

import crypto from 'node:crypto';
import { db, kv } from './db.js';

const COOKIE = 'tokify';
const MAX_AGE = 400 * 24 * 3600; // Safari's cap for persistent cookies

export function setPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  kv.set('password', { salt: salt.toString('hex'), hash: hash.toString('hex') });
  db.exec('DELETE FROM auth_sessions'); // sign out every device
}

export const hasPassword = () => !!kv.get('password');

function checkPassword(pw) {
  const rec = kv.get('password');
  if (!rec) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(rec.salt, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(rec.hash, 'hex'));
}

// Slow down guessing: 5 failures from one address lock it out for a minute, doubling after.
const failures = new Map();
export function login(req, res, pw) {
  const ip = req.socket.remoteAddress || '?';
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return { ok: false, wait: Math.ceil((f.until - Date.now()) / 1000) };
  if (!checkPassword(pw)) {
    const n = (f?.n || 0) + 1;
    const until = n >= 5 ? Date.now() + 60_000 * 2 ** Math.min(n - 5, 6) : 0;
    failures.set(ip, { n, until });
    return { ok: false, wait: until ? Math.ceil((until - Date.now()) / 1000) : 0 };
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_sessions (token, created, seen) VALUES (?, ?, ?)').run(token, Date.now(), Date.now());
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
  return { ok: true };
}

export function logout(req, res) {
  const t = tokenOf(req);
  if (t) db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(t);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function tokenOf(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export function isAuthed(req) {
  const t = tokenOf(req);
  if (!t) return false;
  const row = db.prepare('SELECT seen FROM auth_sessions WHERE token = ?').get(t);
  if (!row) return false;
  if (Date.now() - row.seen > 3600_000) db.prepare('UPDATE auth_sessions SET seen = ? WHERE token = ?').run(Date.now(), t);
  return true;
}

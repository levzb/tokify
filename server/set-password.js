// Password is entered privately in the terminal, never in shell history.
import { setPassword } from './auth.js';
import { DATA } from './db.js';
import fs from 'node:fs';
import path from 'node:path';

async function readPassword(label) {
  if (!process.stdin.isTTY) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    return text.trim();
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (text) => {
      for (const c of text) {
        if (c === '\u0003') { process.stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\r' || c === '\n') {
          process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); resolve(value); return;
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    };
    process.stdin.on('data', onData);
  });
}
const pw = await readPassword('New password (hidden): ');
if (pw.length < 6 || pw.length > 512) { console.error('Use between 6 and 512 characters.'); process.exit(1); }
setPassword(pw);
fs.rmSync(path.join(DATA, 'initial-password.txt'), { force: true });
console.log('Password saved. Sign in again on every device.');

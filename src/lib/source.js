// Reads a TikTok export from whatever the owner gives: a .zip, a folder, or the .json itself.
import { unzipSync, strFromU8 } from 'fflate';
import { findFavoriteSounds } from '../../shared/export.js';
import { mediaFileError } from '../../shared/media.js';
import { scanMediaFile } from './fileScan.js';

const isJson = (n) => /\.json$/i.test(n);
const isZip = (n) => /\.zip$/i.test(n);

async function textsFromFile(file) {
  if (isJson(file.name)) return [await file.text()];
  if (isZip(file.name) || file.type.includes('zip')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let files;
    try { files = unzipSync(buf, { filter: (f) => isJson(f.name) && !f.name.includes('__MACOSX') }); }
    catch { throw new Error('The archive is damaged or isn’t a zip'); }
    return Object.values(files).map((u8) => strFromU8(u8));
  }
  return [];
}

function readEntries(dirEntry) {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const all = [];
    const step = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); step(); } }, () => resolve(all));
    step();
  });
}
const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function filesFromEntry(entry, out) {
  if (entry.isFile) { if (!entry.name.startsWith('.')) out.push(await entryFile(entry)); }
  else if (entry.isDirectory) for (const e of await readEntries(entry)) await filesFromEntry(e, out);
}

/** From a drop event's DataTransfer: supports dropped folders. */
export async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  for (const e of entries) await filesFromEntry(e, out);
  return out;
}

export async function readExport(files) {
  const list = [...files].filter((f) => isJson(f.name) || isZip(f.name) || f.type.includes('zip'));
  if (!list.length) throw new Error('Choose the TikTok zip, its folder, or the .json file');
  const sounds = [];
  const seen = new Set();
  for (const f of list) {
    for (const text of await textsFromFile(f)) {
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      for (const s of findFavoriteSounds(json)) if (!seen.has(s.musicId)) { seen.add(s.musicId); sounds.push(s); }
    }
  }
  if (!sounds.length) throw new Error('No favorite sounds found. You need the JSON export: Settings → Privacy → Download your data → JSON.');
  const label = list.length === 1 ? list[0].name : `${list.length} files`;
  return { sounds, label };
}

export async function readSource(files, onProgress) {
  const list = [...files].filter((f) => !f.name.startsWith('.'));
  if (!list.length) throw new Error('Choose files to upload');
  const exports = list.filter((f) => isJson(f.name) || isZip(f.name) || f.type.includes('zip'));
  const rejected = list.filter((f) => !exports.includes(f) && mediaFileError(f.name, f.type));
  const media = list.filter((f) => !exports.includes(f) && !mediaFileError(f.name, f.type));
  if (exports.length && media.length) throw new Error('Upload TikTok archives and audio/video files separately');
  const errors = rejected.map((f) => `${f.name}: ${mediaFileError(f.name, f.type)}`);
  if (exports.length) return { ...await readExport(exports), kind: 'tiktok', errors };
  const scanned = [];
  for (let i = 0; i < media.length; i++) {
    const file = media[i];
    onProgress?.({ done: i, total: media.length, filename: file.name, progress: 0 });
    try {
      if (!file.size) throw new Error('The file is empty');
      if (file.size > 512 * 1024 * 1024) throw new Error('Maximum file size is 512 MB');
      scanned.push(await scanMediaFile(file, (progress) => onProgress?.({ done: i, total: media.length, filename: file.name, progress })));
    } catch (e) { errors.push(`${file.name}: ${e.message}`); }
  }
  if (!scanned.length) throw new Error(errors.join('\n') || 'No files with audio found');
  return { kind: 'files', files: scanned, errors, label: scanned.length === 1 ? scanned[0].filename : `${scanned.length} files` };
}

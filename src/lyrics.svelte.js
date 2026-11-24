// The words of songs, shared by the lyrics panel (Lyrics.svelte) and the full-screen stage (Stage.svelte).
// Asked once per song; the server keeps what it found, so a second look is instant. Shazam only listens when
// asked (`listen`): a sound with no real name answers 'unheard' until then.
import { api } from './util.js';

/** id → { res: { status, title, artist, text, source, lines, heard } | null, busy, listening, error } */
export const words = $state({});
const asking = new Map();

/** Looks a song's words up. `again` asks the server afresh; `listen` lets Shazam recognise the sound first. */
export function loadLyrics(id, again = false, listen = false) {
  if (!id) return Promise.resolve(null);
  if (asking.has(id)) return asking.get(id);
  if (!again && words[id]?.res) return Promise.resolve(words[id].res);
  const p = (async () => {
    words[id] = { res: again ? null : words[id]?.res || null, busy: false, listening: false, error: '' };
    try {
      let r = again ? { status: 'new' } : await api(`/api/tracks/${id}/lyrics`);
      if (r.status === 'new') {
        words[id] = { res: null, busy: true, listening: listen, error: '' };
        r = await api(`/api/tracks/${id}/lyrics`, { method: 'POST', body: { listen } });
      }
      words[id] = { res: r, busy: false, listening: false, error: '' };
      return r;
    } catch (e) {
      words[id] = { res: null, busy: false, listening: false, error: e.message };
      return null;
    } finally { asking.delete(id); }
  })();
  asking.set(id, p);
  return p;
}

/** Shazam can still help: it has not listened to this sound yet and no words were found. */
export const canListen = (res) => !!res && !res.heard && ['unheard', 'nolyrics', 'unknown'].includes(res.status);
export const listenTo = (id) => loadLyrics(id, true, true);

/** The timed lines of a found song (none for plain words). */
export const timedLines = (res) => (res?.status === 'found' && res.lines?.length > 2 ? res.lines : []);

/** Index of the line being sung at `t` seconds into the recording (-1 before the first). */
export function lineAt(lines, t) {
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= t + 0.25; k++) i = k;
  return i;
}

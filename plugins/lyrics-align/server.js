// Lyrics alignment — a placeholder (see ../README.md). It registers every hook the real aligner will use, so the
// plugin system can be seen working end to end, but it never changes anyone's lyrics: the provider always passes.
//
// The real one will: separate the voice (Demucs), find which lines of the song's words are sung in this recording
// (Whisper), time them word by word (a CTC aligner), and answer with LRC.

export default function activate(t) {
  t.lyrics.addProvider({
    name: 'AI alignment', priority: 50,
    async find(track, { text }) {
      t.log(`asked about “${track.title}” (${Math.round(track.seconds)} s, ${text ? 'with' : 'without'} plain words) — passing`);
      return null; // the real one: { synced: '[00:12.30] first line\n…', source: 'AI alignment' }
    },
  });

  t.on('track.ready', (id) => {
    if (!t.settings().background) return;
    t.store.set('seen', (t.store.get('seen') || 0) + 1);
    t.status(`Would align ${t.store.get('seen')} new songs in the background`);
  });

  // The Python side, end to end: a JSON question in, a JSON answer out.
  t.action('check', async () => {
    const r = await t.python('worker.py', { ping: true, accuracy: t.settings().accuracy });
    t.status(`Python ${r.python} answers. The aligner itself is not built yet.`);
    return { message: `Python ${r.python} works. Nothing to align with yet.` };
  });

  t.action('align', async ({ trackId }) => {
    if (!trackId) throw new Error('Pick a song');
    return { message: 'Not built yet: this plugin is a placeholder' };
  });

  t.route('GET', 'about', () => ({ placeholder: true, settings: t.settings() }));
}

export function deactivate() {}

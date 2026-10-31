// Finds Favorite Sounds in a TikTok "Download your data" JSON export.
// TikTok renames sections between versions ("Activity" / "Your Activity", "Favorite Sounds" /
// "FavoriteSoundList"), so this walks the whole tree instead of trusting one path.

const MUSIC_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/(?:music\/[^?#\s"]*?-?|(?:h5\/)?share\/music\/)(\d{1,22})(?:\.html)?(?:[/?#]|$)/i;

export function musicIdFrom(link) {
  const m = MUSIC_RE.exec(String(link || ''));
  return m ? m[1] : null;
}

/** Title guess from the link slug: /music/Song-Name-123 -> "Song Name". */
export function titleFromLink(link) {
  try {
    const u = new URL(link);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const t = seg.replace(/-?\d{1,22}(\.html)?$/, '').replace(/-/g, ' ').trim();
    return t || 'TikTok sound';
  } catch { return 'TikTok sound'; }
}

const isFavSoundKey = (k) => /favou?rite\s*sounds?|favou?ritesoundlist/i.test(k.replace(/[_\s]/g, ''));

export function findFavoriteSounds(root) {
  const out = [];
  const seen = new Set();
  const take = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const link = entry.Link || entry.link || entry.URL || entry.url || '';
    const id = musicIdFrom(link);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ musicId: id, link, title: entry.Title || entry.title || titleFromLink(link), date: entry.Date || entry.date || '' });
  };
  const walk = (node, inFav) => {
    if (Array.isArray(node)) { for (const x of node) inFav ? take(x) : walk(x, false); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const fav = inFav || isFavSoundKey(k);
      if (fav && Array.isArray(v)) v.forEach(take);
      else walk(v, fav);
    }
  };
  walk(root, false);
  return out;
}

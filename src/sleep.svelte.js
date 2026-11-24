// Sleep timer (Settings → Playback, shown in the player while it runs): pauses the music after a while or
// when the song that is playing ends. Not remembered across reloads: a timer is for tonight.
import { player, pausePlayback } from './player.svelte.js';
import { toast } from './state.svelte.js';

export const sleep = $state({ until: 0, endOfSong: false, now: Date.now() });
let timer = 0, songId = null;

export const sleeping = () => !!(sleep.until || sleep.endOfSong);
export const sleepLeft = () => Math.max(0, Math.round((sleep.until - sleep.now) / 1000));

/** minutes, 'song', or 0 to turn it off */
export function setSleep(v) {
  clearInterval(timer);
  sleep.until = 0; sleep.endOfSong = false; sleep.now = Date.now();
  if (v === 'song') { sleep.endOfSong = true; songId = player.trackId; }
  else if (v > 0) sleep.until = Date.now() + v * 60000;
  if (sleeping()) timer = setInterval(check, 1000);
}
function check() {
  sleep.now = Date.now();
  const due = (sleep.until && sleep.now >= sleep.until) || (sleep.endOfSong && player.trackId !== songId);
  if (!due) return;
  setSleep(0);
  if (player.playing) { pausePlayback(); toast('Sleep timer: the music is paused'); }
}

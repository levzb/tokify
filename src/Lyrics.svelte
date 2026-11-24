<script>
  // The words of a song, in the one panel. Opened from the player it follows whatever is playing; from a song's
  // menu it stays on that song. A song with a real name is looked up by it; a TikTok "original sound" waits for
  // the Shazam button, which recognises it and then finds its text (server/lyrics.js). Shazam never listens on its
  // own: it answers only so many questions. When the song turns out to have a real name, one tap gives the sound it.
  // Words with timings (songs from Spotify, and others whose recording matches) follow the music: the line being
  // sung lights up and stays in the middle, and a tap on a line goes there.
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { artistName } from './util.js';
  import { lib, ui, patchTrack, toast } from './state.svelte.js';
  import { player, trackDetailsChanged, seek } from './player.svelte.js';
  import { words, loadLyrics, timedLines, lineAt, canListen, listenTo } from './lyrics.svelte.js';
  import { openStage } from './stage.svelte.js';

  const id = $derived(ui.lyricsTrackId || player.trackId);
  const track = $derived(id ? lib.tracks[id] : null);
  const w = $derived(id ? words[id] : null);
  const res = $derived(w?.res || null);   // { status, title, artist, text, source, lines }
  const busy = $derived(!!w?.busy);
  const error = $derived(w?.error || '');
  let renamed = $state('');
  const ask = (trackId, again = false) => { renamed = ''; loadLyrics(trackId, again); };
  const listen = () => { renamed = ''; listenTo(id); };
  $effect(() => { if (ui.lyricsOpen && id) ask(id); });

  // "bôa" and "Boa" are one name.
  const fold = (s) => String(s || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const same = (a, b) => fold(a) === fold(b);
  // The recognised name, offered when it is not what the sound is already called. A song from Spotify already
  // carries its real name.
  const offer = $derived(res?.title && track && track.origin !== 'spotify' && !(same(res.title, track.title) && same(res.artist, track.author)) && renamed !== id);
  async function rename() {
    const t = id, title = res.title, author = res.artist;
    await patchTrack(t, { title, author });
    trackDetailsChanged(t);
    renamed = t;
    toast(`Renamed to “${title}”`);
  }
  function close() { ui.lyricsOpen = false; }

  // ---- words that follow the music ----
  const lines = $derived(timedLines(res));
  const synced = $derived(lines.length > 0);
  const here = $derived(synced && player.trackId === id && !!track);
  // Timings count from the start of the recording; the player counts from where the song starts in it.
  const at = $derived(here ? player.pos + (track.start || 0) : -1);
  const current = $derived(here ? lineAt(lines, at) : -1);
  let box = $state();
  let handsOn = 0; // when the words were last scrolled by hand: they are left there for a moment
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  $effect(() => {
    const i = current;
    if (!box || i < 0 || Date.now() - handsOn < 3000) return;
    const el = box.querySelectorAll('.line')[i];
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.4 + el.clientHeight / 2, behavior: still() ? 'auto' : 'smooth' });
  });
  function jump(l) {
    if (!here) return;
    handsOn = 0;
    seek(Math.max(0, l.t - (track.start || 0)));
  }
</script>

{#if ui.lyricsOpen}
  <Modal label="Lyrics" title={track?.title || 'Lyrics'} lead={track ? artistName(track) : ''} art={track?.cover || ''} thumb closeLabel="Close lyrics" onclose={close}>
    <div class="lyrics">
      {#if !track}
        <p class="quiet">Play a song to see its words here.</p>
      {:else if busy}
        <div class="listening" role="status">
          <span class="ear" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          {#if w.listening}
            <p>Listening to the song…</p>
            <p class="quiet">Recognising it with Shazam and looking for its words. This takes a few seconds, a little longer right after another song.</p>
          {:else}
            <p>Looking for the words…</p>
          {/if}
        </div>
      {:else if error}
        <p class="error" role="alert">{error}</p>
      {:else if res}
        {#if offer}
          <div class="match">
            <div class="match-txt">
              <span class="match-k">It’s</span>
              <strong>{res.title}</strong>
              {#if res.artist}<span class="match-a">{res.artist}</span>{/if}
            </div>
            <button class="btn primary icon" aria-label="Rename to “{res.title}”{res.artist ? ` by ${res.artist}` : ''}" onclick={rename}><Icon name="edit" size={18} /></button>
          </div>
        {/if}
        {#if res.status === 'found' && synced}
          <div class="words timed scroll" class:here bind:this={box} onwheel={() => (handsOn = Date.now())} ontouchmove={() => (handsOn = Date.now())}>
            {#each lines as l, i (i)}
              <button class="line" class:now={i === current} class:past={here && i < current} class:gap={!l.text} disabled={!here}
                tabindex={here ? 0 : -1} aria-current={i === current || null} onclick={() => jump(l)}>
                {#if l.text}{l.text}{:else}<span class="dots" aria-label="Instrumental break"><i></i><i></i><i></i></span>{/if}
              </button>
            {/each}
          </div>
        {:else if res.status === 'found'}
          <div class="words scroll">{res.text}</div>
        {:else if res.status === 'instrumental'}
          <p class="quiet">An instrumental: no words to show.</p>
        {:else if res.status === 'unheard'}
          <p class="quiet">This sound has no song name to look up. Shazam can listen to it and find out what it is.</p>
        {:else if res.status === 'nolyrics'}
          <p class="quiet">{res.heard ? 'No lyrics found for this song.' : 'No lyrics found under this name. Shazam can listen to the sound and find out what it really is.'}</p>
        {:else}
          <p class="quiet">Couldn’t recognise this sound. It may be a voice, a remix or an original sound. If you know the song, rename the sound to its real title and look again.</p>
        {/if}
        {#if canListen(res)}
          <button class="btn primary shazam" onclick={listen}><Icon name="ear" size={18} />Recognise with Shazam</button>
        {/if}
      {/if}
    </div>
    {#if track && !busy}
      <div class="modal-foot">
        {#if res?.source}
          <span class="credit aside">{synced ? 'Synced lyrics' : 'Lyrics'} from {#if res.source === 'LRCLIB'}<a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>{:else}{res.source}{/if}</span>
        {/if}
        {#if track && player.trackId === id}
          <button class="btn ghost icon" aria-label="Full screen" aria-keyshortcuts="f" onclick={openStage}><Icon name="stage" size={18} /></button>
        {/if}
        <button class="btn ghost icon" aria-label="Look again" onclick={() => ask(id, true)}><Icon name="retry" size={18} /></button>
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .lyrics { min-height: 120px; }
  .quiet { margin: 0; font-size: 14px; line-height: 1.6; color: var(--muted); }
  .error { margin: 0; }

  .words {
    max-height: calc(100dvh - 330px); overflow-y: auto; margin: 0 -8px; padding: 2px 8px 8px;
    white-space: pre-line; font-size: 17px; line-height: 1.75; font-weight: 500; letter-spacing: -.005em; color: var(--text);
    text-wrap: pretty; animation: fadeUp .45s var(--ease) both;
    mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
  }

  /* words with timings: one line at a time comes forward */
  .timed { white-space: normal; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding-top: 6px; padding-bottom: 40%; mask-image: linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 48px), transparent); }
  .line {
    display: block; width: 100%; margin: 0; padding: 7px 10px; border: none; border-radius: 10px; background: none; text-align: left;
    font: inherit; font-size: 21px; line-height: 1.35; font-weight: 700; letter-spacing: -.015em; color: var(--text); text-wrap: pretty;
    transform-origin: left center; transition: color .35s var(--ease), opacity .35s var(--ease), transform .35s var(--ease), filter .35s var(--ease);
  }
  .here .line { opacity: .34; cursor: pointer; }
  .here .line.past { opacity: .5; }
  .here .line.now { opacity: 1; transform: scale(1.025); }
  .here .line:hover { opacity: .8; background: var(--fill-1); }
  .here .line.now:hover { opacity: 1; }
  .line:disabled { cursor: default; }
  .line:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .5); }
  .dots { display: inline-flex; gap: 6px; padding: 8px 0; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .6; }
  .line.now .dots i { animation: breath 1.6s ease-in-out infinite; }
  .line.now .dots i:nth-child(2) { animation-delay: .2s; } .line.now .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes breath { 50% { transform: scale(1.35); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .line { transition: none; } .here .line.now { transform: none; } .line.now .dots i { animation: none; } }

  .shazam { margin-top: 18px; gap: 8px; }
  .match {
    display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding: 12px 12px 12px 16px;
    border-radius: var(--r-item); background: var(--fill-1); animation: fadeUp .4s var(--ease) both;
  }
  .match-txt { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .match-k { font-size: 13px; color: var(--muted); }
  .match strong { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match-a { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match .btn.icon { min-width: 48px; padding: 0 14px; }

  .listening { display: grid; justify-items: start; gap: 6px; }
  .listening p { margin: 0; font-size: 15px; }
  .listening .quiet { font-size: 13px; }
  .ear { display: flex; align-items: center; gap: 4px; height: 28px; margin-bottom: 8px; }
  .ear i { width: 4px; height: 30%; border-radius: 2px; background: var(--text); animation: ear 1.1s ease-in-out infinite; }
  .ear i:nth-child(2) { animation-delay: -.2s; } .ear i:nth-child(3) { animation-delay: -.5s; }
  .ear i:nth-child(4) { animation-delay: -.8s; } .ear i:nth-child(5) { animation-delay: -.35s; }
  @keyframes ear { 50% { height: 100%; } }
  @media (prefers-reduced-motion: reduce) { .ear i { animation: none; height: 60%; } }

  .credit { font-size: 13px; color: var(--faint); }
  .credit a { color: var(--muted); text-decoration: none; }
  .credit a:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
  @media (max-width: 760px) { .words { max-height: 52dvh; font-size: 16px; } .line { font-size: 19px; } }
</style>

<script>
  // Search lives on Home. Focusing the field clears the room: everything else on Home dissolves away and the
  // field stays with your recent searches; results take Home's place, so nothing is pushed down. Leaving the
  // field empty (Esc, the back arrow, a click elsewhere) brings Home back.
  // Results: the hit you are looking at sits big on the left, all hits stand in a column beside it. A preview
  // lights the room with its cover (Ambient.svelte) and its row's cover turns into a spinning record.
  import { onDestroy, tick } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { clock } from './util.js';
  import { lib, ui, go } from './state.svelte.js';
  import { player } from './player.svelte.js';
  import { providerName } from '../server/shared.js';
  import { search, heroOf, typed, submit, reset, choose, download, dlState, listen, quiet, warm, findOnYouTube,
    previewable, forget, isLink, PREVIEW, openLink, importList } from './search.svelte.js';

  let { children } = $props();
  let field = $state();
  const hero = $derived(heroOf());
  const list = $derived(search.hits);
  const destination = $derived(lib.playlists.find((p) => p.kind === 'external')?.name || 'Мои файлы');
  const idle = $derived(!search.q.trim() && search.phase === 'idle');

  onDestroy(() => { quiet(); search.open = false; });
  $effect(() => { if (player.playing) quiet(); });

  function close() {
    quiet(); search.open = false; field?.blur();
  }
  function key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (search.q) { reset(); search.q = ''; } else close();
    }
  }
  // A click outside an empty search gives Home back.
  function leave(e) {
    if (e.currentTarget.contains(e.relatedTarget) || search.q.trim() || search.prev.url) return;
    close();
  }
  // Leaving pieces lift out of the flow and dissolve where they stood; arriving ones settle in.
  const gone = () => ({ duration: 220, easing: cubicOut,
    css: (t) => `position:absolute;left:0;right:0;pointer-events:none;opacity:${t};filter:blur(${(1 - t) * 8}px);transform:translateY(${(1 - t) * -8}px) scale(${0.99 + t * 0.01})` });
  const arrive = (_, { delay = 0 } = {}) => ({ delay, duration: 420, easing: cubicOut,
    css: (t) => `opacity:${t};filter:blur(${(1 - t) * 8}px);transform:translateY(${(1 - t) * 14}px)` });
  function paste(e) {
    const text = e.clipboardData?.getData('text')?.trim();
    if (!text || !isLink(text)) return;
    e.preventDefault(); search.q = text; openLink(text);
  }
  // ---- a whole playlist ----
  const pl = $derived(search.list);
  const plJob = $derived(pl && ui.importJob?.playlistId && ui.importJob.playlistId === pl.playlistId ? ui.importJob : null);
  const plRunning = $derived(!!plJob && !plJob.finished);
  const SHOWN = 300;
  const listWhat = (l) => ({ spotify: l.listKind === 'album' ? 'Spotify album' : 'Spotify playlist', youtube: 'YouTube playlist', soundcloud: 'SoundCloud playlist' }[l.provider] || 'Playlist');
  function listLength(songs) {
    if (!songs.length || songs.some((s) => !s.duration)) return '';
    const m = Math.round(songs.reduce((n, s) => n + s.duration, 0) / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function songState(s) {
    const it = plJob?.items?.[s.id]?.status;
    if (it === 'ok' || s.have || (pl?.playlistId && lib.tracks[s.id]?.status === 'ok')) return 'ok';
    if (it === 'working') return 'working';
    if (it === 'failed' || (!plRunning && pl?.playlistId && lib.tracks[s.id]?.status === 'failed')) return 'failed';
    return it === 'queued' ? 'queued' : '';
  }
  const plAction = $derived(!pl ? null
    : plRunning || (pl.playlistId && !pl.fresh) ? { label: 'Open playlist', icon: 'arrow', run: () => go('playlist', pl.playlistId) }
    : pl.playlistId ? { label: `Add ${pl.fresh} new ${pl.fresh === 1 ? 'song' : 'songs'}`, icon: 'download', run: importList }
    : { label: `Import ${pl.songs.length} ${pl.songs.length === 1 ? 'song' : 'songs'}`, icon: 'download', run: importList });

  const live = (url) => search.prev.url === url;
  const left = (url) => Math.max(0, Math.ceil(PREVIEW - (live(url) ? search.prev.t : 0)));
  function primaryLabel(h) {
    const st = dlState(h.sourceUrl);
    if (st === 'downloading') return 'Importing';
    if (st === 'done' || h.saved) return 'Open';
    if (st === 'failed') return 'Try again';
    return 'Import';
  }
</script>

<section class="link-import room" class:open={search.open} aria-label="Search music" tabindex="-1" onfocusout={leave}>
  <form class="room-field pill lg" class:busy={search.phase === 'searching'} onsubmit={(e) => { e.preventDefault(); submit(); }}>
    {#if search.open}
      <button type="button" class="icon-btn sm lead-btn" aria-label="Close search" onclick={() => { reset(); search.q = ''; close(); }}><Icon name="back" size={19} /></button>
    {:else}
      <span class="lens" aria-hidden="true"><Icon name="search" size={20} /></span>
    {/if}
    <input bind:this={field} onfocus={() => (search.open = true)} aria-keyshortcuts="/" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
      aria-label="Music link" placeholder={search.open ? 'Song and artist, or a link' : 'Search songs or paste a link'} value={search.q}
      oninput={(e) => typed(e.currentTarget.value)} onkeydown={key} onpaste={paste} />
    {#if !search.open}<kbd aria-hidden="true">/</kbd>{/if}
    {#if search.q}<button type="button" class="icon-btn sm" aria-label="Clear music link" onclick={() => { reset(); search.q = ''; field?.focus(); }}><Icon name="x" size={17} /></button>{/if}
    <button type="submit" class="btn primary icon find" aria-label="Find sound" disabled={!search.q.trim()}>
      {#if search.phase === 'searching'}<span class="spinner sm"></span>{:else}<Icon name="search" size={20} stroke={2.2} />{/if}
    </button>
  </form>

  {#if !search.open}
    <div class="home-rest" in:arrive={{ delay: 60 }} out:gone>{@render children?.()}</div>
  {:else}
  <div class="room-body" in:arrive={{ delay: 40 }} out:gone>
  {#if search.error}<p class="error" role="alert">{search.error}</p>{/if}

  {#if idle}
    <div class="welcome">
      <p class="hint">Type a song and its artist, or paste a link to a song or a whole playlist from TikTok, YouTube, SoundCloud or Spotify.</p>
      {#if search.recent.length}
        <ul class="recent" aria-label="Recent searches">
          {#each search.recent as r (r)}
            <li>
              <button class="recent-q" onclick={() => { search.q = r; submit(r); }}><Icon name="clock" size={16} /><span>{r}</span></button>
              <button class="icon-btn sm" aria-label="Forget {r}" onclick={() => forget(r)}><Icon name="x" size={15} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if search.phase === 'searching' && !hero && !pl}
    <div class="stage" aria-busy="true" aria-label="Searching {search.lookup}">
      <div class="result skeleton"><div class="thumb sk" class:wide={search.kind !== 'list'}></div><div class="sk line w70"></div><div class="sk line w40"></div></div>
      {#if search.kind === 'list'}<p class="reading" role="status">Reading the {search.lookup} playlist…</p>{/if}
      {#if search.kind === 'words' || search.kind === 'list'}
        <div class="hits">{#each [0, 1, 2, 3, 4] as i}<div class="hit sk-row" style="animation-delay:{i * 60}ms"><span class="sk sq"></span><span class="sk-txt"><span class="sk line w70"></span><span class="sk line w40"></span></span></div>{/each}</div>
      {/if}
    </div>
  {:else if pl}
    {@const shown = pl.songs.slice(0, SHOWN)}
    {@const limited = pl.total > pl.songs.length + (pl.unavailable || 0)}
    <div class="stage">
      <article class="result list-card">
        <div class="thumb">
          {#if pl.cover}<img src={pl.cover} alt="" />{:else}<Cover size="100%" radius={10} />{/if}
        </div>
        <div class="hero-txt">
          <h2 class="title">{pl.name}</h2>
          {#if pl.owner}<p class="who">{pl.owner}</p>{/if}
          <p class="meta-line">
            <span><a href={pl.sourceUrl} target="_blank" rel="noreferrer">{listWhat(pl)}</a></span>
            <span>{pl.songs.length} {pl.songs.length === 1 ? 'song' : 'songs'}</span>
            {#if listLength(pl.songs)}<span class="len">{listLength(pl.songs)}</span>{/if}
          </p>
          {#if plRunning}
            <div class="list-progress" role="status" aria-live="polite">
              <span class="bar"><i style="transform:scaleX({plJob.total ? plJob.done / plJob.total : 0})"></i></span>
              <span class="count">{plJob.done} of {plJob.total} downloaded{plJob.failed ? ` · ${plJob.failed} failed` : ''}</span>
            </div>
          {:else if plJob?.finished}
            <p class="note done-note">{plJob.ok} of {plJob.total} downloaded{plJob.failed ? `. ${plJob.failed} didn’t download; try them again from the playlist.` : '.'}</p>
          {/if}
          {#if limited}
            <p class="note">Without signing in, Spotify shows only the first {pl.songs.length} of its {pl.total} songs.</p>
          {/if}
          {#if pl.provider === 'spotify' && !plRunning && !plJob}
            <p class="note">The audio comes from each song’s recording on YouTube. Words that follow the music are added when they exist.</p>
          {/if}
          <div class="acts">
            <button class="btn primary icon wide-act" aria-label={plAction.label} disabled={search.listing} onclick={plAction.run}>
              {#if search.listing}<span class="spinner sm"></span>{:else}<Icon name={plAction.icon} size={20} />{/if}
            </button>
            {#if pl.playlistId && !plRunning}
              <button class="btn ghost icon" aria-label="Check the playlist again" disabled={search.listing} onclick={importList}><Icon name="retry" size={19} /></button>
            {/if}
          </div>
        </div>
      </article>

      <ol class="songs" aria-label="Songs in {pl.name}">
        {#each shown as s, i (s.id)}
          {@const st = songState(s)}
          <li class="song" class:have={st === 'ok'} class:working={st === 'working'} class:failed={st === 'failed'} style="animation-delay:{Math.min(i, 12) * 25}ms">
            <span class="n">{i + 1}</span>
            <span class="hit-txt">
              <span class="hit-t" class:unnamed={!s.title}>{s.title || 'Name comes with the download'}</span>
              {#if s.author}<span class="hit-a">{s.author}</span>{/if}
            </span>
            <span class="dur">{s.duration ? clock(s.duration) : ''}</span>
            <span class="state" aria-label={st === 'ok' ? 'In your library' : st === 'failed' ? 'Didn’t download' : st === 'working' ? 'Downloading' : null}
              data-tip={st === 'failed' ? plJob?.items?.[s.id]?.error || lib.tracks[s.id]?.error || 'Didn’t download' : null}>
              {#if st === 'ok'}<Icon name="check" size={16} stroke={2.5} />
              {:else if st === 'working'}<span class="spinner sm"></span>
              {:else if st === 'failed'}<Icon name="alert" size={16} />{/if}
            </span>
          </li>
        {/each}
        {#if pl.songs.length > SHOWN}<li class="more">and {pl.songs.length - SHOWN} more</li>{/if}
      </ol>
    </div>
  {:else if hero}
    {@const st = dlState(hero.sourceUrl)}
    {@const on = live(hero.sourceUrl)}
    <div class="stage" class:solo={!list.length && !search.matching}>
      {#key hero.sourceUrl}
        <article class="result" class:on>
          <button class="thumb" class:wide={hero.wide} class:listen={previewable(hero)} disabled={!previewable(hero)}
            aria-label={on ? 'Stop preview' : 'Preview 30 seconds'} onclick={() => listen(hero)}>
            {#if hero.art}<img src={hero.art} alt="" />{:else}<Cover size="100%" radius={10} />{/if}
            {#if previewable(hero)}
              <span class="pp badge">{#if on && search.prev.state === 'loading'}<span class="spinner sm dark"></span>{:else}<Icon name={on ? 'pause' : 'play'} size={22} />{/if}</span>
            {/if}
            {#if on}<i class="time" style="transform:scaleX({search.prev.t / PREVIEW})"></i>{/if}
          </button>
          <div class="hero-txt">
            <h2 class="title">{hero.title}</h2>
            <p class="who">{hero.author || 'Unknown artist'}</p>
            <p class="meta-line">
              {#if on}
                <span class="previewing"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>{search.prev.state === 'loading' ? 'Getting the preview ready' : `Preview · ${clock(left(hero.sourceUrl))} left`}</span>
              {:else}
                <span><a href={hero.sourceUrl} target="_blank" rel="noreferrer">{providerName(hero.provider || 'youtube')}</a></span>
                {#if hero.duration}<span>{clock(hero.duration)}</span>{/if}
                <span class="destination">{hero.canDownload === false ? 'Track information' : st === 'done' || hero.saved ? `In ${destination}` : `Saves to ${destination}`}</span>
              {/if}
            </p>
            {#if hero.canDownload === false && !search.hero}<p class="note">Spotify provides track information, not a full audio download. Find a recording on YouTube and choose the source before downloading.</p>{/if}
            <div class="acts">
              {#if hero.canDownload === false && !search.hero}
                <button class="btn primary icon wide-act" aria-label="Find on YouTube" disabled={search.matching} onclick={findOnYouTube}>
                  {#if search.matching}<span class="spinner sm"></span>{:else}<Icon name="search" size={19} />{/if}
                </button>
              {:else}
                <button class="btn primary icon wide-act" aria-label={primaryLabel(hero)} disabled={st === 'downloading' || !hero.ready}
                  onclick={() => download(hero.sourceUrl)}>
                  {#if st === 'downloading' || !hero.ready}<span class="spinner sm"></span>
                  {:else if st === 'done' || hero.saved}<Icon name="arrow" size={20} />
                  {:else if st === 'failed'}<Icon name="retry" size={19} />
                  {:else}<Icon name="download" size={20} />{/if}
                </button>
                <button class="btn ghost icon" aria-label={st === 'done' || hero.saved ? 'Trim audio' : 'Import & trim'} disabled={st === 'downloading' || !hero.ready}
                  onclick={() => download(hero.sourceUrl, true)}><Icon name="cut" size={19} /></button>
              {/if}
            </div>
          </div>
        </article>
      {/key}

      {#if list.length}
        <div class="hits" role="list" aria-label={search.hitsFor ? `Results for ${search.hitsFor}` : 'YouTube matches'}>
          {#each list as hit, i (hit.url)}
            {@const l = live(hit.url)}
            {@const s = dlState(hit.url)}
            <div class="hit" class:picked={hit.url === search.hero} class:live={l} class:loading={l && search.prev.state === 'loading'} role="listitem"
              style="--p:{l ? search.prev.t / PREVIEW : 0}; animation-delay:{Math.min(i, 8) * 35}ms" onpointerenter={() => warm(hit.url, hit.duration)}>
              <button class="hit-art" aria-label={l ? 'Stop preview' : 'Preview 30 seconds'} onclick={() => listen(hit)}>
                <Icon name="note" size={18} />{#if hit.cover}<img src={hit.cover} alt="" loading="lazy" onerror={(e) => e.currentTarget.remove()} />{/if}
                <span class="hit-play">
                  {#if l && search.prev.state === 'loading'}<span class="spinner sm"></span>
                  {:else if l}<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
                  {:else}<Icon name="play" size={18} />{/if}
                </span>
              </button>
              <button class="hit-main" aria-label="Choose {hit.title}" aria-current={hit.url === search.hero || null} onclick={() => choose(hit)}>
                <span class="hit-txt"><span class="hit-t">{hit.title}</span><span class="hit-a">{hit.author || 'YouTube'}</span></span>
                <span class="hit-d dur">{l ? `−${clock(left(hit.url))}` : clock(hit.duration)}</span>
              </button>
              <span class="hit-acts">
                {#if s === 'downloading'}<span class="spinner sm"></span>
                {:else if s === 'done'}<button class="icon-btn sm done" aria-label="Open {hit.title} in your library" onclick={() => download(hit.url)}><Icon name="check" size={18} stroke={2.5} /></button>
                {:else}
                  <button class="icon-btn sm" aria-label="Download and trim" onclick={() => download(hit.url, true)}><Icon name="cut" size={17} /></button>
                  <button class="icon-btn sm" aria-label="Download" onclick={() => download(hit.url)}><Icon name="download" size={18} /></button>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else if search.matching}
        <div class="hits">{#each [0, 1, 2] as i}<div class="hit sk-row" style="animation-delay:{i * 60}ms"><span class="sk sq"></span><span class="sk-txt"><span class="sk line w70"></span><span class="sk line w40"></span></span></div>{/each}</div>
      {/if}
    </div>
  {/if}
  </div>
  {/if}
</section>

<style>
  .room { position: relative; outline: none; }
  .room-body { margin-top: 28px; }
  .home-rest { margin-top: 12px; }
  .lens { display: grid; place-items: center; width: 22px; flex: none; color: var(--muted); }
  .lead-btn { margin-left: -8px; flex: none; }
  .room-field kbd {
    font: inherit; font-size: 12px; font-weight: 600; color: var(--muted); min-width: 24px; padding: 2px 7px; border-radius: 6px;
    background: var(--fill-2); text-align: center;
  }
  @media (hover: none) { .room-field kbd { display: none; } }

  /* ---- the field ---- */
  .room-field { min-height: 60px; gap: 12px; padding: 0 8px 0 20px; border-radius: 16px; cursor: text; }
  .room-field input { font-size: 17px; }
  .room-field input::placeholder { color: var(--faint); }
  .find { min-height: 44px; min-width: 56px; border-radius: 12px; }
  .error { margin: 0 6px 20px; }

  /* ---- before anything is typed ---- */
  .welcome { display: grid; gap: 20px; max-width: 640px; padding: 0 6px; animation: fadeUp .4s var(--ease) both; }
  .hint { margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
  .recent { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .recent li { display: flex; align-items: center; border-radius: var(--r-item); transition: background .15s; }
  .recent li:hover { background: var(--fill-1); }
  .recent-q {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: none; background: none;
    font: inherit; font-size: 15px; color: var(--text); text-align: left; cursor: pointer; border-radius: var(--r-item);
  }
  .recent-q :global(svg) { color: var(--faint); flex: none; }
  .recent-q span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent li .icon-btn { margin-right: 6px; opacity: 0; }
  .recent li:hover .icon-btn, .recent li .icon-btn:focus-visible { opacity: 1; }

  /* ---- results: the hero beside the column ---- */
  .stage { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 40px; align-items: start; }
  .stage.solo { grid-template-columns: minmax(300px, 520px); }

  .result { display: grid; gap: 22px; animation: heroIn .5s var(--ease) both; }
  @keyframes heroIn { from { opacity: 0; transform: translateY(10px) scale(.985); filter: blur(6px); } }
  .thumb {
    position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; border: none; border-radius: 10px;
    background: var(--fill-1); box-shadow: 0 18px 50px rgba(0, 0, 0, .45); cursor: default;
    transition: transform .5s var(--ease), box-shadow .5s var(--ease);
  }
  .thumb.wide { aspect-ratio: 16 / 9; }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
  .thumb.listen { cursor: pointer; }
  .result.on .thumb { transform: scale(1.015); box-shadow: 0 26px 70px rgba(0, 0, 0, .55); animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 50% { transform: scale(1.03); box-shadow: 0 32px 80px rgba(0, 0, 0, .6); } }
  .result.on .badge { animation: none; }
  .badge {
    --s: 56px; position: absolute; right: 14px; bottom: -18px; box-shadow: 0 10px 28px rgba(0, 0, 0, .45);
    transition: transform .2s var(--ease);
  }
  .thumb.listen:hover .badge { transform: scale(1.06); }
  .thumb .time {
    position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 0 0 10px 10px;
    background: var(--accent); transform-origin: left; transition: transform .25s linear;
  }
  .hero-txt { display: grid; gap: 4px; min-width: 0; padding-right: 72px; }
  .result .title {
    margin: 0; font-size: 24px; line-height: 1.25; font-weight: 700; letter-spacing: -.02em; text-wrap: balance;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .who { margin: 0; font-size: 16px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta-line { margin-top: 6px; font-size: 13px; color: var(--faint); min-height: 20px; }
  .meta-line a { color: inherit; text-decoration: none; }
  .meta-line a:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
  .previewing { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-weight: 500; font-variant-numeric: tabular-nums; }
  .note { margin: 12px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); max-width: 46ch; }
  .acts { display: flex; gap: 8px; margin-top: 16px; }
  .acts .btn { min-height: 48px; border-radius: 12px; }
  .acts .btn.icon { width: 48px; min-width: 48px; }
  .acts .btn.icon.wide-act { width: auto; min-width: 112px; padding: 0 28px; }

  /* ---- a whole playlist: the card beside its songs ---- */
  .reading { margin: -8px 0 0; font-size: 13px; color: var(--muted); grid-column: 1; }
  .list-progress { display: grid; gap: 8px; margin-top: 14px; max-width: 360px; }
  .list-progress .bar { position: relative; height: 4px; border-radius: 99px; background: var(--fill-2); overflow: hidden; }
  .list-progress .bar i {
    position: absolute; inset: 0; background: var(--text); border-radius: inherit;
    transform-origin: left; transition: transform .6s var(--ease);
  }
  .list-progress .count { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .done-note { color: var(--text); }
  .songs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0; counter-reset: none; }
  .song {
    display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 6px 12px 6px 8px; border-radius: var(--r-item);
    animation: fadeUp .35s var(--ease) both; transition: background .15s;
  }
  .song:hover { background: var(--fill-1); }
  .song .n { width: 28px; flex: none; text-align: right; font-size: 13px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .song .dur { min-width: 40px; text-align: right; font-size: 13px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .song .state { width: 20px; flex: none; display: grid; place-items: center; }
  .song.have .state { color: var(--accent); }
  .song.working .hit-t { color: var(--text); font-weight: 600; }
  .song.failed .state { color: var(--danger, #ff6b6b); }
  .song.failed .hit-t { color: var(--muted); }
  .unnamed { color: var(--faint) !important; font-style: italic; font-weight: 400 !important; }
  .more { padding: 14px 12px 4px 50px; font-size: 13px; color: var(--faint); }

  /* ---- the column of hits; a previewing row is its own timeline ---- */
  .hits { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hit {
    position: relative; display: flex; align-items: center; gap: 4px; min-height: 64px; padding-right: 8px;
    border-radius: var(--r-item); isolation: isolate; animation: fadeUp .35s var(--ease) both;
  }
  .hit::before {
    content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: var(--fill-1);
    opacity: 0; transition: opacity .15s;
  }
  .hit:hover::before { opacity: 1; }
  .hit.picked::before { opacity: 1; background: var(--fill-2); }
  .hit::after {
    content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
    background: linear-gradient(90deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .13));
    transform: scaleX(var(--p)); transform-origin: left; transition: transform .25s linear; opacity: 0;
  }
  .hit.live::after { opacity: 1; }
  .hit.live::before { opacity: 1; }
  .hit.live .hit-a { color: var(--muted); }
  .hit-art {
    position: relative; flex: none; width: 48px; height: 48px; margin-left: 8px; display: grid; place-items: center; overflow: hidden;
    padding: 0; border: none; border-radius: 6px; background: var(--fill-2); color: var(--faint); cursor: pointer;
  }
  .hit-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .hit-art { transition: border-radius .45s var(--ease), box-shadow .45s var(--ease); }
  /* a previewing cover becomes a little record and spins */
  .hit.live .hit-art { border-radius: 50%; box-shadow: 0 4px 14px rgba(0, 0, 0, .5); }
  .hit.live .hit-art img { animation: spin 4s linear infinite; }
  .hit.live.loading .hit-art img { animation-duration: 12s; }
  .hit.live .hit-art::after {
    content: ''; position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; z-index: 2;
    border-radius: 50%; background: var(--bg, #111); box-shadow: 0 0 0 2px rgba(255, 255, 255, .25);
  }
  .hit.live .hit-play { background: rgba(0, 0, 0, .25); opacity: 0; }
  .hit.live:hover .hit-play { opacity: 1; background: rgba(0, 0, 0, .55); }
  @keyframes spin { to { transform: rotate(1turn); } }
  .hit-play {
    position: absolute; inset: 0; display: grid; place-items: center; color: #fff;
    background: rgba(0, 0, 0, .5); opacity: 0; transition: opacity .15s;
  }
  .hit:hover .hit-play, .hit.live .hit-play, .hit-art:focus-visible .hit-play { opacity: 1; }
  .hit-art:focus-visible, .thumb:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, .6); }
  .hit-main {
    display: flex; flex: 1; min-width: 0; align-items: center; gap: 12px; padding: 8px 8px 8px 10px;
    border: none; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: var(--r-item);
  }
  .hit-main:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .5); }
  .hit-txt { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .hit-t { font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hit.live .hit-t { font-weight: 600; }
  .hit-a { font-size: 13px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hit-d { min-width: 44px; text-align: right; }
  .hit.live .hit-d { color: var(--text); }
  .hit-acts { display: flex; align-items: center; justify-content: center; gap: 2px; min-width: 68px; }
  .hit-acts .done { color: var(--accent); }
  @media (hover: hover) {
    .hit-acts .icon-btn:not(.done) { opacity: 0; transition: opacity .15s; }
    .hit:hover .hit-acts .icon-btn, .hit-acts .icon-btn:focus-visible { opacity: 1; }
  }
  @media (hover: none) { .hit:not(.live) .hit-play { opacity: 1; background: rgba(0, 0, 0, .3); } }
  @media (prefers-reduced-motion: reduce) { .hit.live .hit-art img, .result.on .thumb, .eq i { animation: none; } }

  /* the preview's pulse: three bars, the same as a playing song in a list */
  .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
  .eq i { width: 3px; height: 60%; background: currentColor; border-radius: 1px; animation: eq 1s ease-in-out infinite; }
  .eq i:nth-child(2) { animation-delay: -.4s; }
  .eq i:nth-child(3) { animation-delay: -.7s; }
  @keyframes eq { 0%, 100% { height: 30%; } 50% { height: 100%; } }

  /* ---- waiting ---- */
  .skeleton { pointer-events: none; }
  .sk { display: block; border-radius: 6px; background: var(--fill-1); position: relative; overflow: hidden; }
  .sk::after {
    content: ''; position: absolute; inset: 0; transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .06), transparent); animation: sweep 1.3s ease-in-out infinite;
  }
  @keyframes sweep { to { transform: translateX(100%); } }
  .skeleton .thumb { box-shadow: none; }
  .line { height: 14px; }
  .skeleton .line:first-of-type { height: 22px; }
  .w70 { width: 70%; } .w40 { width: 40%; }
  .sk-row { gap: 14px; padding-left: 8px; }
  .sq { width: 48px; height: 48px; flex: none; }
  .sk-txt { display: grid; gap: 8px; flex: 1; }

  @media (max-width: 1100px) {
    .stage { grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 28px; }
  }
  @media (max-width: 860px) {
    .stage, .stage.solo { grid-template-columns: minmax(0, 1fr); gap: 32px; }
    .result { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .room-body { margin-top: 22px; }
    .home-rest { margin-top: 8px; }
    .room-field { min-height: 52px; padding-left: 16px; }
    .room-field input { font-size: 16px; }
    .result .title { font-size: 21px; }
    .hero-txt { padding-right: 0; }
    .acts .btn.icon.wide-act { flex: 1; }
    .hit-acts { min-width: 0; }
    .song { padding-right: 6px; gap: 10px; }
    .list-card { grid-template-columns: 132px minmax(0, 1fr); column-gap: 18px; row-gap: 4px; align-items: end; }
    .list-card .hero-txt { display: contents; }
    .list-card .title { grid-column: 2; align-self: end; font-size: 20px; }
    .list-card .who, .list-card .meta-line { grid-column: 2; }
    .list-card .len { display: none; }
    .list-card .thumb { grid-row: 1 / span 3; align-self: start; }
    .list-card .list-progress, .list-card .note, .list-card .done-note, .list-card .acts { grid-column: 1 / -1; margin-top: 14px; }
    .song .n { width: 22px; }
  }
</style>

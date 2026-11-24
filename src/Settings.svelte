<script>
  // Settings (#/settings, the gear under Home in the rail). One tab per subject, each with its own composition:
  // Look is a studio, a big live model of this Tokify beside the dials that change it; Layout picks one of four
  // arrangements; Playback draws the crossfade it sets; Library shows what the data folder holds; Keys lists the
  // shortcuts. Every change is live and remembered per browser (prefs.svelte.js).
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Fader from './Fader.svelte';
  import { lib, ui, ask, toast, tracksOf, allSongs } from './state.svelte.js';
  import { player, retime } from './player.svelte.js';
  import { prefs, setPref, ACCENTS, RANGE, coverTint, lookChanged, lookNow, setLook, resetLook } from './prefs.svelte.js';
  import { perf, setLite } from './perf.svelte.js';
  import { sleep, setSleep, sleeping, sleepLeft } from './sleep.svelte.js';
  import { sound, soundName } from './sound.svelte.js';
  import { search, forgetAll } from './search.svelte.js';
  import { layout, place } from './dock.svelte.js';
  import { roomLight } from './Ambient.svelte';
  import { blurred, SIZE } from './blur.js';
  import { api, clock, songs, plural } from './util.js';
  import { XFADE } from '../server/shared.js';
  import { version } from '../package.json';
  import { plugins, loadPlugins, setPluginOn, setPluginSetting, runPluginAction } from './plugins.svelte.js';

  const room = $derived(roomLight());
  const now = $derived(lib.tracks[player.trackId] || allSongs().find((t) => t.cover) || null);
  const chosen = $derived(ACCENTS.find((a) => a.id === prefs.accent));
  const shelf = $derived(lib.playlists.slice(0, 4).map((pl) => pl.cover || tracksOf(pl).find((t) => t.cover)?.cover || ''));
  const songCount = $derived(Object.values(lib.tracks).filter((t) => t.status === 'ok').length);
  const pct = (v) => `${Math.round(v * 100)}%`;

  // ---- tabs ----
  const TABS = [
    { id: 'look', name: 'Look' },
    { id: 'layout', name: 'Layout', desk: true },
    { id: 'playback', name: 'Playback' },
    { id: 'library', name: 'Library' },
    { id: 'plugins', name: 'Plugins' },
    { id: 'keys', name: 'Keys', desk: true },
  ];
  const phone = () => matchMedia('(max-width: 760px)').matches;
  let tab = $state((() => { try { return sessionStorage.getItem('tokify.settings-tab') || 'look'; } catch { return 'look'; } })());
  if (phone() && TABS.find((t) => t.id === tab)?.desk) tab = 'look';
  function open(id) { tab = id; try { sessionStorage.setItem('tokify.settings-tab', id); } catch {} }
  // The lit pad slides under the chosen tab.
  let tabEls = $state({}), pad = $state({ x: 0, w: 0 });
  $effect(() => {
    const el = tabEls[tab];
    if (!el) return;
    const sync = () => (pad = { x: el.offsetLeft, w: el.offsetWidth });
    sync(); document.fonts?.ready.then(sync);
  });
  const swap = () => ({ duration: 420, css: (k) => { const e = 1 - Math.pow(1 - k, 3); return `opacity:${e};transform:translateY(${(1 - e) * 10}px);${perf.lite ? '' : `filter:blur(${(1 - e) * 6}px)`}`; } });

  // ---- look ----
  function pickCustom(e) { setPref('custom', e.currentTarget.value); setPref('accent', 'custom'); }
  function reset() {
    const before = lookNow(), lite = perf.lite;
    resetLook(); setLite(false);
    toast('The look is back to how it came', { action: 'Undo', onAction: () => { setLook(before); setLite(lite); } });
  }

  // ---- layout ----
  const ARRANGEMENTS = [
    { rail: 'left', player: 'bottom', name: 'Sidebar left, player below' },
    { rail: 'right', player: 'bottom', name: 'Sidebar right, player below' },
    { rail: 'left', player: 'top', name: 'Sidebar left, player on top' },
    { rail: 'right', player: 'top', name: 'Sidebar right, player on top' },
  ];
  async function arrange(a) { await place('rail', a.rail); await place('player', a.player); }

  // ---- playback ----
  const SLEEP = [{ v: 0, name: 'Off' }, { v: 15, name: '15 min' }, { v: 30, name: '30 min' }, { v: 60, name: '1 hr' }, { v: 'song', name: 'End of song' }];
  let sleepPick = $state(sleep.endOfSong ? 'song' : 0);
  $effect(() => { if (!sleeping()) sleepPick = 0; });
  const over = $derived(0.06 + 0.54 * (prefs.xfade - XFADE.min) / (XFADE.max - XFADE.min));
  function xfade(v) { setPref('xfade', v); retime(); }

  // ---- library ----
  let store = $state(null), storeError = $state('');
  async function measure() {
    storeError = '';
    try { store = await api('/api/storage'); } catch (e) { storeError = e.message; }
  }
  onMount(measure);
  const size = (n) => {
    if (n == null) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
  };
  const parts = $derived(store ? [
    { k: 'music', name: 'Music', v: store.music },
    { k: 'covers', name: 'Covers', v: store.covers },
    { k: 'downloads', name: 'Downloads', v: store.downloads },
    { k: 'other', name: 'Tools and other', v: store.other },
  ].filter((p) => p.v > 0) : []);
  async function quit() {
    const ok = await ask({ kind: 'confirm', title: 'Quit Tokify?', text: 'The music stops on every device. Start it again with npm start on this computer.', confirm: 'Quit', danger: true });
    if (!ok) return;
    await api('/api/quit', { method: 'POST' }).catch(() => {});
    toast('Tokify is off. Start it again with npm start', { ms: 8000 });
  }

  // ---- plugins ----
  // While the tab is open, a plugin's status line (a download, a job) keeps itself fresh.
  $effect(() => {
    if (tab !== 'plugins') return;
    loadPlugins();
    const every = setInterval(() => { if (!document.hidden) loadPlugins(); }, 4000);
    return () => clearInterval(every);
  });
  const own = (p) => p.actions.filter((a) => a.scope === 'plugin');
  const songWide = (p) => p.actions.filter((a) => a.scope === 'song');

  // ---- keys ----
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
  const KEYS = [
    { keys: ['Space'], what: 'Play or pause', where: 'Anywhere but a text field' },
    { keys: ['F'], what: 'Lyrics full screen', where: 'Press again or Esc to leave' },
    { keys: ['/'], or: [mod, 'K'], what: 'Search', where: 'From any page' },
    { keys: ['Esc'], what: 'Close', where: 'The side panel, a menu, full screen' },
    { keys: ['['], or: [']'], what: 'Cut while trimming', where: 'Before or after the playhead' },
  ];
</script>

<!-- A model of this Tokify, drawn with its own settings. -->
{#snippet model(rail, top, big)}
  <span class="model" class:right={rail === 'right'} class:top class:big style="--room:{room?.color || '#3a3f55'}">
    {#if room?.cover}<canvas class="m-light" width={SIZE} height={SIZE} use:blurred={room.cover}></canvas>{/if}
    <span class="m-veil"></span>
    <span class="m-rail"><i class="m-home"></i><i class="m-gear"></i>{#each shelf as c}<span class="m-pl">{#if c}<img src={c} alt="" />{/if}</span>{/each}</span>
    <span class="m-page">
      <span class="m-hero"><span class="m-art">{#if now?.cover}<img src={now.cover} alt="" />{/if}</span><span class="m-title"><i></i><i></i><span class="m-play"></span></span></span>
      <i class="m-row"></i><i class="m-row s"></i><i class="m-row"></i><i class="m-row m"></i><i class="m-row s"></i>
    </span>
    {#if big}<span class="m-sheet"><i class="m-sh-t"></i><i></i><i></i><i class="m-sw"><b></b></i></span>{/if}
    <span class="m-bar"><span class="m-dot"></span><span class="m-prog"><i></i></span></span>
  </span>
{/snippet}

<div class="settings">
  <header class="head">
    <h1>Settings</h1>
    <div class="tabs" role="tablist" aria-label="Settings">
      <span class="lit" style="transform:translateX({pad.x}px); width:{pad.w}px" aria-hidden="true"></span>
      {#each TABS as t}
        <button bind:this={tabEls[t.id]} class:desk={t.desk} class:on={tab === t.id} role="tab" aria-selected={tab === t.id} onclick={() => open(t.id)}>{t.name}</button>
      {/each}
    </div>
  </header>

  {#key tab}
    <div class="pane-wrap" role="tabpanel" in:swap>
      {#if tab === 'look'}
        <div class="look">
          <div class="studio">
            {@render model(layout.rail, layout.player === 'top', true)}
            <p class="caption">Everything you change here changes the whole app at once.</p>
          </div>
          <div class="dials">
            <div class="block">
              <div class="bh"><h3>Accent</h3><span class="v">{chosen?.name}</span></div>
              <div class="swatches" role="radiogroup" aria-label="Accent">
                {#each ACCENTS as a}
                  {#if a.id === 'custom'}
                    <label class="sw custom" class:on={prefs.accent === 'custom'} style="--sw:{prefs.custom}" aria-label="Your own colour">
                      <input type="color" value={prefs.custom} oninput={pickCustom} onclick={() => setPref('accent', 'custom')} />
                      <span class="glyph" style="color:{prefs.accent === 'custom' ? 'var(--on-accent)' : '#000'}"><Icon name={prefs.accent === 'custom' ? 'play' : 'plus'} size={13} /></span>
                    </label>
                  {:else}
                    <button class="sw" class:cover={a.id === 'cover'} class:on={prefs.accent === a.id} role="radio" aria-checked={prefs.accent === a.id}
                      aria-label={a.id === 'cover' ? 'From the cover: follows the song that plays' : a.name}
                      style="--sw:{a.hex || coverTint(now?.color)}" onclick={() => setPref('accent', a.id)}>
                      {#if a.id === 'cover' && now?.cover}<img src={now.cover} alt="" />{/if}
                      <span class="glyph"><Icon name="play" size={13} /></span>
                    </button>
                  {/if}
                {/each}
              </div>
            </div>

            <div class="block">
              <div class="bh"><h3>Cover light</h3><span class="v">{pct(prefs.light)}</span></div>
              <Fader value={prefs.light} min={RANGE.light.min} max={RANGE.light.max} step={0.01} reset={1} label="Cover light"
                valuetext={pct(prefs.light)} onchange={(v) => setPref('light', v)} />
            </div>

            <div class="block">
              <div class="bh"><h3>Glass</h3><span class="v">Sidebar, player, side panel</span></div>
              <div class="pair">
                <div class="dial"><span class="dl">Tint <b>{pct(prefs.tint)}</b></span>
                  <Fader value={prefs.tint} min={RANGE.tint.min} max={RANGE.tint.max} step={0.01} reset={0.5} label="Glass tint"
                    valuetext={pct(prefs.tint)} onchange={(v) => setPref('tint', v)} /></div>
                <div class="dial"><span class="dl">Frost <b>{Math.round(prefs.frost)}</b></span>
                  <Fader value={prefs.frost} min={RANGE.frost.min} max={RANGE.frost.max} step={1} reset={24} label="Glass frost"
                    valuetext="{Math.round(prefs.frost)} pixels of blur" onchange={(v) => setPref('frost', v)} /></div>
              </div>
            </div>

            <div class="block">
              <div class="bh"><h3>Corners</h3><span class="v corner-v"><span class="corner" aria-hidden="true"></span>{prefs.corners === 0 ? 'Square' : pct(prefs.corners)}</span></div>
              <Fader value={prefs.corners} min={RANGE.corners.min} max={RANGE.corners.max} step={0.05} reset={1} marks={[1]} label="Corners"
                valuetext={pct(prefs.corners)} onchange={(v) => setPref('corners', v)} />
            </div>

            <div class="block row">
              <div>
                <h3>Lighter effects</h3>
                <p>For slower computers and older phones: the cover light stands still and blurs become simple fades.</p>
                {#if perf.fps && perf.fps < 40 && !perf.lite}<p class="note">This device managed about {perf.fps} frames a second.</p>{/if}
              </div>
              <button class="switch" class:on={perf.lite} role="switch" aria-checked={perf.lite} aria-label="Lighter effects" onclick={() => setLite(!perf.lite)}><i></i></button>
            </div>

            {#if lookChanged() || perf.lite}
              <button class="btn quiet reset" onclick={reset}><Icon name="undo" size={17} />Back to the original look</button>
            {/if}
          </div>
        </div>

      {:else if tab === 'layout'}
        <div class="arrange" role="radiogroup" aria-label="Arrangement">
          {#each ARRANGEMENTS as a}
            {@const on = layout.rail === a.rail && layout.player === a.player}
            <button class="arr" class:on role="radio" aria-checked={on} onclick={() => arrange(a)}>
              {@render model(a.rail, a.player === 'top', false)}
              <span class="arr-name">{#if on}<Icon name="check" size={16} />{/if}{a.name}</span>
            </button>
          {/each}
        </div>
        <p class="caption wide">You can also drag the sidebar or the player by any empty part, or click its grip.</p>

      {:else if tab === 'playback'}
        <div class="play">
          <div class="block xf">
            <div class="bh"><h3>Crossfade</h3><span class="v">{prefs.xfade} s</span></div>
            <p>How long one song melts into the next, in playlists that end songs with Crossfade.</p>
            <div class="lanes" style="--o:{over}" aria-hidden="true">
              <span class="lane a"><span class="t">{now?.title || 'This song'}</span></span>
              <span class="lane b"><span class="t">The next one</span></span>
              <span class="span"><b>{prefs.xfade} s</b></span>
            </div>
            <Fader value={prefs.xfade} min={XFADE.min} max={XFADE.max} step={0.5} marks={[XFADE.def]} reset={XFADE.def} label="Crossfade"
              valuetext="{prefs.xfade} seconds" onchange={xfade} />
          </div>

          <div class="block sleep" class:running={sleeping()}>
            <div class="bh"><h3>Sleep timer</h3>{#if sleeping()}<span class="v moon"><Icon name="moon" size={16} /></span>{/if}</div>
            <p class="count" aria-live="polite">
              {#if sleep.endOfSong}<b>End of song</b><span>then the music pauses</span>
              {:else if sleep.until}<b>{clock(sleepLeft())}</b><span>then the music pauses</span>
              {:else}<b class="off">Off</b><span>Pauses the music after a while</span>{/if}
            </p>
            <div class="seg" role="radiogroup" aria-label="Sleep timer">
              {#each SLEEP as o}
                <button class:active={sleepPick === o.v} role="radio" aria-checked={sleepPick === o.v}
                  disabled={o.v === 'song' && !player.trackId} onclick={() => { sleepPick = o.v; setSleep(o.v); }}>{o.name}</button>
              {/each}
            </div>
          </div>

          <button class="block sound" onclick={() => { ui.soundTrackId = null; ui.soundOpen = true; }}>
            <div class="bh"><h3>Sound</h3><Icon name="sound" size={20} /></div>
            <b class="big">{soundName(sound)}</b>
            <p>Speed, bass, reverb and the equaliser, for every song or just one.</p>
          </button>
        </div>

      {:else if tab === 'library'}
        <div class="lib">
          <div class="block disk" class:loading={!store && !storeError}>
            <div class="bh"><h3>On this computer</h3><span class="v">{songs(songCount)} · {plural(lib.playlists.length, 'playlist')}</span></div>
            {#if storeError}
              <p class="error">{storeError} <button class="btn quiet sm" onclick={measure}>Try again</button></p>
            {:else}
              <p class="total"><b>{store ? size(store.total) : '…'}</b><span>in Tokify’s data folder{#if store?.free != null}{' '}· {size(store.free)} free on this disk{/if}</span></p>
              <div class="bar">{#each parts as p}<i class={p.k} style="flex-grow:{p.v}"></i>{/each}</div>
              <ul class="legend">{#each parts as p}<li><i class={p.k}></i>{p.name}<span>{size(p.v)}</span></li>{/each}</ul>
            {/if}
          </div>
          <div class="block row">
            <div><h3>Search history</h3><p>{search.recent.length ? `${plural(search.recent.length, 'recent search', 'recent searches')} in this browser.` : 'Nothing remembered.'}</p></div>
            <button class="btn ghost icon" aria-label="Forget recent searches" disabled={!search.recent.length} onclick={forgetAll}><Icon name="trash" size={19} /></button>
          </div>
          <div class="block row">
            <div><h3>Quit Tokify</h3><p>Stops the server on this computer.</p></div>
            <button class="btn ghost icon off" aria-label="Quit Tokify" onclick={quit}><Icon name="power" size={19} /></button>
          </div>
        </div>

      {:else if tab === 'plugins'}
        <div class="plugs">
          {#if plugins.error && !plugins.list.length}
            <p class="error">{plugins.error} <button class="btn quiet sm" onclick={loadPlugins}>Try again</button></p>
          {:else if plugins.loaded && !plugins.list.length}
            <div class="block empty">
              <span class="plug-mark" aria-hidden="true"><Icon name="plug" size={26} /></span>
              <h3>No plugins yet</h3>
              <p>A plugin is a folder in <code>plugins/</code> next to Tokify. Put one there and restart Tokify to see it here.</p>
            </div>
          {/if}
          {#each plugins.list as p (p.id)}
            <article class="block plug" class:on={p.active} class:broken={p.broken || p.error}>
              <div class="plug-head">
                <span class="plug-mark" aria-hidden="true"><Icon name="plug" size={22} /></span>
                <div class="plug-name">
                  <h3>{p.name}</h3>
                  <span class="v">{#if p.broken}Can’t be read{:else}{p.version}{#if p.bytes} · {size(p.bytes)} on disk{/if}{/if}</span>
                </div>
                {#if !p.broken}
                  <button class="switch" class:on={p.enabled} role="switch" aria-checked={p.enabled} aria-label="{p.name} on" onclick={() => setPluginOn(p.id, !p.enabled)}><i></i></button>
                {/if}
              </div>
              {#if p.description}<p>{p.description}</p>{/if}
              {#if p.broken || p.error}<p class="error" role="alert">{p.broken || p.error}</p>{/if}
              {#if p.status}
                <div class="plug-status" role="status">
                  <span>{p.status.text}</span>
                  {#if p.status.progress != null}<span class="meter"><i style="width:{Math.round(p.status.progress * 100)}%"></i></span>{/if}
                </div>
              {/if}

              {#if p.active && (p.settings.length || own(p).length)}
                <div class="plug-body">
                  {#each p.settings as s (s.key)}
                    {#if s.type === 'toggle'}
                      <div class="opt row">
                        <span class="ol">{s.label || s.key}{#if s.help}<small>{s.help}</small>{/if}</span>
                        <button class="switch" class:on={p.values[s.key]} role="switch" aria-checked={!!p.values[s.key]} aria-label={s.label || s.key}
                          onclick={() => setPluginSetting(p.id, s.key, !p.values[s.key])}><i></i></button>
                      </div>
                    {:else if s.type === 'choice'}
                      <div class="opt">
                        <span class="ol">{s.label || s.key}{#if s.help}<small>{s.help}</small>{/if}</span>
                        <div class="seg" role="radiogroup" aria-label={s.label || s.key}>
                          {#each s.options || [] as o}
                            <button class:active={p.values[s.key] === o} role="radio" aria-checked={p.values[s.key] === o} onclick={() => setPluginSetting(p.id, s.key, o)}>{o}</button>
                          {/each}
                        </div>
                      </div>
                    {:else if s.type === 'number'}
                      <div class="opt">
                        <span class="ol dl">{s.label || s.key}<b>{p.values[s.key]}{s.unit ? ` ${s.unit}` : ''}</b></span>
                        <Fader value={p.values[s.key]} min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} reset={s.default} label={s.label || s.key}
                          valuetext="{p.values[s.key]}{s.unit ? ` ${s.unit}` : ''}" onchange={(v) => setPluginSetting(p.id, s.key, v)} />
                      </div>
                    {:else}
                      <label class="opt">
                        <span class="ol">{s.label || s.key}{#if s.help}<small>{s.help}</small>{/if}</span>
                        <input class="input" value={p.values[s.key]} placeholder={s.placeholder || ''} oninput={(e) => setPluginSetting(p.id, s.key, e.currentTarget.value)} />
                      </label>
                    {/if}
                  {/each}
                  {#if own(p).length}
                    <div class="plug-acts">
                      {#each own(p) as a (a.id)}
                        <button class="btn quiet sm" disabled={plugins.busy[`${p.id}/${a.id}`]} onclick={() => runPluginAction(p.id, a.id)}>{plugins.busy[`${p.id}/${a.id}`] ? 'Working…' : a.label}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if p.active && songWide(p).length}
                <p class="hint">Adds {songWide(p).map((a) => `“${a.label}”`).join(', ')} to every song’s menu.</p>
              {/if}
            </article>
          {/each}
        </div>
        {#if plugins.list.length}<p class="caption wide">Plugins live in the <code>plugins/</code> folder and run with full access to this computer. Add only ones you trust.</p>{/if}

      {:else if tab === 'keys'}
        <ul class="keys">
          {#each KEYS as k}
            <li class="block">
              <span class="caps">{#each k.keys as c}<kbd>{c}</kbd>{/each}{#if k.or}<span class="or">or</span>{#each k.or as c}<kbd>{c}</kbd>{/each}{/if}</span>
              <span class="kw"><b>{k.what}</b><span>{k.where}</span></span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/key}

  <p class="foot">Tokify {version} · saved in this browser</p>
</div>

<style>
  .settings { box-sizing: border-box; width: 100%; padding: 32px 16px 64px; max-width: 1180px; margin: 0 auto; }

  /* ---- the head: the title and the tabs, a lit pad sliding between them ---- */
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 28px; }
  h1 { margin: 0; font-size: clamp(32px, 4vw, 48px); line-height: 1.05; font-weight: 800; letter-spacing: -.03em; }
  .tabs { position: relative; display: flex; gap: 2px; padding: 4px; border-radius: calc(var(--r-control) + 4px); background: var(--fill-1); }
  .tabs button {
    position: relative; z-index: 1; min-height: 40px; padding: 6px 18px; border: none; border-radius: var(--r-control); background: none; cursor: pointer;
    font: inherit; font-size: 15px; font-weight: 600; color: var(--muted); white-space: nowrap; transition: color .2s;
  }
  .tabs button:hover { color: var(--text); }
  .tabs button.on { color: var(--on-primary); }
  .lit {
    position: absolute; left: 0; top: 4px; bottom: 4px; border-radius: var(--r-control); background: var(--primary);
    box-shadow: 0 4px 14px rgba(0, 0, 0, .25); transition: transform .42s var(--ease), width .42s var(--ease);
  }

  /* ---- blocks: each setting its own piece ---- */
  .block {
    display: grid; gap: 14px; align-content: start; padding: 20px 22px 22px; border: none; border-radius: var(--r-item);
    background: var(--fill-1); color: inherit; font: inherit; text-align: left;
  }
  .block.row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 20px; }
  .bh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h3 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .v { font-size: 14px; font-weight: 500; color: var(--faint); font-variant-numeric: tabular-nums; text-align: right; }
  .block p { margin: 0; font-size: 15px; line-height: 1.45; color: var(--muted); max-width: 56ch; }
  .block .note { color: var(--text); margin-top: 6px; }
  .block.row h3 + p { margin-top: 4px; }
  .caption { margin: 0; font-size: 14px; color: var(--faint); }
  .caption.wide { margin-top: 18px; }
  .error { margin: 0; font-size: 14px; color: var(--danger) !important; display: flex; align-items: center; gap: 8px; }

  /* ---- Look: the studio ---- */
  .look { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(340px, 1fr); gap: 20px; align-items: start; }
  .studio { position: sticky; top: 16px; display: grid; gap: 12px; }
  .dials { display: grid; gap: 10px; }
  .reset { justify-self: start; gap: 8px; font-size: 14px; }

  .swatches { display: grid; grid-template-columns: repeat(8, 36px); justify-content: space-between; gap: 8px; }
  .sw {
    position: relative; width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%; cursor: pointer; overflow: hidden;
    background: var(--sw); color: #000; display: grid; place-items: center; box-shadow: 0 3px 10px rgba(0, 0, 0, .3);
    transition: transform .2s var(--ease), box-shadow .2s var(--ease);
  }
  .sw:hover { transform: scale(1.08); }
  .sw:active { transform: scale(.94); }
  .sw.on { box-shadow: 0 0 0 2px var(--ground), 0 0 0 4px rgba(255, 255, 255, .9); }
  .sw .glyph { position: relative; display: grid; place-items: center; margin-left: 2px; pointer-events: none; }
  .sw.on .glyph { animation: pop .35s var(--ease); }
  @keyframes pop { 40% { transform: scale(1.35); } }
  .sw.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .sw.cover .glyph { width: 21px; height: 21px; margin: 0; border-radius: 50%; background: var(--sw); padding-left: 2px; }
  .sw.custom:not(.on) { background: conic-gradient(from 200deg, #ff8a8a, #ffd796, #a6f0cf, #a9d8ff, #cdbdff, #ffb8cb, #ff8a8a); }
  .sw.custom:not(.on) .glyph { margin: 0; width: 21px; height: 21px; border-radius: 50%; background: rgba(255, 255, 255, .85); }
  .sw.custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
  .sw.custom:focus-within { outline: 2px solid rgba(255, 255, 255, .7); outline-offset: 3px; }

  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .dial { display: grid; gap: 12px; }
  .dl { font-size: 15px; color: var(--muted); display: flex; justify-content: space-between; }
  .dl b { font-weight: 500; color: var(--faint); font-variant-numeric: tabular-nums; }
  .corner-v { display: inline-flex; align-items: center; gap: 8px; }
  .corner { width: 16px; height: 16px; border-top: 2px solid var(--muted); border-left: 2px solid var(--muted); border-top-left-radius: var(--r-item); transition: border-radius .2s; }

  /* The model: rail, page, side panel and player, with the real cover light, glass, accent and corners. */
  .model {
    --m: 7px; --rw: 22px; --bh: 20px; position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; overflow: hidden; isolation: isolate;
    border-radius: calc(var(--r-island) * .8 + 2px); background: var(--ground);
    box-shadow: 0 22px 50px -18px color-mix(in srgb, var(--room) 50%, rgba(0, 0, 0, .7)), var(--shadow-art);
  }
  .model.big { --m: 12px; --rw: 40px; --bh: 36px; border-radius: calc(var(--r-island) + 4px); }
  .m-light { position: absolute; left: -20%; top: -30%; width: 140%; height: 160%; z-index: -1; opacity: 0; transition: opacity .6s; }
  .model :global(.m-light.ready) { opacity: var(--ambient-strength); transition: opacity .2s; }
  .m-veil { position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(7, 7, 8, .25), rgba(7, 7, 8, .55)); }
  .m-rail, .m-bar, .m-sheet {
    position: absolute; background: var(--island);
    -webkit-backdrop-filter: blur(calc(var(--glass-blur) * .5)) saturate(1.5); backdrop-filter: blur(calc(var(--glass-blur) * .5)) saturate(1.5);
    border-radius: calc(var(--r-island) * .55);
    transition: left .42s var(--ease), right .42s var(--ease), top .42s var(--ease), bottom .42s var(--ease);
  }
  .m-rail { top: var(--m); bottom: var(--m); left: var(--m); width: var(--rw); display: flex; flex-direction: column; align-items: center; gap: calc(var(--rw) * .16); padding: calc(var(--rw) * .28) 0; }
  .right .m-rail { left: calc(100% - var(--m) - var(--rw)); }
  .m-home, .m-gear { width: 40%; height: calc(var(--rw) * .12); border-radius: 2px; background: rgba(255, 255, 255, .7); }
  .m-gear { background: rgba(255, 255, 255, .35); margin-bottom: calc(var(--rw) * .12); }
  .m-pl { width: 62%; aspect-ratio: 1; border-radius: calc(var(--r-xs) * .5); overflow: hidden; background: var(--fill-2); }
  .m-pl img, .m-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .m-page {
    position: absolute; left: calc(var(--m) * 2 + var(--rw)); right: var(--m); top: calc(var(--m) * 1.6); display: grid; gap: calc(var(--rw) * .22);
    transition: left .42s var(--ease), right .42s var(--ease), top .42s var(--ease);
  }
  .big .m-page { right: 36%; }
  .right .m-page { left: var(--m); right: calc(var(--m) * 2 + var(--rw)); }
  .big.right .m-page { left: 36%; }
  .top .m-page { top: calc(var(--m) * 2.6 + var(--bh)); }
  .m-hero { display: flex; align-items: flex-end; gap: calc(var(--rw) * .35); margin-bottom: calc(var(--rw) * .2); }
  .m-art { width: calc(var(--rw) * 1.6); aspect-ratio: 1; flex: none; border-radius: calc(var(--r-xs) * .6); overflow: hidden; background: var(--fill-2); box-shadow: 0 3px 8px rgba(0, 0, 0, .35); }
  .m-title { flex: 1; display: grid; gap: calc(var(--rw) * .14); }
  .m-title i { height: calc(var(--rw) * .2); width: 64%; border-radius: 2px; background: rgba(255, 255, 255, .85); }
  .m-title i + i { height: calc(var(--rw) * .12); width: 40%; background: rgba(255, 255, 255, .35); }
  .m-play { width: calc(var(--rw) * .5); aspect-ratio: 1; border-radius: 50%; background: var(--accent); margin-top: calc(var(--rw) * .1); }
  .m-row { height: calc(var(--rw) * .14); width: 90%; border-radius: 2px; background: rgba(255, 255, 255, .2); }
  .m-row.s { width: 62%; } .m-row.m { width: 76%; }
  .m-sheet {
    top: var(--m); bottom: calc(var(--m) * 2 + var(--bh)); right: var(--m); width: 30%; padding: 12px; display: grid; align-content: start; gap: 8px;
  }
  .right .m-sheet { right: auto; left: var(--m); }
  .top .m-sheet { top: calc(var(--m) * 2 + var(--bh)); bottom: var(--m); }
  .m-sheet i { height: 5px; border-radius: 2px; background: rgba(255, 255, 255, .3); width: 80%; }
  .m-sheet .m-sh-t { height: 7px; width: 55%; background: rgba(255, 255, 255, .85); margin-bottom: 4px; }
  .m-sheet .m-sw { position: relative; width: 26px; height: 15px; margin-top: 6px; border-radius: 8px; background: var(--accent); }
  .m-sw b { position: absolute; right: 2px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--on-accent); }
  .m-bar {
    left: calc(var(--m) * 2 + var(--rw)); right: var(--m); bottom: var(--m); height: var(--bh);
    display: flex; align-items: center; justify-content: center;
  }
  .right .m-bar { left: var(--m); right: calc(var(--m) * 2 + var(--rw)); }
  .top .m-bar { bottom: calc(100% - var(--m) - var(--bh)); }
  .m-dot { width: calc(var(--bh) * .48); aspect-ratio: 1; border-radius: 50%; background: var(--accent); }
  .m-prog { position: absolute; left: 24%; right: 24%; bottom: calc(var(--bh) * .16); height: 2px; border-radius: 1px; background: rgba(255, 255, 255, .2); }
  .m-prog i { position: absolute; inset: 0 62% 0 0; border-radius: inherit; background: var(--accent); }

  /* ---- Layout: four arrangements ---- */
  .arrange { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .arr {
    display: grid; gap: 14px; padding: 12px 12px 16px; border: none; border-radius: calc(var(--r-item) + 4px); background: var(--fill-1); cursor: pointer;
    color: var(--muted); font: inherit; font-size: 16px; font-weight: 500; text-align: left; transition: background .15s, color .15s, box-shadow .2s, transform .2s var(--ease);
  }
  .arr:hover { background: var(--fill-2); color: var(--text); }
  .arr:active { transform: scale(.985); }
  .arr.on { color: var(--text); background: var(--fill-2); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .7); }
  .arr .model { --m: 9px; --rw: 26px; --bh: 24px; }
  .arr-name { display: flex; align-items: center; gap: 8px; padding-left: 4px; }

  /* ---- Playback ---- */
  .play { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .xf { grid-column: 1 / -1; }
  .lanes { position: relative; height: 80px; margin: 6px 0 4px; }
  .lane {
    position: absolute; height: 30px; border-radius: var(--r-control); display: flex; align-items: center; padding: 0 12px; overflow: hidden;
    background: repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 5px);
    transition: left .3s var(--ease), right .3s var(--ease);
  }
  .lane .t { position: relative; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2px 8px; border-radius: 6px; background: rgba(0, 0, 0, .55); }
  /* This song fades out across the overlap; the next one fades in under it. */
  .lane.a { top: 0; left: 0; right: calc(50% - var(--o) * 50%); color: rgba(255, 255, 255, .45);
    -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 100% * var(--o) / (.5 + var(--o) / 2)), rgba(0, 0, 0, .12));
    mask-image: linear-gradient(90deg, #000 calc(100% - 100% * var(--o) / (.5 + var(--o) / 2)), rgba(0, 0, 0, .12)); }
  .lane.b { bottom: 0; right: 0; left: calc(50% - var(--o) * 50%); color: color-mix(in srgb, var(--accent) 70%, transparent); justify-content: flex-end;
    -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, .12), #000 calc(100% * var(--o) / (.5 + var(--o) / 2)));
    mask-image: linear-gradient(90deg, rgba(0, 0, 0, .12), #000 calc(100% * var(--o) / (.5 + var(--o) / 2))); }
  .span {
    position: absolute; top: 32px; bottom: 32px; left: calc(50% - var(--o) * 50%); right: calc(50% - var(--o) * 50%);
    display: grid; place-items: center; border-left: 1px solid rgba(255, 255, 255, .5); border-right: 1px solid rgba(255, 255, 255, .5);
    transition: left .3s var(--ease), right .3s var(--ease);
  }
  .span::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: rgba(255, 255, 255, .3); }
  .span b { position: relative; padding: 0 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }

  .count { display: grid; gap: 2px; }
  .count b { font-size: 36px; line-height: 1.1; font-weight: 800; letter-spacing: -.02em; color: var(--text); font-variant-numeric: tabular-nums; }
  .count b.off { color: var(--faint); }
  .count span { font-size: 15px; color: var(--muted); }
  .moon { color: var(--accent); display: inline-flex; }
  .sleep.running { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
  .sleep .seg button { font-size: 14px; min-height: 36px; }
  .seg button:disabled { opacity: .4; cursor: not-allowed; }
  .sound { cursor: pointer; transition: background .15s; }
  .sound:hover { background: var(--fill-2); }
  .sound .bh :global(svg) { color: var(--muted); }
  .sound:hover .bh :global(svg) { color: var(--text); }
  .big { font-size: 28px; line-height: 1.15; font-weight: 800; letter-spacing: -.02em; }

  /* ---- Library ---- */
  .lib { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .disk { grid-column: 1 / -1; }
  .total { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
  .total b { font-size: 44px; line-height: 1; font-weight: 800; letter-spacing: -.03em; color: var(--text); font-variant-numeric: tabular-nums; }
  .bar { display: flex; gap: 3px; height: 14px; border-radius: 7px; overflow: hidden; background: var(--fill-1); }
  .bar i { flex-basis: 0; min-width: 4px; border-radius: 3px; transition: flex-grow .6s var(--ease); }
  .music { background: var(--accent); }
  .covers { background: rgba(255, 255, 255, .55); }
  .downloads { background: rgba(255, 255, 255, .32); }
  .other { background: rgba(255, 255, 255, .16); }
  .loading .bar { animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: .45; } }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; padding: 0; list-style: none; font-size: 15px; color: var(--muted); }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .legend li > i { width: 10px; height: 10px; border-radius: 3px; }
  .legend span { color: var(--faint); font-variant-numeric: tabular-nums; }
  .off:hover:not(:disabled) { color: var(--danger); }

  /* ---- Plugins: each one a block, its settings drawn by Tokify from its plugin.json ---- */
  .plugs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
  .plug { transition: box-shadow .2s; }
  .plug.on { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
  .plug-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; }
  .plug-mark {
    width: 44px; height: 44px; display: grid; place-items: center; border-radius: var(--r-control);
    background: var(--fill-2); color: var(--faint); transition: color .2s, background .2s;
  }
  .plug.on .plug-mark { color: var(--on-accent); background: var(--accent); }
  .plug-name { display: grid; gap: 2px; min-width: 0; }
  .plug-name .v { text-align: left; }
  .plug-status { display: grid; gap: 8px; font-size: 14px; color: var(--text); }
  .meter { height: 6px; border-radius: 3px; background: var(--fill-2); overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 3px; background: var(--accent); transition: width .4s var(--ease); }
  .plug-body { display: grid; gap: 18px; padding-top: 16px; margin-top: 2px; border-top: 1px solid var(--edge); }
  .opt { display: grid; gap: 10px; }
  .opt.row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; }
  .ol { display: grid; gap: 3px; font-size: 15px; color: var(--text); }
  .ol small { font-size: 14px; color: var(--muted); }
  .ol.dl { display: flex; color: var(--text); }
  .plug-acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .plug-acts .btn { background: var(--fill-2); }
  .plug-acts .btn:hover:not(:disabled) { background: var(--fill-3); }
  .hint { font-size: 14px !important; color: var(--faint) !important; }
  .empty { grid-column: 1 / -1; justify-items: start; }
  .settings code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .9em; padding: 1px 5px; border-radius: 4px; background: var(--fill-2); }

  /* ---- Keys ---- */
  .keys { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .keys .block { grid-template-columns: 140px minmax(0, 1fr); align-items: center; gap: 16px; }
  .caps { display: flex; align-items: center; gap: 6px; }
  kbd {
    min-width: 40px; height: 38px; padding: 0 11px; display: inline-grid; place-items: center; border-radius: calc(var(--r-control) * .9);
    font: inherit; font-size: 15px; font-weight: 600; color: var(--text);
    background: var(--fill-2); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .35), inset 0 0 0 1px var(--edge);
  }
  .or { font-size: 14px; color: var(--faint); }
  .kw { display: grid; gap: 3px; }
  .kw b { font-size: 16px; font-weight: 600; }
  .kw span { font-size: 14px; color: var(--muted); }

  .foot { margin: 40px 0 0; font-size: 13px; color: var(--faint); }

  @media (max-width: 1000px) {
    .look { grid-template-columns: minmax(0, 1fr); }
    .studio { position: relative; top: 0; }
    .keys { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .settings { padding: 20px 16px 40px; }
    .head { margin-bottom: 18px; }
    .desk { display: none; }
    .tabs { width: 100%; }
    .tabs button { flex: 1; padding-inline: 8px; }
    .caption { display: none; }
    .model.big { --m: 8px; --rw: 26px; --bh: 24px; }
    .m-sheet { padding: 7px; gap: 5px; }
    .swatches { grid-template-columns: repeat(8, minmax(0, 36px)); gap: 6px; }
    .sw { width: 100%; height: auto; aspect-ratio: 1; }
    .pair { grid-template-columns: minmax(0, 1fr); gap: 18px; }
    .play, .lib, .plugs { grid-template-columns: minmax(0, 1fr); }
    .block { padding: 18px; }
    .total b { font-size: 34px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .lit, .lane, .span, .m-rail, .m-bar, .m-page, .m-sheet { transition: none; }
  }
</style>

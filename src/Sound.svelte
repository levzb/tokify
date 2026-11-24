<script>
  // How the music sounds, in the one panel: a preset with one tap, or speed, bass, reverb, 8D and a
  // 5-band equaliser by hand, for all songs or for one song only. Everything applies live (src/sound.svelte.js)
  // and is remembered; a sound made by hand can be saved as your own preset; downloads can take it along.
  // Opened from the player it follows the song that plays; from a song's menu it stays on that song.
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import { scale } from 'svelte/transition';
  import Modal from './Modal.svelte';
  import Fader from './Fader.svelte';
  import Cover from './Cover.svelte';
  import { lib, ui, toast } from './state.svelte.js';
  import { player } from './player.svelte.js';
  import {
    sound, scope, edited, ownSound, setSound, usePreset, resetSound, forgetSongSound,
    mine, mineOf, soundName, canSave, nextName, savePreset, deletePreset, NAME_MAX, MINE_MAX,
  } from './sound.svelte.js';
  import { PRESETS, EQ_PRESETS, EQ_BANDS, EQ_MAX, SPEED, BASS_MAX, BASS_HZ, presetOf, eqPresetOf } from '../server/effects.js';

  // The song this panel can tune on its own: the one from a song's menu, else the one playing.
  const song = $derived(lib.tracks[ui.soundTrackId || player.trackId] || null);
  const cur = $derived(edited());
  // All songs: a small fan of covers from the library.
  const fan = $derived(Object.values(lib.tracks).filter((t) => t.cover && t.status === 'ok').slice(0, 3).map((t) => t.cover));
  const own = $derived(song ? ownSound(song.id) : null);
  const preset = $derived(presetOf(cur));
  const yours = $derived(mineOf(cur));
  const eqPreset = $derived(eqPresetOf(cur.eq));
  const close = () => { ui.soundOpen = false; ui.soundTrackId = null; };

  // Opening: on the song when it has a sound of its own (or was picked from its menu), else on all songs.
  // Opened from the player, a new song coming on takes the song side over.
  let wasOpen = false;
  $effect(() => {
    const open = ui.soundOpen, id = song?.id || null;
    if (open && !wasOpen) scope.trackId = id && (ui.soundTrackId || ownSound(id)) ? id : null;
    else if (open && scope.trackId && id && scope.trackId !== id) scope.trackId = id;
    if (!open) scope.trackId = null;
    wasOpen = open;
  });

  // Your presets live in one row under the built-in tiles: a dropdown of what you saved, and a button that
  // saves the sound you made (it turns the row into a name field).
  let naming = $state(false), name = $state(''), listing = $state(false), yoursEl = $state();
  function startNaming() { name = nextName(); naming = true; listing = false; }
  function pick(p) { setSound(p.s); listing = false; }
  function yoursKey(e) { if (e.key === 'Escape' && listing) { e.preventDefault(); listing = false; } }
  function outside(e) { if (listing && yoursEl && !yoursEl.contains(e.target)) listing = false; }
  const saveHint = $derived(canSave(cur) ? 'Save this sound as a preset' : mine.length >= MINE_MAX ? `Up to ${MINE_MAX} presets` : mineOf(cur) ? 'Already saved' : 'Change the sound first');
  function save(e) { e.preventDefault(); savePreset(name); naming = false; }
  function nameKey(e) { if (e.key === 'Escape') { e.preventDefault(); naming = false; } }
  function remove(p) {
    const undo = deletePreset(p.id);
    toast(`Deleted “${p.name}”`, { action: 'Undo', onAction: undo });
  }
  $effect(() => { if (!canSave(cur)) naming = false; });
  $effect(() => { if (!mine.length) listing = false; });

  // Each preset draws what it does; the chosen one moves while music plays.
  const BARS = {
    original: [35, 60, 90, 55, 75, 40, 25],
    slowed: [30, 55, 85, 60, 38],
    spedup: [30, 55, 80, 95, 70, 85, 50, 65, 35],
    nightcore: [45, 80, 60, 100, 75, 95, 55, 85, 40],
    bass: [100, 88, 42, 26, 18],
  };

  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const speedText = $derived(`${cur.speed.toFixed(2)}×`);
  const speedNote = $derived(cur.speed === 1 ? 'Normal speed'
    : cur.keepPitch ? (cur.speed < 1 ? 'Slower, same pitch' : 'Faster, same pitch')
    : cur.speed < 1 ? 'Slower and deeper, like a record' : 'Faster and higher, like a record');
  const room = (r) => (r === 0 ? 'Off' : r < 0.25 ? 'Room' : r < 0.6 ? 'Hall' : 'Cathedral');

  // The equaliser's curve: the tone you hear, bass included, eased so a preset sweeps into place.
  const tone = new Tween({ eq: [...cur.eq], bass: cur.bass }, { duration: 320, easing: cubicOut });
  $effect(() => { tone.target = { eq: [...cur.eq], bass: cur.bass }; });
  const RATIO = (EQ_BANDS.at(-1).f / EQ_BANDS[0].f) ** (1 / (EQ_BANDS.length - 1));
  function gainAt(x, { eq, bass }) {
    const f = EQ_BANDS[0].f * RATIO ** ((x - 0.1) / 0.2); // columns sit at 10%, 30% … 90%
    let db = 0;
    EQ_BANDS.forEach((b, i) => {
      const o = Math.log2(f / b.f), g = eq[i];
      if (!g) return;
      db += b.type === 'peaking' ? g * Math.exp(-(o * o) / 0.4) : b.type === 'lowshelf' ? g / (1 + Math.exp(o * 2.4)) : g / (1 + Math.exp(-o * 2.4));
    });
    if (bass) db += bass / (1 + Math.exp(Math.log2(f / BASS_HZ) * 2.4));
    return db;
  }
  // Points across a 100-wide box whose middle line is 0 dB: `mid` and `half` give its height.
  function line(t, n, mid, half) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n, y = mid - (gainAt(x, t) / EQ_MAX) * half;
      pts.push(`${(x * 100).toFixed(2)},${Math.min(mid + half - 1, Math.max(mid - half + 1, y)).toFixed(2)}`);
    }
    return pts.join(' ');
  }
  const curve = $derived(line(tone.current, 96, 50, 50));
</script>

<svelte:window onpointerdown={outside} />

{#if ui.soundOpen}
  <Modal label="Sound" title="Sound" lead={soundName(cur)} art={song?.cover || ''} closeLabel="Close sound" onclose={close}>
    <!-- The panel's head and foot stay put; everything between scrolls. -->
    <div class="sound-body scroll">
    <div class="scope" class:song={!!scope.trackId} role="radiogroup" aria-label="Change the sound of">
      <span class="scope-thumb" aria-hidden="true"></span>
      <button role="radio" aria-checked={!scope.trackId} onclick={() => (scope.trackId = null)}>
        <span class="scope-ico" aria-hidden="true">{#each fan as c (c)}<span><Cover src={c} size={24} radius={5} /></span>{/each}</span>
        <span class="scope-txt"><strong>All songs</strong><small>{soundName(sound)}</small></span>
      </button>
      <button role="radio" aria-checked={!!scope.trackId} disabled={!song} onclick={() => (scope.trackId = song.id)}
        data-tip={song ? `Only “${song.title}”` : 'Play a song to give it its own sound'}>
        <span class="scope-art"><Cover src={song?.cover || ''} size={34} radius={6} /></span>
        <span class="scope-txt"><strong>This song</strong><small>{own ? soundName(own) : song ? 'Same as all songs' : 'Nothing playing'}</small></span>
      </button>
    </div>

    <div class="presets" role="radiogroup" aria-label="Sound presets">
      {#each PRESETS as p (p.id)}
        <button class="preset" class:on={preset?.id === p.id} class:live={player.playing} role="radio" aria-checked={preset?.id === p.id}
          data-tip={p.hint} onclick={() => usePreset(p)}>
          <span class="glyph g-{p.id}" aria-hidden="true">
            {#if p.id === '8d'}<b class="head"></b><b class="ring"></b><b class="path"><b class="dot"></b></b>
            {:else}{#each BARS[p.id] as h, i (i)}<i style="--h:{h}%; --d:{-i * 0.17}s"></i>{/each}{/if}
          </span>
          <strong>{p.label}</strong>
        </button>
      {/each}
    </div>

    <div class="yours" bind:this={yoursEl} onkeydown={yoursKey} role="presentation">
      {#if naming}
        <form class="yours-row naming" onsubmit={save} in:scale={{ start: 0.96, duration: 240, easing: cubicOut }}>
          {@render tune(cur)}
          <input bind:value={name} maxlength={NAME_MAX} aria-label="Preset name" placeholder="Name" spellcheck="false" autocomplete="off"
            onkeydown={nameKey} {@attach (el) => { el.focus(); el.select(); }} />
          <button type="button" class="icon-btn sm" aria-label="Cancel" onclick={() => (naming = false)}><Icon name="x" size={16} /></button>
          <button type="submit" class="ok" aria-label="Save preset"><Icon name="check" size={16} stroke={2.6} /></button>
        </form>
      {:else}
        <div class="yours-row">
          <button class="pick" class:on={!!yours && !preset} aria-haspopup="listbox" aria-expanded={listing} disabled={!mine.length}
            onclick={() => (listing = !listing)}>
            {#if yours && !preset}{@render tune(yours.s)}{:else}<span class="pick-ico" aria-hidden="true"><Icon name="sound" size={16} /></span>{/if}
            <span class="pick-txt">
              <strong>{yours && !preset ? yours.name : 'Your presets'}</strong>
              <small>{mine.length ? `${mine.length} saved` : 'Make a sound, then save it here'}</small>
            </span>
            {#if mine.length}<span class="chev" aria-hidden="true"><Icon name="down" size={16} /></span>{/if}
          </button>
          <button class="save-btn" aria-label="Save as preset" data-tip={saveHint} disabled={!canSave(cur)} onclick={startNaming}>
            <Icon name="plus" size={18} />
          </button>
        </div>
      {/if}
      {#if listing}
        <div class="yours-menu frost" role="listbox" aria-label="Your presets" transition:scale={{ start: 0.97, duration: 160, easing: cubicOut }}>
          {#each mine as p (p.id)}
            {@const on = yours?.id === p.id && !preset}
            <div class="opt" class:on out:scale={{ start: 0.9, duration: 160 }}>
              <button class="opt-main" role="option" aria-selected={on} onclick={() => pick(p)}>
                {@render tune(p.s)}
                <span class="opt-name">{p.name}</span>
                {#if on}<span class="opt-check"><Icon name="check" size={15} stroke={2.6} /></span>{/if}
              </button>
              <button class="drop" aria-label="Delete preset “{p.name}”" onclick={() => remove(p)}><Icon name="x" size={14} /></button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <section class="group" aria-label="Speed">
      <div class="ctl">
        <div class="ctl-head"><span class="name">Speed</span><output class="val">{speedText}</output></div>
        <Fader value={cur.speed} min={SPEED.min} max={SPEED.max} step={0.01} center={1} marks={[0.75, 1, 1.25]}
          label="Speed" valuetext={speedText} onchange={(v) => setSound({ speed: v })} />
        <div class="scale" aria-hidden="true"><span>0.5×</span><span>1×</span><span>1.5×</span></div>
      </div>
      <div class="row">
        <span class="row-txt"><span class="row-name">Keep pitch</span><span class="row-sub">{speedNote}</span></span>
        <button class="switch" class:on={cur.keepPitch} role="switch" aria-checked={cur.keepPitch} aria-label="Keep pitch"
          onclick={() => setSound({ keepPitch: !cur.keepPitch })}><i></i></button>
      </div>
    </section>

    <section class="group" aria-label="Effects">
      <div class="ctl">
        <div class="ctl-head"><span class="name">Bass</span><output class="val">{cur.bass ? `+${cur.bass} dB` : 'Off'}</output></div>
        <Fader value={cur.bass} min={0} max={BASS_MAX} step={0.5} marks={[6]} label="Bass boost"
          valuetext={cur.bass ? `plus ${cur.bass} decibels` : 'off'} onchange={(v) => setSound({ bass: v })} />
      </div>
      <div class="ctl">
        <div class="ctl-head"><span class="name">Reverb</span><output class="val">{room(cur.reverb)}</output></div>
        <Fader value={cur.reverb} min={0} max={1} step={0.01} marks={[0.25, 0.6]} label="Reverb"
          valuetext="{room(cur.reverb)}, {Math.round(cur.reverb * 100)}%" onchange={(v) => setSound({ reverb: v })} />
      </div>
      <div class="row">
        <span class="orbit" class:spin={cur.orbit && player.playing} class:on={cur.orbit} aria-hidden="true"><b class="head"></b><b class="ring"></b><b class="path"><b class="dot"></b></b></span>
        <span class="row-txt"><span class="row-name">8D</span><span class="row-sub">The sound circles around your head. Best in headphones</span></span>
        <button class="switch" class:on={cur.orbit} role="switch" aria-checked={cur.orbit} aria-label="8D"
          onclick={() => setSound({ orbit: !cur.orbit })}><i></i></button>
      </div>
    </section>

    <section class="group" aria-label="Equalizer">
      <div class="ctl-head eq-head">
        <span class="name">Equalizer</span>
        <div class="seg" role="radiogroup" aria-label="Equalizer presets">
          {#each EQ_PRESETS as e (e.id)}
            <button role="radio" aria-checked={eqPreset?.id === e.id} class:active={eqPreset?.id === e.id} onclick={() => setSound({ eq: e.eq })}>{e.label}</button>
          {/each}
        </div>
      </div>
      <div class="eq">
        <svg class="curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="eq-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22" /><stop offset=".5" stop-color="#fff" stop-opacity=".04" /><stop offset="1" stop-color="#fff" stop-opacity=".22" /></linearGradient>
          </defs>
          <line class="zero" x1="0" y1="50" x2="100" y2="50" />
          <polygon class="area" points="0,50 {curve} 100,50" />
          <polyline class="line" points={curve} />
        </svg>
        {#each EQ_BANDS as b, i (b.f)}
          <div class="band">
            <div class="slot">
              <Fader vertical value={cur.eq[i]} min={-EQ_MAX} max={EQ_MAX} step={0.5} center={0}
                label="{b.label} Hz" valuetext="{signed(cur.eq[i])} dB at {b.label} Hz"
                onchange={(v) => setSound({ eq: cur.eq.map((g, j) => (j === i ? v : g)) })} />
            </div>
            <span class="hz">{b.label}</span>
          </div>
        {/each}
      </div>
    </section>

    </div>

    <div class="modal-foot">
      {#if scope.trackId && own}
        <button class="aside linkish" onclick={() => forgetSongSound(scope.trackId)}>Use the sound for all songs</button>
      {:else}
        <span class="aside note">{scope.trackId ? 'Changes here apply to this song only' : 'For every song without its own sound'}</span>
      {/if}
      <button class="btn ghost icon" aria-label="Back to the original sound" disabled={preset?.id === 'original'} onclick={resetSound}><Icon name="undo" size={18} /></button>
    </div>
  </Modal>
{/if}

<!-- A saved sound draws its own tone: the curve, an echo of it when there is reverb, and the speed. -->
{#snippet tune(t)}
  <span class="glyph g-tune" aria-hidden="true">
    <svg viewBox="0 0 100 40" preserveAspectRatio="none">
      {#if t.reverb}<polyline class="echo" points={line(t, 40, 23, 15)} />{/if}
      <polyline points={line(t, 40, 20, 15)} />
    </svg>
    {#if t.speed !== 1}<em>{t.speed}×</em>{/if}
  </span>
{/snippet}

<style>
  /* ---- presets: six tiles, each drawing its effect ---- */
  /* Every row as tall as the tallest tile, so a two-line name never makes its row stand out. */
  .presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 8px; }
  .preset {
    display: flex; flex-direction: column; align-items: flex-start; min-width: 0; padding: 14px 12px 12px;
    color: var(--text); font: inherit; text-align: left; cursor: pointer;
    background: var(--fill-0); border: none; border-radius: var(--r-item); box-shadow: inset 0 0 0 1px var(--edge);
    transition: background .2s, box-shadow .2s, transform .15s var(--ease);
  }
  .preset:hover { background: var(--fill-1); }
  .preset:active { transform: scale(.97); }
  .preset.on { background: var(--fill-2); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .7); }
  .preset strong { font-size: 13.5px; font-weight: 600; line-height: 1.25; text-wrap: balance; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* ---- your presets: one row, a dropdown of what you saved and a save button ---- */
  .yours { position: relative; z-index: 3; margin-top: -10px; }
  .yours-row { display: flex; align-items: center; gap: 8px; }
  .pick {
    flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 52px; padding: 8px 12px;
    color: var(--text); font: inherit; text-align: left; cursor: pointer;
    background: var(--fill-0); border: none; border-radius: var(--r-item); box-shadow: inset 0 0 0 1px var(--edge);
    transition: background .2s, box-shadow .2s;
  }
  .pick:hover:not(:disabled), .pick[aria-expanded='true'] { background: var(--fill-1); }
  .pick.on { background: var(--fill-2); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .7); }
  .pick:disabled { cursor: default; }
  .pick-ico { display: grid; place-items: center; width: 46px; height: 28px; flex: none; color: var(--faint); }
  .pick-txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .pick-txt strong { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pick-txt small { font-size: 12px; color: var(--faint); }
  .pick:disabled .pick-txt strong { color: var(--muted); }
  .chev { display: flex; flex: none; color: var(--muted); transition: transform .3s var(--ease); }
  .pick[aria-expanded='true'] .chev { transform: rotate(180deg); }
  .save-btn {
    flex: none; width: 52px; height: 52px; display: grid; place-items: center; padding: 0; cursor: pointer;
    border: none; border-radius: var(--r-item); background: transparent; color: var(--text);
    outline: 1.5px dashed var(--edge-strong); outline-offset: -1.5px; transition: background .2s, outline-color .2s, color .2s;
  }
  .save-btn:hover:not(:disabled) { background: var(--fill-1); outline-color: rgba(255, 255, 255, .5); }
  .save-btn:disabled { color: var(--faint); cursor: default; opacity: .6; }
  .save-btn:focus-visible { outline-style: solid; outline-color: var(--text); }

  .yours-row.naming { min-height: 52px; padding: 0 6px 0 12px; border-radius: var(--r-item); background: var(--fill-1); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .45); gap: 10px; }
  .naming input {
    flex: 1; min-width: 0; height: 36px; padding: 0; border: none; outline: none; background: none;
    font: inherit; font-size: 14px; font-weight: 600; color: var(--text); caret-color: var(--text);
  }
  .naming input::selection { background: rgba(255, 255, 255, .28); }
  .ok { flex: none; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%; background: var(--primary); color: var(--on-primary); cursor: pointer; }

  .yours-menu {
    position: absolute; top: calc(100% + 6px); left: 0; right: 60px; max-height: 288px; overflow-y: auto;
    padding: 4px; border-radius: 11px; transform-origin: top center;
    /* Solid: it opens over the controls below, which must not show through. */
    background: #1c1c1f; box-shadow: inset 0 0 0 1px var(--edge), var(--shadow-float);
  }
  .opt { position: relative; display: flex; align-items: center; border-radius: var(--r-control); transition: background .12s; }
  .opt:hover, .opt:focus-within { background: var(--fill-1); }
  .opt-main {
    flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 44px; padding: 6px 40px 6px 10px;
    border: none; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; border-radius: inherit;
  }
  .opt-name { flex: 1; min-width: 0; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .opt.on .opt-name { font-weight: 600; }
  .opt-check { display: flex; color: var(--text); }
  .opt .g-tune { width: auto; margin: 0; height: 24px; color: var(--muted); }
  .opt.on .g-tune { color: var(--text); }
  .opt .g-tune svg { width: 38px; height: 22px; }
  .drop {
    position: absolute; right: 6px; top: 50%; width: 28px; height: 28px; margin-top: -14px; display: grid; place-items: center; padding: 0;
    border: none; border-radius: 50%; background: none; color: var(--faint); cursor: pointer; transition: background .15s, color .15s, opacity .15s;
  }
  .drop:hover { background: var(--fill-3); color: var(--text); }
  @media (hover: hover) { .opt .drop { opacity: 0; } .opt:hover .drop, .opt:focus-within .drop { opacity: 1; } }
  .opt.on .opt-main { padding-right: 40px; }
  .opt.on .opt-check { margin-right: 4px; }

  .g-tune { gap: 6px; width: 100%; }
  .g-tune svg { width: 46px; height: 28px; flex: none; overflow: visible; }
  .g-tune polyline { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .g-tune .echo { opacity: .3; }
  .g-tune em { font-style: normal; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pick .g-tune, .naming .g-tune { width: auto; flex: none; margin: 0; color: var(--text); }

  /* The scrolling middle: content slips softly under the head and foot instead of being cut. */
  .sound-body {
    display: grid; gap: 22px; margin: -10px -20px -12px; padding: 10px 20px 12px;
    -webkit-mask-image: linear-gradient(transparent, #000 10px, #000 calc(100% - 12px), transparent);
    mask-image: linear-gradient(transparent, #000 10px, #000 calc(100% - 12px), transparent);
  }

  /* ---- scope: all songs or this one, a lit pad sliding between them ---- */
  .scope { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: var(--r-item); background: var(--fill-1); }
  .scope-thumb {
    position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 9px;
    background: var(--fill-3); box-shadow: 0 4px 14px rgba(0, 0, 0, .3), inset 0 0 0 1px var(--edge);
    transition: transform .45s var(--ease);
  }
  .scope.song .scope-thumb { transform: translateX(100%); }
  .scope button {
    position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px;
    border: none; background: none; color: var(--muted); font: inherit; text-align: left; cursor: pointer; border-radius: 9px;
    transition: color .2s;
  }
  .scope button[aria-checked='true'] { color: var(--text); }
  .scope button:disabled { cursor: not-allowed; opacity: .45; }
  .scope-txt { display: flex; flex-direction: column; min-width: 0; }
  .scope-txt strong { font-size: 13.5px; font-weight: 600; }
  .scope-txt small { font-size: 12px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .scope button[aria-checked='true'] small { color: var(--muted); }
  /* All songs: a small stack of records. */
  .scope-ico { position: relative; width: 34px; height: 34px; flex: none; }
  .scope-ico > span { position: absolute; top: 5px; display: flex; border-radius: 5px; box-shadow: 0 0 0 1.5px rgba(22, 22, 24, .9), 0 2px 6px rgba(0, 0, 0, .35); transition: transform .45s var(--ease); }
  .scope-ico > span:nth-child(1) { left: 0; transform: rotate(-8deg) scale(.86); }
  .scope-ico > span:nth-child(2) { left: 5px; transform: rotate(-3deg) scale(.93); }
  .scope-ico > span:nth-child(3) { left: 10px; }
  .scope:not(.song) .scope-ico > span:nth-child(1) { transform: rotate(-12deg) scale(.86) translateX(-2px); }
  .scope:not(.song) .scope-ico > span:nth-child(2) { transform: rotate(-5deg) scale(.93); }
  .scope-art { flex: none; display: flex; border-radius: 6px; overflow: hidden; }

  .linkish { padding: 0; border: none; background: none; font: inherit; font-size: 13px; font-weight: 500; color: var(--muted); cursor: pointer; text-decoration: underline; text-decoration-color: var(--edge-strong); text-underline-offset: 3px; }
  .linkish:hover { color: var(--text); text-decoration-color: currentColor; }

  .glyph { position: relative; display: flex; align-items: center; gap: 3px; height: 28px; margin-bottom: 14px; color: var(--faint); transition: color .2s; }
  .preset:hover .glyph { color: var(--muted); }
  .preset.on .glyph { color: var(--text); }
  .glyph i { display: block; flex: none; width: 3px; height: var(--h); border-radius: 2px; background: currentColor; transition: transform .4s var(--ease); }
  /* Slowed: wide, lazy bars trailing their own echo. */
  .g-slowed { gap: 5px; }
  .g-slowed i { width: 4px; box-shadow: 5px 3px 0 -1px color-mix(in srgb, currentColor 28%, transparent); }
  /* Sped up and nightcore: thin and packed; nightcore sits higher. */
  .g-spedup, .g-nightcore { gap: 2px; }
  .g-spedup i, .g-nightcore i { width: 2px; }
  .g-nightcore { transform: translateY(-3px); }
  .g-nightcore i { height: calc(var(--h) * .85); }
  /* Bass boosted: the low bars fat and heavy. */
  .g-bass i:nth-child(1), .g-bass i:nth-child(2) { width: 6px; border-radius: 3px; }
  .g-bass i { transform-origin: bottom; align-self: flex-end; }

  .preset.on.live .glyph i { animation: bob var(--t, 1.4s) ease-in-out var(--d) infinite; }
  .preset.on.live .g-slowed i { --t: 2.8s; }
  .preset.on.live .g-spedup i { --t: .75s; }
  .preset.on.live .g-nightcore i { --t: .5s; }
  .preset.on.live .g-bass i { animation: thump .52s cubic-bezier(.2, .9, .3, 1) infinite; }
  .preset.on.live .g-bass i:nth-child(n+3) { animation-delay: .06s; }
  @keyframes bob { 50% { transform: scaleY(.5); } }
  @keyframes thump { 0% { transform: scaleY(1); } 40% { transform: scaleY(.62); } 100% { transform: scaleY(1); } }

  /* 8D: a head, a ring, and a dot travelling round it (two eased swings, a quarter turn apart, make the ellipse). */
  .g-8d, .orbit { position: relative; width: 40px; height: 28px; flex: none; }
  .head { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: currentColor; }
  .ring { position: absolute; left: 2px; right: 2px; top: 50%; height: 14px; margin-top: -7px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent); }
  .path { position: absolute; left: 2px; top: 50%; width: 6px; height: 6px; margin-top: -3px; transform: translateX(28px); }
  .dot { position: absolute; inset: 0; border-radius: 50%; background: currentColor; transform: translateY(-6px); }
  .preset.on.live .g-8d .path, .orbit.spin .path { animation: swingX 2s ease-in-out infinite alternate; }
  .preset.on.live .g-8d .dot, .orbit.spin .dot { animation: swingY 2s ease-in-out -1s infinite alternate; }
  @keyframes swingX { from { transform: translateX(0); } to { transform: translateX(28px); } }
  @keyframes swingY { from { transform: translateY(-6px) scale(.8); } to { transform: translateY(6px) scale(1.15); } }
  .orbit { color: var(--faint); transition: color .2s; }
  .orbit.on { color: var(--text); }

  /* ---- controls ---- */
  .group { display: grid; gap: 18px; padding-top: 20px; border-top: 1px solid var(--edge); }
  .ctl { display: grid; gap: 6px; }
  .ctl-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .name { font-size: 14px; font-weight: 600; }
  .val { font-size: 14px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
  .scale { display: flex; justify-content: space-between; margin-top: -4px; font-size: 11px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .scale span:nth-child(2) { transform: translateX(-2px); }

  .row { display: flex; align-items: center; gap: 12px; }
  .row-txt { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .row-name { font-size: 14px; font-weight: 600; }
  .row-sub { font-size: 13px; color: var(--faint); }

  /* ---- equaliser ---- */
  .eq-head { align-items: center; flex-wrap: wrap; }
  .eq-head .seg { margin-right: -6px; }
  .eq-head .seg button { min-height: 28px; padding: 2px 10px; font-size: 13px; }
  .eq { position: relative; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 14px 0 10px; border-radius: var(--r-item); background: var(--fill-0); box-shadow: inset 0 0 0 1px var(--edge); }
  .curve { position: absolute; left: 0; right: 0; top: 14px; height: 140px; width: 100%; overflow: visible; pointer-events: none; }
  .zero { stroke: rgba(255, 255, 255, .14); stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
  .area { fill: url(#eq-up); }
  .line { fill: none; stroke: rgba(255, 255, 255, .85); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .band { position: relative; display: grid; justify-items: center; gap: 8px; }
  .slot { height: 140px; display: flex; }
  .hz { font-size: 11px; color: var(--faint); font-variant-numeric: tabular-nums; }

  .note { font-size: 13px; color: var(--faint); }

  @media (max-width: 760px) {
    .preset { padding: 12px 10px 10px; }
    .preset strong { font-size: 13px; }
    .slot, .curve { height: 128px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .preset.on.live .glyph i, .preset.on.live .g-8d .path, .preset.on.live .g-8d .dot, .orbit.spin .path, .orbit.spin .dot { animation: none; }
  }
</style>

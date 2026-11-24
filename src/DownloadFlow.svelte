<script>
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { lib, allSongs, tracksOf, playable, ui, download, prepareDownload } from './state.svelte.js';
  import { player } from './player.svelte.js';
  import { sound, songSounds, soundName } from './sound.svelte.js';
  import { isNeutral } from '../server/effects.js';
  let format = $state('mix'), mode = $state('crossfade'), shuffle = $state(false), withSound = $state(true);
  // Songs here with a sound of their own: in a ZIP each keeps it; the one long MP3 takes the sound for all songs.
  const ownIds = $derived(tracks.filter((t) => songSounds[t.id]).map((t) => t.id));
  const own = $derived(format === 'zip' ? ownIds.length : 0);
  const effects = $derived(!isNeutral(sound) || own > 0);
  const soundText = $derived([!isNeutral(sound) ? soundName(sound) : '', own ? `${own} with their own` : ''].filter(Boolean).join(' · '));
  const source = $derived(ui.downloadSource || { contextId: 'all', name: 'All songs' });
  const playlist = $derived(lib.playlists.find((p)=>p.id===source.contextId));
  const tracks = $derived(source.trackIds ? source.trackIds.map((id)=>lib.tracks[id]).filter(Boolean) : source.contextId==='all' ? allSongs() : tracksOf(playlist));
  const ready = $derived(tracks.filter(playable).length);
  const missing = $derived(tracks.length-ready);
  const job = $derived(download.job);
  const size = (n) => n < 1048576 ? `${Math.ceil(n/1024)} KB` : `${(n/1048576).toFixed(1)} MB`;
  $effect(()=>{ if(ui.downloadOpen && !download.job){ format='mix';mode=playlist?.transition || player.allTransition;shuffle=false;withSound=true; } });
  const close = () => (ui.downloadOpen=false);
  const art = $derived(playlist?.cover || tracks.find((t)=>t.cover && playable(t))?.cover || '');
  const run = () => prepareDownload({ ...(source.trackIds ? {trackIds:source.trackIds} : {contextId:source.contextId}), format, mode, shuffle, sound: effects && withSound && !isNeutral(sound) ? $state.snapshot(sound) : null, soundName: soundName(sound),
    songSounds: effects && withSound && own ? Object.fromEntries(ownIds.map((id) => [id, $state.snapshot(songSounds[id])])) : null });
  function another(){download.job=null;download.error='';}
</script>
{#if ui.downloadOpen}
  <Modal title="Listen offline" lead={job?.name || source.name || playlist?.name || 'All songs'} {art} thumb closeLabel="Close download" onclose={close}>
    {#if job?.status==='ready'}
      <div class="line flat">
        <span class="ico on"><Icon name="check" size={20} stroke={3}/></span>
        <span class="txt"><span class="title">{job.format==='mix' ? 'One continuous MP3' : 'ZIP archive'}</span><span class="sub">{job.total} songs{job.sound ? ` · ${job.sound}` : ''} · {size(job.bytes)}</span></span>
      </div>
      {#if job.omitted}<p class="sub">{job.omitted} skipped · <a href={job.reportUrl} target="_blank" rel="noreferrer">download report</a></p>{/if}
      <p class="sub">On iPhone, save it to Files.</p>
      <div class="modal-foot">
        <button class="btn ghost icon aside" aria-label="Another download" onclick={another}><Icon name="back" size={20}/></button>
        <a class="btn primary icon" href={job.url} download={job.filename} aria-label="Download {job.format==='mix'?'MP3':'ZIP'}"><Icon name="download" size={20}/></a>
      </div>
    {:else if download.busy}
      <div class="progress-top"><span class="spinner sm"></span><span>{job?.status==='queued'?'Waiting…':'Preparing…'}</span></div>
      <div class="meter" role="progressbar" aria-label="Preparing offline download" aria-valuenow={Math.round((job?.progress || 0)*100)} aria-valuemin="0" aria-valuemax="100"><i style="transform:scaleX({job?.progress || 0})"></i></div>
      <p class="sub" aria-live="polite">{job?.done || 0} of {job?.total || ready} songs · {Math.round((job?.progress || 0)*100)}%</p>
    {:else}
      <p class="sub">{ready} ready{missing ? ` · ${missing} unavailable` : ''}</p>
      <div class="formats" role="radiogroup" aria-label="Download format">
        <button class="fmt" class:on={format==='mix'} role="radio" aria-checked={format==='mix'} onclick={()=>format='mix'}>
          <span class="glyph mix" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <strong>One continuous MP3</strong><small>With transitions</small>
        </button>
        <button class="fmt" class:on={format==='zip'} role="radio" aria-checked={format==='zip'} onclick={()=>format='zip'}>
          <span class="glyph zip" aria-hidden="true"><i></i><i></i><i></i></span>
          <strong>Separate songs · ZIP</strong><small>MP3s with covers</small>
        </button>
      </div>
      {#if format==='mix'}<div class="setting"><span class="label">Transition</span><div class="seg" role="radiogroup" aria-label="Download transitions">
        {#each [['none','Direct'],['fade','Fade'],['crossfade','Crossfade']] as [id,label]}<button role="radio" aria-checked={mode===id} class:active={mode===id} onclick={()=>mode=id}>{label}</button>{/each}
      </div></div>{/if}
      {#if effects}<div class="setting"><span class="label">Sound: {soundText}</span>
        <button class="switch" class:on={withSound} role="switch" aria-checked={withSound} aria-label="Download with the sound: {soundText}" onclick={()=>withSound=!withSound}><i></i></button>
      </div>
      {#if format==='mix' && ownIds.length && withSound}<p class="sub own-note">{ownIds.length === 1 ? '1 song has' : `${ownIds.length} songs have`} their own sound. It goes into the ZIP; the one long MP3 takes the sound for all songs.</p>{/if}{/if}
      <div class="setting"><span class="label">Shuffle</span>
        <button class="switch" class:on={shuffle} role="switch" aria-checked={shuffle} aria-label="Shuffle order" onclick={()=>shuffle=!shuffle}><i></i></button>
      </div>
      <div class="modal-foot">
        <button class="btn primary icon" aria-label="Prepare download" disabled={!ready} onclick={run}><Icon name="download" size={20}/></button>
      </div>
    {/if}
    {#if download.error}<p class="error" role="alert">{download.error}</p>{/if}
  </Modal>
{/if}
<style>
  /* Two tiles; each draws what you get: one long wave, or a stack of separate songs. */
  .formats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fmt {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 14px 14px 13px;
    color: var(--text); font: inherit; text-align: left; cursor: pointer;
    background: var(--fill-0); border: none; border-radius: var(--r-item);
    box-shadow: inset 0 0 0 1px var(--edge);
    transition: background .2s, box-shadow .2s, transform .15s var(--ease);
  }
  .fmt:hover { background: var(--fill-1); }
  .fmt:active { transform: scale(.98); }
  .fmt.on { background: var(--fill-2); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .7); }
  .fmt strong { font-size: 14px; font-weight: 600; line-height: 1.3; }
  .fmt small { font-size: 13px; color: var(--faint); }
  .glyph { display: flex; align-items: center; gap: 3px; height: 28px; margin-bottom: 12px; color: var(--muted); transition: color .2s; }
  .fmt.on .glyph { color: var(--text); }
  .glyph.mix i { width: 3px; border-radius: 2px; background: currentColor; }
  .glyph.mix i:nth-child(1) { height: 30%; } .glyph.mix i:nth-child(2) { height: 65%; } .glyph.mix i:nth-child(3) { height: 100%; }
  .glyph.mix i:nth-child(4) { height: 55%; } .glyph.mix i:nth-child(5) { height: 85%; } .glyph.mix i:nth-child(6) { height: 45%; } .glyph.mix i:nth-child(7) { height: 25%; }
  .fmt.on .glyph.mix i { animation: eqMix 1.4s ease-in-out infinite; }
  .fmt.on .glyph.mix i:nth-child(odd) { animation-delay: -.5s; }
  @keyframes eqMix { 50% { transform: scaleY(.6); } }
  .glyph.zip { position: relative; width: 30px; }
  .glyph.zip i { position: absolute; left: 0; width: 22px; height: 22px; border-radius: 4px; border: 1.5px solid currentColor; background: var(--island); transition: transform .3s var(--ease); }
  .glyph.zip i:nth-child(1) { transform: translate(8px, -4px); opacity: .45; } .glyph.zip i:nth-child(2) { transform: translate(4px, -1px); opacity: .7; } .glyph.zip i:nth-child(3) { transform: translate(0, 2px); }
  .fmt.on .glyph.zip i:nth-child(1) { transform: translate(12px, -6px); } .fmt.on .glyph.zip i:nth-child(2) { transform: translate(6px, -2px); }
  .setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; flex-wrap: wrap; }
  .setting + .setting { margin-top: -14px; }
  .setting .label { font-size: 13px; color: var(--muted); }
  .own-note { margin: -16px 0 0; }
  .progress-top { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
</style>

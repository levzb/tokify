<script>
  import Icon from './Icon.svelte';
  import { lib, allSongs, tracksOf, playable } from '../lib/library.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { download, prepareDownload } from '../lib/download.svelte.js';
  import { player } from '../lib/player.svelte.js';
  let format = $state('mix'), mode = $state('crossfade'), shuffle = $state(false);
  const source = $derived(ui.downloadSource || { contextId: 'all', name: 'All songs' });
  const playlist = $derived(lib.playlists.find((p)=>p.id===source.contextId));
  const tracks = $derived(source.trackIds ? source.trackIds.map((id)=>lib.tracks[id]).filter(Boolean) : source.contextId==='all' ? allSongs() : tracksOf(playlist));
  const ready = $derived(tracks.filter(playable).length);
  const missing = $derived(tracks.length-ready);
  const job = $derived(download.job);
  const size = (n) => n < 1048576 ? `${Math.ceil(n/1024)} KB` : `${(n/1048576).toFixed(1)} MB`;
  $effect(()=>{ if(ui.downloadOpen && !download.job){ format='mix';mode=playlist?.transition || player.allTransition;shuffle=false; } });
  const close = () => (ui.downloadOpen=false);
  const run = () => prepareDownload({ ...(source.trackIds ? {trackIds:source.trackIds} : {contextId:source.contextId}), format, mode, shuffle });
  function another(){download.job=null;download.error='';}
</script>
<svelte:window onkeydown={(e)=>ui.downloadOpen && e.key==='Escape' && close()} />
{#if ui.downloadOpen}
  <div class="overlay" role="presentation" onclick={(e)=>e.target===e.currentTarget && close()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Listen offline" tabindex="-1">
      <button class="icon-btn close" aria-label="Close download" onclick={close}><Icon name="x" size={18}/></button>
      <h3>Listen offline</h3>
      <p class="lead">{job?.name || source.name || playlist?.name || 'All songs'}</p>
      {#if job?.status==='ready'}
        <div class="ready"><Icon name="check" size={24}/></div>
        <p class="summary">{job.total} songs · {size(job.bytes)} · {job.format==='mix' ? 'One continuous MP3' : 'ZIP archive'}</p>
        {#if job.omitted}<p class="note">{job.omitted} unavailable songs could not be included. They are listed in the <a href={job.reportUrl} target="_blank" rel="noreferrer">download report</a>.</p>{/if}
        <a class="btn primary btn-block" href={job.url} download={job.filename}><Icon name="download" size={18}/> Download {job.format==='mix'?'MP3':'ZIP'}</a>
        <p class="note">On iPhone, save to <strong>Files → On My iPhone</strong>. Or download on your Mac and send it with AirDrop. You can then listen without the Mac or internet.</p>
        {#if job.format==='zip'}<p class="note">ZIP contains separate MP3s and an M3U playlist. For continuous playback in Files, choose One continuous MP3.</p>{/if}
        <button class="btn quiet btn-block" onclick={another}>Prepare another download</button>
      {:else if download.busy}
        <div class="progress-top"><span class="spinner"></span><span>{job?.status==='queued'?'Waiting to prepare…':'Preparing your music…'}</span></div>
        <div class="progress" role="progressbar" aria-label="Preparing offline download" aria-valuenow={Math.round((job?.progress || 0)*100)} aria-valuemin="0" aria-valuemax="100"><div style="width:{(job?.progress || 0)*100}%"></div></div>
        <p class="summary" aria-live="polite">{job?.done || 0} of {job?.total || ready} songs · {Math.round((job?.progress || 0)*100)}%</p>
        <p class="note">Prepared from music already on your Mac. No internet needed. You can close this window; preparation continues.</p>
        <button class="btn ghost btn-block" onclick={close}>Hide</button>
      {:else}
        <p class="summary">{ready} ready{missing ? ` · ${missing} unavailable` : ''}</p>
        <div class="formats" role="radiogroup" aria-label="Download format">
          <button class:chosen={format==='mix'} role="radio" aria-checked={format==='mix'} onclick={()=>format='mix'}>
            <span class="radio"><i></i></span><span><strong>One continuous MP3</strong><small>With transitions. Play directly from Files on iPhone.</small></span>
          </button>
          <button class:chosen={format==='zip'} role="radio" aria-checked={format==='zip'} onclick={()=>format='zip'}>
            <span class="radio"><i></i></span><span><strong>Separate songs · ZIP</strong><small>Individual MP3s with titles, artists, covers and a playlist.</small></span>
          </button>
        </div>
        {#if format==='mix'}<div class="seg trans" role="radiogroup" aria-label="Download transitions">
          {#each [['none','Direct'],['fade','Fade'],['crossfade','Crossfade']] as [id,label]}<button role="radio" aria-checked={mode===id} class:active={mode===id} onclick={()=>mode=id}>{label}</button>{/each}
        </div>{/if}
        <button class="shuffle" class:on={shuffle} onclick={()=>shuffle=!shuffle} aria-pressed={shuffle}><Icon name="shuffle" size={18}/> Shuffle order <span>{shuffle?'On':'Off'}</span></button>
        {#if missing}<p class="note">Unavailable songs stay in your library. The download report lists everything that could not be included.</p>{/if}
        <button class="btn primary btn-block" disabled={!ready} onclick={run}><Icon name="download" size={18}/> Prepare download</button>
        <p class="note">Save the file on your phone before disconnecting. The website itself still needs the Mac.</p>
      {/if}
      {#if download.error}<p class="error" role="alert">{download.error}</p>{/if}
    </div>
  </div>
{/if}
<style>
  .overlay { position:fixed;inset:0;z-index:350;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.78);backdrop-filter:blur(8px); }
  .modal { position:relative;width:100%;max-width:490px;max-height:90dvh;overflow-y:auto;padding:30px 28px 22px;background:var(--panel);border:1px solid var(--border-strong);border-radius:20px;box-shadow:var(--shadow-pop);animation:fadeUp .35s var(--ease) both; }
  .close { position:absolute;right:14px;top:14px; }
  h3 { margin:0 40px 4px 0;font-size:26px;letter-spacing:-.035em; }
  .lead { margin:0 0 20px;color:var(--muted);font-size:14px;overflow-wrap:anywhere; }
  .summary { margin:0 0 16px;color:var(--muted);font-size:13px; }
  .formats { display:grid;gap:10px;margin-bottom:18px; }
  .formats button { display:flex;align-items:center;gap:12px;text-align:left;min-height:86px;padding:14px;color:#fff;font:inherit;border:1px solid var(--border);background:var(--raise);border-radius:12px;cursor:pointer;transition:background .2s,border-color .2s; }
  .formats button:hover,.formats .chosen { border-color:var(--border-strong);background:var(--raise-2); }
  .formats strong { display:block;font-size:14px;font-weight:600; }
  .formats small { display:block;color:var(--muted);font-size:12px;line-height:1.5;margin-top:3px; }
  .radio { width:18px;height:18px;flex:none;border:1px solid var(--border-strong);border-radius:50%;display:grid;place-items:center; }
  .chosen .radio { border-color:#fff; }.chosen .radio i { width:8px;height:8px;background:#fff;border-radius:50%; }
  .trans { display:flex;margin-bottom:8px; }.trans button { flex:1; }
  .shuffle { display:flex;align-items:center;gap:10px;width:100%;padding:14px 2px;margin-bottom:12px;border:none;background:none;color:var(--muted);font:inherit;font-size:13px;cursor:pointer; }.shuffle span { margin-left:auto; }.shuffle.on { color:#fff; }
  .note { font-size:12px;line-height:1.65;color:var(--muted);margin:14px 0; }.note strong,.note a { color:#ddd; }.note a { text-underline-offset:3px; }
  .progress-top { display:flex;align-items:center;gap:12px;margin:28px 0 22px;font-size:14px; }
  .progress { height:4px;background:var(--raise-2);border-radius:999px;overflow:hidden;margin-bottom:12px; }.progress div { height:100%;background:#fff;transition:width .5s var(--ease); }
  .ready { width:48px;height:48px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#000;margin:8px 0 20px; }
  .error { color:var(--danger);font-size:13px;line-height:1.5;overflow-wrap:anywhere; }
  @media(max-width:760px){ .overlay{padding:0;align-items:flex-end;}.modal{max-width:none;border-radius:20px 20px 0 0;padding:28px 20px calc(20px + var(--safe-b));max-height:94dvh;}.trans button{padding-inline:8px;} }
</style>

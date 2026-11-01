<script>
  import { onDestroy, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { api } from '../lib/api.js';
  import { lib, load } from '../lib/library.svelte.js';
  import { ui, toast } from '../lib/ui.svelte.js';
  import { pausePlayback, trackAudioChanged } from '../lib/player.svelte.js';
  import { artistName, clock } from '../lib/format.js';
  let data=$state(null), loading=$state(false), saving=$state(false), error=$state('');
  let start=$state(0),end=$state(0),cursor=$state(0),playing=$state(false),loop=$state(true);
  let viewStart=$state(0),viewEnd=$state(0),preview=$state(),wave=$state(),dialog=$state();
  let generation=0,raf=0,drag=null;
  const track=$derived(lib.tracks[ui.clipTrackId]);
  const duration=$derived(data?.duration || 0);
  const valid=$derived(!!data && Number.isFinite(start) && Number.isFinite(end) && start>=0 && end<=duration+.000001 && end-start>=(data.minimum-.000001));
  const span=$derived(Math.max(.01,viewEnd-viewStart));
  const shownStart=$derived(Number.isFinite(start)?start:0),shownEnd=$derived(Number.isFinite(end)?end:duration);
  const startPct=$derived((shownStart-viewStart)/span*100),endPct=$derived((shownEnd-viewStart)/span*100),cursorPct=$derived((cursor-viewStart)/span*100);
  const dirty=$derived(!!data && (Math.abs(start-data.start)>.00001 || Math.abs(end-data.end)>.00001));
  const precise=(sec)=>{const m=Math.max(0,Math.round((Number.isFinite(sec)?sec:0)*1000));return `${clock(Math.floor(m/1000))}.${String(m%1000).padStart(3,'0')}`;};
  function stop(){preview?.pause();playing=false;cancelAnimationFrame(raf);}
  function close(){if(saving)return;stop();ui.clipTrackId=null;}
  async function open(id){
    const v=++generation;stop();data=null;loading=true;error='';loop=true;
    queueMicrotask(()=>dialog?.focus());
    pausePlayback();
    try{const found=await api(`/api/tracks/${encodeURIComponent(id)}/clip`);if(v!==generation)return;data=found;start=found.start;end=found.end;cursor=start;viewStart=0;viewEnd=found.duration;queueMicrotask(()=>dialog?.focus());}
    catch(e){if(v===generation)error=e.message;}finally{if(v===generation)loading=false;}
  }
  $effect(()=>{const id=ui.clipTrackId;if(id)untrack(()=>open(id));return()=>{generation++;stop();};});
  onDestroy(stop);
  function seekTo(sec){if(!preview || !data || !valid)return;const t=Math.max(start,Math.min(end,sec));cursor=t;try{preview.currentTime=data.sourceOffset+t;}catch{}}
  function tick(){
    cancelAnimationFrame(raf);raf=0;
    if(!preview||!data)return;
    const t=preview.currentTime-data.sourceOffset;
    if(!valid){stop();return;}
    if(t>=end-.008){if(loop){seekTo(start);}else{stop();cursor=end;return;}}
    else if(t<start-.03){seekTo(start);}else cursor=Math.min(end,Math.max(start,t));
    if(!preview.paused)raf=requestAnimationFrame(tick);
  }
  async function play(){
    if(!valid||!preview)return;if(!preview.paused){stop();return;}
    error='';seekTo(start);
    try{await preview.play();}catch{error='Couldn’t play this audio. Try again.';}
  }
  function changed(){if(valid){seekTo(start);}else stop();}
  function original(){start=0;end=duration;viewStart=0;viewEnd=duration;changed();}
  function zoom(){if(!valid)return;const w=Math.min(duration,Math.max(2,(end-start)*1.6));const middle=(start+end)/2;viewStart=Math.max(0,Math.min(duration-w,middle-w/2));viewEnd=viewStart+w;}
  const at=(e)=>{const r=wave.getBoundingClientRect();return viewStart+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*span;};
  function down(e,kind){if(saving||!data)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag={kind};}
  function move(e){if(!drag)return;const t=at(e),min=data.minimum;
    if(drag.kind==='start')start=Math.round(Math.max(0,Math.min(end-min,t))*1000)/1000;
    else if(drag.kind==='end')end=Math.round(Math.max(start+min,Math.min(duration,t))*1000)/1000;
    if(start<0)start=0;if(end>duration)end=duration;cursor=start;
  }
  function up(){if(!drag)return;drag=null;changed();}
  function keyBoundary(e,kind){const step=e.shiftKey?1:e.altKey?.01:.1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const delta=['ArrowLeft','ArrowDown'].includes(e.key)?-step:step;
      if(kind==='start')start=Math.max(0,Math.min(end-data.minimum,e.key==='Home'?0:e.key==='End'?end-data.minimum:start+delta));
      else end=Math.min(duration,Math.max(start+data.minimum,e.key==='Home'?start+data.minimum:e.key==='End'?duration:end+delta));changed();}
  }
  async function save(){if(!valid||saving)return;saving=true;error='';stop();const id=ui.clipTrackId;
    try{await api(`/api/tracks/${encodeURIComponent(id)}/clip`,{method:'PATCH',body:{start,end,version:data.version}});await load();trackAudioChanged(id);ui.clipTrackId=null;toast('Excerpt saved · original kept');}
    catch(e){error=e.message;}finally{saving=false;}
  }
</script>

{#if ui.clipTrackId}
  <div class="overlay" role="presentation" onclick={(e)=>e.target===e.currentTarget && close()}>
    <div class="editor" role="dialog" aria-modal="true" aria-label="Trim audio" tabindex="-1" bind:this={dialog}
      onkeydown={(e)=>{e.stopPropagation();if(e.key==='Escape')close();}}>
      <button class="icon-btn close" aria-label="Close editor" disabled={saving} onclick={close}><Icon name="x" size={19}/></button>
      <h2>Trim audio</h2>
      <div class="song">
        <Cover src={track?.cover} size={76} radius={12}/>
        <div class="song-info"><h3>{track?.title || 'Audio excerpt'}</h3><p>{track ? artistName(track) : ''}</p>{#if data}<span class="original">Original · {precise(duration)}</span>{/if}</div>
      </div>
      {#if loading}<div class="loading"><span class="spinner"></span> Reading the audio…</div>
      {:else if data}
        <div class="wave-head"><span>Drag the edges to choose your excerpt</span><div><button class="text-btn" onclick={zoom} disabled={!valid}>Zoom to selection</button>{#if viewStart>0 || viewEnd<duration}<button class="text-btn" onclick={()=>{viewStart=0;viewEnd=duration;}}>Fit</button>{/if}</div></div>
        <div class="wave" role="group" aria-label="Excerpt waveform" bind:this={wave} onpointermove={move} onpointerup={up} onpointercancel={up}>
          <svg viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
            <defs><clipPath id="excerpt-wave-selection"><rect x={(shownStart-viewStart)/span*1000} y="0" width={Math.max(0,(shownEnd-shownStart)/span*1000)} height="140"/></clipPath></defs>
            <g fill="#5a5a5a">{#each data.waveform as value,i}{@const x=((i+.5)/data.waveform.length*duration-viewStart)/span*1000}{@const w=duration/data.waveform.length/span*1000*.65}<rect {x} y={70-Math.max(2,value*57)} width={Math.max(1,w)} height={Math.max(4,value*114)} rx="1"/>{/each}</g>
            <g fill="#e7e7e7" clip-path="url(#excerpt-wave-selection)">{#each data.waveform as value,i}{@const x=((i+.5)/data.waveform.length*duration-viewStart)/span*1000}{@const w=duration/data.waveform.length/span*1000*.65}<rect {x} y={70-Math.max(2,value*57)} width={Math.max(1,w)} height={Math.max(4,value*114)} rx="1"/>{/each}</g>
          </svg>
          <button class="wave-seek" aria-label="Seek excerpt preview" onclick={(e)=>seekTo(at(e))}></button>
          {#if valid}<div class="selected" style="left:{startPct}%;width:{endPct-startPct}%"></div>{/if}
          {#if cursorPct>=0 && cursorPct<=100}<div class="playhead" style="left:{cursorPct}%"></div>{/if}
          {#if valid && startPct>=0 && startPct<=100}<button class="edge start" style="left:{startPct}%" role="slider" aria-label="Excerpt start" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={start} aria-valuetext={precise(start)} onpointerdown={(e)=>down(e,'start')} onkeydown={(e)=>keyBoundary(e,'start')}><span></span></button>{/if}
          {#if valid && endPct>=0 && endPct<=100}<button class="edge end" style="left:{endPct}%" role="slider" aria-label="Excerpt end" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={end} aria-valuetext={precise(end)} onpointerdown={(e)=>down(e,'end')} onkeydown={(e)=>keyBoundary(e,'end')}><span></span></button>{/if}
        </div>
        <div class="ruler"><span>{precise(viewStart)}</span><span>{precise((viewStart+viewEnd)/2)}</span><span>{precise(viewEnd)}</span></div>
        <div class="bounds">
          <label><span>Start <small>seconds</small></span><input type="number" min="0" max={duration} step="0.001" bind:value={start} onchange={changed} aria-label="Excerpt start seconds" disabled={saving}/></label>
          <label><span>End <small>seconds</small></span><input type="number" min="0" max={duration} step="0.001" bind:value={end} onchange={changed} aria-label="Excerpt end seconds" disabled={saving}/></label>
          <div class="length"><span>Excerpt length</span><strong>{precise(valid?end-start:0)}</strong></div>
        </div>
        {#if !valid}<p class="error" role="alert">Choose at least {data.minimum} seconds within the original recording.</p>{/if}
        <div class="preview-controls">
          <button class="btn ghost preview" disabled={!valid||saving} onclick={play}><Icon name={playing?'pause':'play'} size={18}/>{playing?'Pause preview':'Play excerpt'}</button>
          <button class="icon-btn" class:on={loop} aria-label="Loop excerpt preview" aria-pressed={loop} onclick={()=>loop=!loop} title="Loop preview"><Icon name="repeat" size={19}/></button>
          <span class="cursor">{precise(cursor)} / {precise(duration)}</span>
        </div>
        <audio class="clip-audio" bind:this={preview} src={data.audioUrl} preload="metadata" onloadedmetadata={()=>seekTo(start)} onplay={()=>{playing=true;cancelAnimationFrame(raf);tick();}} onpause={()=>{playing=false;cancelAnimationFrame(raf);}} ontimeupdate={()=>{if(playing)tick();}} onended={()=>{if(loop&&playing){seekTo(start);preview.play().catch(()=>stop());}else stop();}}></audio>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="footer">
        <div><button class="text-btn restore" disabled={!data||saving} onclick={original}>Restore original</button><p>Your original is kept. Saved in every playlist.</p></div>
        <div class="footer-actions"><button class="btn ghost" disabled={saving} onclick={close}>Cancel</button><button class="btn primary" disabled={!valid||saving||!dirty} onclick={save}>{#if saving}<span class="spinner dark"></span>{/if}Save excerpt</button></div>
      </div>
    </div>
  </div>
{/if}
<style>
  .overlay{position:fixed;inset:0;z-index:520;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);}
  .editor{position:relative;width:100%;max-width:800px;max-height:92dvh;overflow-y:auto;padding:34px 32px 26px;background:var(--panel);border:1px solid var(--border-strong);border-radius:20px;box-shadow:var(--shadow-pop);animation:fadeUp .35s var(--ease) both;outline:none;}
  .close{position:absolute;top:16px;right:16px;}h2{font-size:28px;line-height:1.2;letter-spacing:-.035em;margin:0 40px 26px 0;font-weight:700;}
  .song{display:flex;align-items:center;gap:18px;margin-bottom:30px;}.song-info{min-width:0;}h3{font-size:22px;letter-spacing:-.03em;line-height:1.2;margin:0 0 5px;overflow-wrap:anywhere;}.song p{font-size:14px;color:var(--muted);margin:0 0 3px;}.original{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}
  .wave-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted);margin-bottom:12px;flex-wrap:wrap;}.wave-head>div{display:flex;gap:12px;}.text-btn{border:0;background:none;padding:6px 0;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;transition:color .2s;}.text-btn:hover{color:#fff;}.text-btn:disabled{opacity:.4;cursor:default;}
  .wave{position:relative;height:144px;margin-inline:10px;touch-action:none;background:rgba(255,255,255,.025);border-radius:8px;}.wave svg{display:block;width:100%;height:100%;overflow:hidden;border-radius:8px;}.wave-seek{position:absolute;inset:0;border:none;background:transparent;cursor:crosshair;border-radius:8px;}.selected{position:absolute;top:0;bottom:0;background:rgba(255,255,255,.05);border-block:1px solid rgba(255,255,255,.4);pointer-events:none;}.playhead{position:absolute;top:8px;bottom:8px;width:1px;background:#fff;pointer-events:none;opacity:.75;}
  .edge{position:absolute;top:-6px;bottom:-6px;width:40px;transform:translateX(-50%);padding:0;border:none;background:transparent;cursor:ew-resize;touch-action:none;}.edge span{position:absolute;top:0;bottom:0;left:calc(50% - 5px);width:10px;background:#f5f5f5;border-radius:4px;box-shadow:0 4px 14px #0009;}.edge span:after{content:'';position:absolute;left:4px;top:calc(50% - 10px);height:20px;width:2px;border-radius:1px;background:#737373;}.edge:hover span{background:#d8d8d8;}
  .ruler{display:flex;justify-content:space-between;margin:14px 10px 22px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;}.bounds{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:end;gap:16px;margin-bottom:20px;}.bounds label>span,.length>span{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:8px;}.bounds small{font-size:11px;color:var(--muted);}.bounds input{width:100%;height:46px;padding:10px 12px;background:var(--raise);border:1px solid var(--border);border-radius:10px;color:#fff;font:inherit;font-size:16px;font-variant-numeric:tabular-nums;outline:none;transition:border-color .2s,background .2s;}.bounds input::-webkit-inner-spin-button,.bounds input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}.bounds input{appearance:textfield;}.bounds input:focus{background:var(--raise-2);border-color:var(--border-strong);}.length{padding:0 0 9px 6px;}.length strong{font-size:23px;line-height:1;letter-spacing:-.02em;font-weight:600;font-variant-numeric:tabular-nums;}
  .preview-controls{display:flex;align-items:center;gap:10px;margin-bottom:26px;}.preview{min-height:44px;}.cursor{margin-left:auto;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}.clip-audio{display:none;}.footer{display:flex;justify-content:space-between;gap:16px;padding-top:18px;border-top:1px solid var(--border);align-items:center;}.restore{color:#d0d0d0;font-size:13px;}.footer p{font-size:11px;color:var(--muted);margin:2px 0 0;}.footer-actions{display:flex;gap:8px;}.footer .btn{min-height:44px;}.loading{height:200px;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:14px;}.error{font-size:13px;color:var(--danger);margin:12px 0;line-height:1.5;}.spinner.dark{border-color:#0002;border-top-color:#000;}
  @media(max-width:760px){.overlay{padding:0;align-items:flex-end;}.editor{max-width:none;max-height:96dvh;padding:28px 20px calc(20px + var(--safe-b));border-radius:20px 20px 0 0;}h2{font-size:24px;margin-bottom:24px;}.song{gap:14px;margin-bottom:24px;}h3{font-size:18px;}.wave-head{align-items:flex-start;}.wave{height:132px;margin-inline:8px;}.ruler{margin-inline:8px;font-size:10px;}.bounds{grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}.length{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;padding:0;}.length>span{margin:0;}.length strong{font-size:20px;}.cursor{font-size:11px;}.preview{padding-inline:13px;}.footer{flex-direction:column;align-items:stretch;gap:14px;}.footer-actions .btn{flex:1;}.footer p{margin-top:0;}.song :global(.cover){width:64px!important;height:64px!important;}}
</style>

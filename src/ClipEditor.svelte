<script>
  import { onDestroy, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { api, artistName, clock } from './util.js';
  import { lib, load, ui, toast } from './state.svelte.js';
  import { pausePlayback, trackAudioChanged } from './player.svelte.js';
  let data=$state(null), loading=$state(false), saving=$state(false), error=$state('');
  let start=$state(0),end=$state(0),cursor=$state(0),playing=$state(false),loop=$state(true);
  let viewStart=$state(0),viewEnd=$state(0),preview=$state(),wave=$state();
  let generation=0,raf=0,drag=null;
  const track=$derived(lib.tracks[ui.clipTrackId]);
  const duration=$derived(data?.duration || 0);
  const valid=$derived(!!data && Number.isFinite(start) && Number.isFinite(end) && start>=0 && end<=duration+.000001 && end-start>=(data.minimum-.000001));
  const span=$derived(Math.max(.01,viewEnd-viewStart));
  const shownStart=$derived(Number.isFinite(start)?start:0),shownEnd=$derived(Number.isFinite(end)?end:duration);
  const startPct=$derived((shownStart-viewStart)/span*100),endPct=$derived((shownEnd-viewStart)/span*100),cursorPct=$derived((cursor-viewStart)/span*100);
  const dirty=$derived(!!data && (Math.abs(start-data.start)>.001 || Math.abs(end-data.end)>.001));
  const precise=(sec)=>{const m=Math.max(0,Math.round((Number.isFinite(sec)?sec:0)*1000));return `${clock(Math.floor(m/1000))}.${String(m%1000).padStart(3,'0')}`;};
  function stop(){preview?.pause();playing=false;cancelAnimationFrame(raf);cancelAnimationFrame(glideRaf);cancelAnimationFrame(pushRaf);pushRaf=0;}
  function close(){if(saving)return;stop();ui.clipTrackId=null;}
  async function open(id){
    const v=++generation;stop();data=null;loading=true;error='';loop=true;
    pausePlayback();
    try{const found=await api(`/api/tracks/${encodeURIComponent(id)}/clip`);if(v!==generation)return;data=found;start=Math.round(found.start*1000)/1000;end=Math.floor(found.end*1000)/1000;cursor=start;viewStart=0;viewEnd=found.duration;frame();}
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
  // Space pauses and resumes where it stopped; play starts from the selection start only when outside it.
  async function play(){
    if(!valid||!preview)return;if(!preview.paused){preview.pause();return;}
    error='';seekTo(cursor<start||cursor>=end-.05?start:cursor);
    try{await preview.play();}catch{error='Couldn’t play this audio. Try again.';}
  }
  function changed(){if(valid){if(cursor<start||cursor>end)seekTo(start);frame();}else stop();}
  function original(){start=0;end=ms(duration);changed();}
  // Cut everything before / after the playhead.
  const ms=(t)=>Math.round(t*1000)/1000;
  function cutBefore(){if(!valid||saving)return;start=ms(Math.max(0,Math.min(end-data.minimum,cursor)));changed();}
  function cutAfter(){if(!valid||saving)return;end=ms(Math.max(start+data.minimum,Math.min(duration,cursor)));changed();}

  // The view follows the selection on its own: after every change it glides to the excerpt with some room
  // around it. Dragging an edge against a side of the waveform pulls the view back out.
  let glideRaf=0,pushRaf=0,lastX=0;
  function glide(a,b){
    cancelAnimationFrame(glideRaf);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){viewStart=a;viewEnd=b;return;}
    const a0=viewStart,b0=viewEnd,t0=performance.now();
    const step=(now)=>{const k=Math.min(1,(now-t0)/420),e=1-(1-k)**3;viewStart=a0+(a-a0)*e;viewEnd=b0+(b-b0)*e;if(k<1)glideRaf=requestAnimationFrame(step);};
    glideRaf=requestAnimationFrame(step);
  }
  function frame(){
    if(!data||!valid)return;
    const pad=Math.max(.3,(end-start)*.2);
    let a=Math.max(0,start-pad),b=Math.min(duration,end+pad);
    if(b-a<1){const m=(a+b)/2;a=Math.max(0,m-.5);b=Math.min(duration,a+1);}
    glide(a,b);
  }
  const atX=(x)=>{const r=wave.getBoundingClientRect();return viewStart+Math.max(0,Math.min(1,(x-r.left)/r.width))*span;};
  const at=(e)=>atX(e.clientX);
  function down(e,kind){if(saving||!data)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);cancelAnimationFrame(glideRaf);drag={kind};lastX=e.clientX;}
  function place(){const t=atX(lastX),min=data.minimum;
    if(drag.kind==='start')start=ms(Math.max(0,Math.min(end-min,t)));
    else end=ms(Math.max(start+min,Math.min(duration,t)));
    cursor=start;
  }
  function move(e){if(!drag)return;lastX=e.clientX;place();if(!pushRaf)pushRaf=requestAnimationFrame(push);}
  // Held against a side: the view widens that way, faster the further out the pointer is.
  function push(){
    pushRaf=0;if(!drag)return;
    const r=wave.getBoundingClientRect(),zone=28;
    const d=lastX<r.left+zone?-Math.min(2,(r.left+zone-lastX)/zone):lastX>r.right-zone?Math.min(2,(lastX-r.right+zone)/zone):0;
    if(!d)return;
    const step=Math.max(.02,span*.02)*d;
    if(d<0&&viewStart>0)viewStart=Math.max(0,viewStart+step);else if(d>0&&viewEnd<duration)viewEnd=Math.min(duration,viewEnd+step);else return;
    place();pushRaf=requestAnimationFrame(push);
  }
  function up(){if(!drag)return;drag=null;cancelAnimationFrame(pushRaf);pushRaf=0;changed();}
  function keys(e){
    if(!ui.clipTrackId||ui.dialog||!data||saving)return;
    if(e.target?.matches?.('input:not([type=number]),textarea,[contenteditable]'))return;
    const act=e.key===' '?play:e.key==='['?cutBefore:e.key===']'?cutAfter:null;
    if(!act||e.metaKey||e.ctrlKey||e.altKey)return;
    e.preventDefault();e.stopPropagation();act();
  }
  function keyBoundary(e,kind){const step=e.shiftKey?1:e.altKey?.01:.1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const delta=['ArrowLeft','ArrowDown'].includes(e.key)?-step:step;
      if(kind==='start')start=Math.max(0,Math.min(end-data.minimum,e.key==='Home'?0:e.key==='End'?end-data.minimum:ms(start+delta)));
      else end=Math.min(duration,Math.max(start+data.minimum,e.key==='Home'?start+data.minimum:e.key==='End'?duration:ms(end+delta)));changed();}
  }
  async function save(){if(!valid||saving)return;saving=true;error='';stop();const id=ui.clipTrackId;
    try{await api(`/api/tracks/${encodeURIComponent(id)}/clip`,{method:'PATCH',body:{start,end,version:data.version}});await load();trackAudioChanged(id);ui.clipTrackId=null;toast('Excerpt saved · original kept');}
    catch(e){error=e.message;}finally{saving=false;}
  }
</script>

<svelte:window onkeydowncapture={keys} />

{#if ui.clipTrackId}
  <Modal label="Trim audio" title={track?.title || 'Trim audio'} lead={track ? `Trim · ${artistName(track)}` : 'Trim'} art={track?.cover || ''} thumb size="xl" z={520} closeLabel="Close editor" closeDisabled={saving} onclose={close}>
      {#if loading}<div class="loading"><span class="spinner sm"></span> Reading the audio…</div>
      {:else if data}
        <div class="wave" role="group" aria-label="Excerpt waveform" bind:this={wave} onpointermove={move} onpointerup={up} onpointercancel={up}>
          <svg viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
            <defs><clipPath id="excerpt-wave-selection"><rect x={(shownStart-viewStart)/span*1000} y="0" width={Math.max(0,(shownEnd-shownStart)/span*1000)} height="140"/></clipPath></defs>
            <g fill="rgba(255,255,255,.28)">{#each data.waveform as value,i}{@const x=((i+.5)/data.waveform.length*duration-viewStart)/span*1000}{@const w=duration/data.waveform.length/span*1000*.65}<rect {x} y={70-Math.max(2,value*57)} width={Math.max(1,w)} height={Math.max(4,value*114)} rx="1"/>{/each}</g>
            <g fill="#ffffff" clip-path="url(#excerpt-wave-selection)">{#each data.waveform as value,i}{@const x=((i+.5)/data.waveform.length*duration-viewStart)/span*1000}{@const w=duration/data.waveform.length/span*1000*.65}<rect {x} y={70-Math.max(2,value*57)} width={Math.max(1,w)} height={Math.max(4,value*114)} rx="1"/>{/each}</g>
          </svg>
          <button class="wave-seek" aria-label="Seek excerpt preview" onclick={(e)=>seekTo(at(e))}></button>
          {#if valid}<div class="selected" style="left:{startPct}%;width:{endPct-startPct}%"></div>{/if}
          {#if cursorPct>=0 && cursorPct<=100}<div class="playhead" style="left:{cursorPct}%"></div>{/if}
          {#if valid && startPct>=0 && startPct<=100}<button class="edge start" style="left:{startPct}%" role="slider" aria-label="Excerpt start" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={start} aria-valuetext={precise(start)} onpointerdown={(e)=>down(e,'start')} onkeydown={(e)=>keyBoundary(e,'start')}><span></span></button>{/if}
          {#if valid && endPct>=0 && endPct<=100}<button class="edge end" style="left:{endPct}%" role="slider" aria-label="Excerpt end" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={end} aria-valuetext={precise(end)} onpointerdown={(e)=>down(e,'end')} onkeydown={(e)=>keyBoundary(e,'end')}><span></span></button>{/if}
        </div>
        <div class="ruler"><span>{precise(viewStart)}</span><span>{precise((viewStart+viewEnd)/2)}</span><span>{precise(viewEnd)}</span></div>
        <div class="bounds">
          <label class="field"><span class="label">Start</span><input class="input" type="number" min="0" max={duration} step="0.001" bind:value={start} onchange={changed} aria-label="Excerpt start seconds" disabled={saving}/></label>
          <label class="field"><span class="label">End</span><input class="input" type="number" min="0" max={duration} step="0.001" bind:value={end} onchange={changed} aria-label="Excerpt end seconds" disabled={saving}/></label>
          <div class="length"><span class="label">Length</span><strong>{precise(valid?end-start:0)}</strong></div>
        </div>
        {#if !valid}<p class="error" role="alert">At least {data.minimum} s</p>{/if}
        <div class="transport">
          <span class="cursor">{precise(cursor)}</span>
          <div class="deck">
            <button class="icon-btn" aria-label="Cut before the playhead" aria-keyshortcuts="[" disabled={!valid||saving||cursor<=start+.001} onclick={cutBefore}><Icon name="trimStart" size={22}/></button>
            <button class="pp" style="--s:48px" aria-label={playing?'Pause preview':'Play excerpt'} aria-keyshortcuts="Space" disabled={!valid||saving} onclick={play}><Icon name={playing?'pause':'play'} size={20}/></button>
            <button class="icon-btn" aria-label="Cut after the playhead" aria-keyshortcuts="]" disabled={!valid||saving||cursor>=end-.001} onclick={cutAfter}><Icon name="trimEnd" size={22}/></button>
          </div>
          <button class="icon-btn loop" class:on={loop} aria-label="Loop preview" aria-pressed={loop} onclick={()=>loop=!loop}><Icon name="repeat" size={19}/></button>
        </div>
        <audio class="clip-audio" bind:this={preview} src={data.audioUrl} preload="metadata" onloadedmetadata={()=>seekTo(start)} onplay={()=>{playing=true;cancelAnimationFrame(raf);tick();}} onpause={()=>{playing=false;cancelAnimationFrame(raf);}} ontimeupdate={()=>{if(playing)tick();}} onended={()=>{if(loop&&playing){seekTo(start);preview.play().catch(()=>stop());}else stop();}}></audio>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="modal-foot">
        <button class="btn ghost icon aside" aria-label="Restore original" disabled={!data||saving||(start===0&&end>=duration-.001)} onclick={original}><Icon name="undo" size={19}/></button>
        <button class="btn primary icon" aria-label="Save excerpt" disabled={!valid||saving||!dirty} onclick={save}>{#if saving}<span class="spinner sm"></span>{:else}<Icon name="check" size={20} stroke={2.5}/>{/if}</button>
      </div>
  </Modal>
{/if}
<style>
  .wave{position:relative;height:128px;margin-inline:6px;touch-action:none;background:var(--fill-1);border-radius:var(--r-control);}.wave svg{display:block;width:100%;height:100%;overflow:hidden;border-radius:var(--r-control);}
  .wave-seek{position:absolute;inset:0;border:none;background:transparent;cursor:crosshair;border-radius:var(--r-control);}
  .selected{position:absolute;top:0;bottom:0;background:rgba(255,255,255,.06);border-block:1px solid rgba(255,255,255,.45);pointer-events:none;}
  .playhead{position:absolute;top:8px;bottom:8px;width:2px;margin-left:-1px;border-radius:1px;background:var(--accent);pointer-events:none;}
  .edge{position:absolute;top:-6px;bottom:-6px;width:40px;transform:translateX(-50%);padding:0;border:none;background:transparent;cursor:ew-resize;touch-action:none;}
  .edge span{position:absolute;top:0;bottom:0;left:calc(50% - 5px);width:10px;background:var(--text);border-radius:5px;box-shadow:0 4px 14px rgba(0,0,0,.5);transition:background .2s;}
  .edge span:after{content:'';position:absolute;left:4px;top:calc(50% - 10px);height:20px;width:2px;border-radius:1px;background:rgba(0,0,0,.35);}
  .edge:hover span,.edge:focus-visible span{background:var(--accent);}
  .ruler{display:flex;justify-content:space-between;margin:-10px 6px 0;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums;}
  .bounds{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:12px;}
  .bounds .label,.length .label{display:flex;justify-content:space-between;}

  .length{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;}.length strong{font-size:20px;line-height:1;letter-spacing:-.02em;font-weight:700;font-variant-numeric:tabular-nums;}
  .transport{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;}
  .deck{display:flex;align-items:center;gap:14px;}
  .cursor{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;}
  .loop{justify-self:end;}.clip-audio{display:none;}
  .loading{height:200px;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:14px;}
  @media(max-width:760px){
    .wave{height:132px;margin-inline:8px;}.ruler{margin-inline:8px;font-size:12px;}
    .bounds{grid-template-columns:1fr 1fr;gap:12px;}.length{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;padding:0;}.length strong{font-size:20px;}
    .cursor{font-size:13px;}
  }
</style>

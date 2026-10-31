// Long press for touch (opens the song menu), with movement tolerance so scrolling still works.
export function longpress(node, handler) {
  let timer = 0, sx = 0, sy = 0, fired = false;
  const down = (e) => {
    if (e.pointerType === 'mouse') return;
    fired = false; sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(10); handler.current?.(e); }, 480);
  };
  const move = (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(timer); };
  const up = () => clearTimeout(timer);
  const click = (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('click', click, true);
  return { destroy() { clearTimeout(timer); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); node.removeEventListener('click', click, true); } };
}

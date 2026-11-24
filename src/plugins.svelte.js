// The plugins the server found (server/plugins.js): their switches, settings and actions, for Settings → Plugins
// and the song menu. A plugin never draws its own UI; Tokify draws what its plugin.json describes.
import { api } from './util.js';
import { toast } from './state.svelte.js';

export const plugins = $state({ list: [], loaded: false, error: '', busy: {} });

export async function loadPlugins() {
  try { plugins.list = (await api('/api/plugins')).plugins; plugins.error = ''; }
  catch (e) { plugins.error = e.message; }
  plugins.loaded = true;
}

function put(p) { const i = plugins.list.findIndex((x) => x.id === p.id); if (i >= 0) plugins.list[i] = p; }

export async function setPluginOn(id, enabled) {
  const p = plugins.list.find((x) => x.id === id);
  if (p) p.enabled = enabled;
  try { put(await api(`/api/plugins/${id}`, { method: 'PATCH', body: { enabled } })); }
  catch (e) { if (p) p.enabled = !enabled; toast(e.message); }
}

// Sliders send while they move; the server hears the last value.
const timers = {};
export function setPluginSetting(id, key, value) {
  const p = plugins.list.find((x) => x.id === id);
  if (!p) return;
  p.values[key] = value;
  clearTimeout(timers[id + key]);
  timers[id + key] = setTimeout(async () => {
    try { put(await api(`/api/plugins/${id}`, { method: 'PATCH', body: { settings: { [key]: value } } })); }
    catch (e) { toast(e.message); loadPlugins(); }
  }, 250);
}

export async function runPluginAction(id, action, trackId = null) {
  const k = `${id}/${action}`;
  if (plugins.busy[k]) return;
  plugins.busy[k] = true;
  try {
    const r = await api(`/api/plugins/${id}/actions/${action}`, { method: 'POST', body: trackId ? { trackId } : {} });
    if (r.message) toast(r.message);
  } catch (e) { toast(e.message); }
  finally { delete plugins.busy[k]; loadPlugins(); }
}

/** Actions plugins that are on add to the song menu. */
export const songActions = () => plugins.list.filter((p) => p.active)
  .flatMap((p) => p.actions.filter((a) => a.scope === 'song').map((a) => ({ ...a, plugin: p.id, pluginName: p.name })));

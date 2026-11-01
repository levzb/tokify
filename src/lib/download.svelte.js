import { api } from './api.js';
import { ui, toast } from './ui.svelte.js';
export const download = $state({ job: null, busy: false, error: '' });
let following = null;
export function openDownload(source) {
  if (!download.busy) { download.job = null; download.error = ''; }
  ui.downloadSource = source;
  ui.downloadOpen = true;
}
export async function prepareDownload(options) {
  download.error = ''; download.busy = true;
  try {
    download.job = await api('/api/exports', { method: 'POST', body: options });
    follow(download.job.id);
  } catch (e) { download.error = e.message; download.busy = false; }
}
async function follow(id) {
  if (following === id) return;
  following = id;
  try {
    while (following === id) {
      const job = await api(`/api/exports/${id}`);
      download.job = job;
      if (job.status === 'ready' || job.status === 'error') {
        download.busy = false;
        if (job.status === 'error') download.error = job.error;
        else if (!ui.downloadOpen) toast('Your offline download is ready', { action:'Open', onAction:()=>{ui.downloadOpen=true;}, ms:6000 });
        break;
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  } catch (e) { download.error = e.message + ' Preparing continues on the Mac; reopen Downloads after reconnecting.'; download.busy = false; }
  finally { if (following === id) following = null; }
}
export async function restoreDownload() {
  try {
    const { jobs } = await api('/api/exports');
    const job = jobs.find((j)=>['queued','building'].includes(j.status));
    if (job) { download.job=job;download.busy=true;follow(job.id); }
  } catch { /* Other parts of the library remain available. */ }
}

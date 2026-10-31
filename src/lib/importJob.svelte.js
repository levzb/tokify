import { api } from './api.js';
import { ui, toast } from './ui.svelte.js';
import { load } from './library.svelte.js';

export async function startImport(name, items) {
  const { playlistId, jobId } = await api('/api/imports', { method: 'POST', body: { name, items } });
  ui.importJob = { jobId, playlistId, name, total: items.length, done: 0, ok: 0, failed: 0, reused: 0, finished: false, items: {}, order: items.map((i) => i.musicId) };
  await load();
  poll();
}

export async function restoreImport() {
  const { jobs } = await api('/api/jobs');
  const job = jobs.find((j) => !j.finished && j.kind !== 'external');
  if (!job) return;
  ui.importJob = { ...job, jobId: job.id, order: Object.keys(job.items) };
  poll();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  let lastLoad = 0;
  while (ui.importJob && !ui.importJob.finished) {
    await new Promise((r) => setTimeout(r, 700));
    const job = ui.importJob;
    if (!job) break;
    try {
      const s = await api(`/api/jobs/${job.jobId}`);
      const before = job.done;
      Object.assign(job, s);
      if (s.done !== before && Date.now() - lastLoad > 1200) { lastLoad = Date.now(); await load(); }
    } catch (e) {
      if (e.status === 401 || e.status === 404) { ui.importJob = null; toast('Import status is unavailable. Check your uploads.'); break; }
    }
  }
  await load().catch(() => {});
  polling = false;
  const j = ui.importJob;
  if (j && !ui.importOpen) toast(`“${j.name}” is ready: ${j.ok} of ${j.total}`);
}

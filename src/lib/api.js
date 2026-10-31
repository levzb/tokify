export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (raw) { init.body = raw; init.headers['Content-Type'] = raw.type || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, init); } catch { throw new ApiError('Can’t reach the server. Is the Mac on?', 0); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') onUnauthorized();
  if (!r.ok) throw new ApiError(data.error || `Error ${r.status}`, r.status);
  return data;
}

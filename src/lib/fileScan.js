import { api, ApiError } from './api.js';

export function scanMediaFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/scan');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Metadata', encodeURIComponent(JSON.stringify({ filename: file.name })));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else reject(new ApiError(result.error || `File check failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Can’t check the file. Check the connection and try again.', 0));
    xhr.send(file);
  });
}
export function discardPreviews(files = []) {
  return Promise.allSettled(files.filter((f) => f.token).map((f) => api(`/api/files/staged/${f.token}`, { method: 'DELETE' })));
}

// File-picker policy shared by the browser and server. Content is also checked with ffprobe.
export const MEDIA_EXTENSIONS = ['mp3','mp2','mp1','m4a','m4b','aac','wav','wave','flac','ogg','oga','opus','aiff','aif','aifc','wma','amr','caf','alac','ape','ac3','eac3','dts','au','snd',
  'mp4','mov','m4v','webm','mkv','mka','avi','mpg','mpeg','3gp','3g2','wmv','flv','ts','mts','m2ts','vob','ogv','mxf'];
const extensions = new Set(MEDIA_EXTENSIONS);
export const MEDIA_ACCEPT = '.zip,.json,' + MEDIA_EXTENSIONS.map((ext) => '.' + ext).join(',');
export function mediaFileError(filename, type = '') {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (type.startsWith('image/') || !extensions.has(ext)) return 'Only audio and video files are supported. Photos and documents cannot be imported.';
  return null;
}

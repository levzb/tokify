import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),venv=path.join(root,'data','tools','yt-dlp');
fs.mkdirSync(path.dirname(venv),{recursive:true,mode:0o700});
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status)process.exit(r.status);};
run(process.env.TOKIFY_PYTHON || 'python3',['-m','venv',venv]);
run(path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-m','pip','install','--disable-pip-version-check','--upgrade','yt-dlp[default]']);
console.log('YouTube and SoundCloud support installed privately in data/tools. Restart Tokify if it is running.');

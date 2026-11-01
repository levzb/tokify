import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseMediaLink,TRACK_ID_RE}from'../shared/media-link.js';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-media-meta-'));process.env.TOKIFY_DATA=data;
const{metadataFromDownloader}=await import('../server/media-sites.js');const{spotifyMetadata}=await import('../server/spotify.js');const{db}=await import('../server/db.js');
test.after(()=>{db.close();fs.rmSync(data,{recursive:true,force:true});});
test('supported video and track links normalize and discard tracking without starting playlists',()=>{
 for(const url of ['https://youtu.be/jNQXAC9IVRw?t=2','https://m.youtube.com/watch?v=jNQXAC9IVRw&list=PLabc','https://music.youtube.com/watch?v=jNQXAC9IVRw','https://www.youtube.com/shorts/jNQXAC9IVRw'])assert.equal(parseMediaLink(url).url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
 assert.equal(parseMediaLink('Watch: https://soundcloud.com/forss/flickermood?utm_source=copy').provider,'soundcloud');
 assert.equal(parseMediaLink('https://on.soundcloud.com/abc123/').provider,'soundcloud');assert.equal(parseMediaLink('https://soundcloud.com/a/song?secret_token=s-private&utm=x').url,'https://soundcloud.com/a/song?secret_token=s-private');
 assert.equal(parseMediaLink('https://open.spotify.com/intl-en/track/11dFghVXANMlKmJXsNCbNl?si=test').url,'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');
 assert.equal(parseMediaLink('https://spotify.link/abc123').provider,'spotify');assert.equal(parseMediaLink('https://www.tiktok.com/music/sound-123').musicId,'123');
 for(const id of ['yt-jNQXAC9IVRw','sc-293','123','file-'+'a'.repeat(64)])assert.ok(TRACK_ID_RE.test(id));
});
test('unsupported hosts, arbitrary protocols, profiles, lists and credentials are rejected',()=>{
 for(const url of ['https://youtube.com.evil.example/watch?v=jNQXAC9IVRw','https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw','file:///tmp/audio.mp3','https://youtube.com:8080/watch?v=jNQXAC9IVRw','https://www.youtube.com/playlist?list=PLabc','https://www.youtube.com/@name','https://soundcloud.com/artist','https://soundcloud.com/artist/sets/list','https://soundcloud.com/artist/likes','https://open.spotify.com/album/11dFghVXANMlKmJXsNCbNl','https://example.com/song.mp3','https://user:password@youtube.com/watch?v=jNQXAC9IVRw'])assert.throws(()=>parseMediaLink(url),url);
});
test('downloader metadata uses stable source IDs and rejects preview-only, protected, live and oversized media',()=>{
 const link=parseMediaLink('https://www.youtube.com/watch?v=jNQXAC9IVRw'),raw={id:'jNQXAC9IVRw',title:'My video',uploader:'Creator',duration:19,thumbnail:'https://i.ytimg.com/cover.jpg'};
 assert.equal(metadataFromDownloader(raw,link).musicId,'yt-jNQXAC9IVRw');
 const sc=metadataFromDownloader({...raw,id:'293',webpage_url:'https://soundcloud.com/forss/flickermood'},parseMediaLink('https://soundcloud.com/forss/flickermood'));assert.equal(sc.musicId,'sc-293');
 for(const patch of [{_type:'playlist'},{entries:[]},{is_live:true},{duration:0},{duration:2701},{has_drm:true},{format_id:'hls_aac_preview'},{requested_downloads:[{format_id:'http_mp3_preview'}]},{availability:'premium_only'},{id:'../../bad'}])assert.throws(()=>metadataFromDownloader({...raw,...patch},link));
});
test('Spotify provides metadata only, even when the embed contains a preview',()=>{
 const id='11dFghVXANMlKmJXsNCbNl';const entity={type:'track',title:'A track',duration:195000,artists:[{name:'One'},{name:'Two'}],visualIdentity:{image:[{url:'https://i.scdn.co/a.jpg',maxWidth:300}]},audioPreview:{url:'https://example.com/preview.mp3'}};
 const result=spotifyMetadata(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{state:{data:{entity}}}}})}</script>`,id);assert.equal(result.metadataOnly,true);assert.equal(result.author,'One, Two');assert.equal(result.duration,195);assert.equal(result.playUrl,undefined);assert.equal(result.musicId,null);
 assert.throws(()=>spotifyMetadata('<html>Unavailable</html>',id),/unavailable/);
});

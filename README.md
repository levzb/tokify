# Tokify

A personal music player for your TikTok favorite sounds, YouTube / SoundCloud / Spotify links and your own audio and video files. Playlists, crossfade, trimming, offline MP3 downloads and an iPhone home-screen app. Everything runs on your own computer; your music, covers and library stay in `data/` and never go to GitHub.

Windows, macOS and Linux. Svelte 5, Node.js, SQLite, ffmpeg.

## Install (one command)

You need [Git](https://git-scm.com) and [Node.js 22.13+](https://nodejs.org). Then:

```sh
git clone https://github.com/levzb/tokify && cd tokify && npm run setup
```

`npm run setup` installs the dependencies, ffmpeg, Chromium (for TikTok pages) and yt-dlp (for YouTube and SoundCloud), builds the app, starts it and opens **http://localhost:8788**. Nothing is installed system-wide: ffmpeg comes from npm, yt-dlp goes to `data/tools/`. Run it again any time to update yt-dlp or rebuild after `git pull`.

Or just double-click **Start Tokify.cmd** (Windows) / **Start Tokify.command** (macOS): the first time it runs setup, after that it only starts Tokify.

| Command | |
|---|---|
| `npm start` | start in the background and open the browser (runs after you close the terminal) |
| `npm stop` | stop it |
| `npm run dev` | development: server restarts on change, the app with hot reload on http://localhost:5173 |
| `npm test` | server and unit tests |
| `npm run test:browser` | browser checks (see below) |

The log is `data/server.log`. Use another port with `PORT=9000` (in PowerShell: `$env:PORT=9000; npm start`). `TOKIFY_NO_OPEN=1` keeps the browser closed. Your own ffmpeg, ffprobe or yt-dlp can be used via `TOKIFY_FFMPEG`, `TOKIFY_FFPROBE`, `TOKIFY_YTDLP`.

## Project layout

```
server/   Node.js server: index.js (HTTP routes), system.js (install/start/stop), db.js, shared.js,
          audio.js (ffmpeg, trimming), stream.js (continuous stream, downloads), sources.js (TikTok,
          yt-dlp, Spotify), imports.js (import queue, files, links)
src/      the web app (Svelte components, player, state, styles)
iphone/   everything made only for iPhone: full-screen player, mini player, touch gestures, home-screen icon
tests/    *.test.js (npm test) and browser.mjs (npm run test:browser)
data/     your private library (created on first run, ignored by Git)
```

## Import from TikTok

In TikTok: **Settings → Privacy → Download your data**, format JSON. On Home, choose the ZIP, the JSON or a folder and press **Upload**. Import all sounds, the first N, or pick them by hand, and name the upload. Only *Favorite Sounds* are used (not liked videos). All link forms of the real export are recognized (`/h5/share/music/ID.html`, `/music/…-ID`, `/share/music/ID`, bare IDs).

Sounds are fetched by the server through its own Chromium; TikTok never asks for your account. Progress shows on the upload card; you can close the tab, and an unfinished import continues after a restart. Audio already downloaded is reused. Unavailable sounds stay grey with the reason and a retry in the menu. Real titles and covers appear as each sound is fetched (the export only contains links); for deleted sounds they may be gone.

## Add by link

Paste a link into the box at the top of Home: **TikTok** (including `vm.`/`vt.tiktok.com`, `/t/…` and share text), **YouTube** (videos, Shorts, youtu.be), **SoundCloud** tracks, or a **Spotify** track. The preview shows title, author, length and cover; nothing is downloaded until you press **Import**. **Import & trim** imports and then opens the trim editor.

- YouTube and SoundCloud download through yt-dlp. Single tracks only (no channels, albums, playlists or live streams), up to 45 minutes. Private, DRM or login-only recordings are reported, not faked. Browser cookies and accounts are never read.
- Spotify gives only the track info; its audio is never downloaded and the 30-second preview is not used. Press **Find on YouTube**, check the matches and **Choose** one: that YouTube source is then imported. A matching title does not guarantee the same recording, so you choose.

Link imports and your own files go to the **My files** upload, pinned first. A song that is already there shows **Open**. A preview lasts 10 minutes.

## Your own audio and video

Drop or choose audio/video files or a folder in the same box (MP3, WAV, FLAC, M4A, OGG, MP4, MOV, WebM, MKV and more, up to 512 MB). Files are checked right away: photos, documents, damaged files and videos without sound are rejected with a reason before anything is added. Press **Upload** to see a preview where you click the title or author to edit them, then **Import**.

The first audio track is saved as M4A. The cover is the video's first frame or the picture embedded in the audio, otherwise a placeholder (set your own from the song menu). Identical files are recognized by content (SHA-256) and not stored twice. Unconfirmed previews are deleted after 24 hours. Upload a TikTok ZIP/JSON separately from media files.

## Play and organize

Click a song to play its playlist. Choose **In order / Shuffle** and the transition **Direct / Fade / Crossfade**. The repeat button next to a song's number loops that song with the current transition. Right-click, long-press or **⋯** on a song: play next, add to queue, add to any playlist, rename song, edit author, trim audio, download, custom cover, remove from playlist. Click a playlist's title to rename it, its cover to change the picture. Drag rows to reorder (on a phone, use the handle on the right). **All songs → Select** to file many songs at once.

Keys: Space pauses, arrows seek 5 s, Shift + arrows change track, Escape closes menus and dialogs.

Everything except getting new sounds works without internet: playlists, editing, playback of downloaded songs, preparing downloads. Changes are saved at once to `data/library.sqlite`.

## Lyrics

The lyrics panel looks up a song on Genius by its title and, when available, artist. Titles such as `Artist — Song (Official Video)` are cleaned before searching. Translations and unrelated search hits are excluded; a title shared by several artists needs an artist or audio recognition to identify the song. Sounds called “original sound” are recognised with Shazam first. Found lyrics are saved for offline reading; **Look again** repeats the lookup.

For authenticated Genius search, generate a **Client Access Token** at [Genius API Clients](https://genius.com/api-clients) and save just the token in `data/genius-token.txt` (or `TOKIFY_DATA/genius-token.txt` when using another data folder), then restart Tokify. Alternatively, set `TOKIFY_GENIUS_TOKEN` or `GENIUS_ACCESS_TOKEN` in the server environment. Client ID and Client Secret are not needed. The token stays on the server; `data/` is excluded from Git.

Genius supplies plain text. Its metadata search uses the official API; song pages load through [curl_cffi](https://github.com/lexiforest/curl_cffi) with its Chrome transport. `npm run setup` installs this helper alongside Shazam in the private Python environment under `data/tools/shazam/`. An existing Python with `curl_cffi` installed can be selected with `TOKIFY_GENIUS_PYTHON`.

LRCLIB remains a fallback and can supply timed lyrics when the recording matches. Song pages can still return HTTP 403 or 429; Tokify then tries LRCLIB with the identified artist and pauses requests to the blocked Genius service for ten minutes. Authenticated metadata search can continue when only the song pages are blocked. Temporary service failures are not saved as “no lyrics”.

## Trim

**⋯ → Trim audio** on any song: drag the white edges on the waveform or type Start / End (minimum 0.5 s), **Zoom to selection** for long recordings. **Play excerpt** previews it (optionally looping). **Save excerpt** applies it everywhere the song appears, including transitions, repeat and new downloads. The original file is kept: reopen the editor to widen the range or **Restore original**.

## Offline downloads

**Download library** on Home, the download button in a playlist, or **⋯ → Download audio** on a song. Then **Prepare download**:

- **One continuous MP3**: all songs in one file with the transitions recorded into the audio, plus chapter titles and a cover. Plays anywhere with no site, network or app.
- **Separate songs · ZIP**: one MP3 per song with title, author and cover, an M3U8 playlist and a report listing songs that could not be included. ZIP is limited to 4 GB.

Downloads are prepared in the background and kept in `data/exports/`. On iPhone, save to **Files → On My iPhone** so the file is on the phone itself, or send it from the computer with AirDrop (works without internet).

## iPhone

The site adapts to a phone screen: a mini player at the bottom, tap it for the full player (seek, shuffle, repeat, queue), menus open as sheets. Playback continues on the lock screen with the system media controls, because the server sends one continuous audio stream with the transitions already mixed in.

The private way to reach it from your phone is [Tailscale](https://tailscale.com) (free for personal use, HTTPS needed for the lock-screen controls and the home-screen app):

1. Install Tailscale on the computer and the iPhone, sign in to the same account. Enable HTTPS certificates when Tailscale offers it.
2. On the computer: `tailscale serve --bg http://127.0.0.1:8788`
3. Open the `https://….ts.net` address it shows in Safari on the iPhone.
4. Safari → **Share → Add to Home Screen**. Launch Tokify from the icon.

Do not use `tailscale funnel`: that would put your library on the public internet. The computer must stay on with Tokify running (on a Mac, `caffeinate -i npm start` keeps it awake).

## Privacy and security

There is no password. Tokify listens only on `127.0.0.1`, so only this computer and Tailscale (which forwards to it) can reach it. Requests that claim to come from other websites are refused, so a page you visit cannot control your library.

`HOST=0.0.0.0 npm start` opens it to your whole Wi-Fi network (for example `http://192.168.1.20:8788` on the phone) **without any login**: anyone on that network can then use and change your library. Only do this on a network you trust.

`data/` holds the audio, covers, database, downloads and tools; on macOS and Linux its new files are readable only by your user. It, TikTok archives, media files and screenshots are excluded by `.gitignore`. Removing the last playlist a song is in hides it but keeps its audio, so reimporting does not download it again.

Backup: `npm stop`, copy `data/` somewhere private, `npm start`. Another location: `TOKIFY_DATA=/path/to/library`. To delete the library entirely: `npm stop` and delete `data/`.

## Browser checks

```sh
npx playwright install webkit
npm run test:browser                  # all isolated checks, in temporary libraries
npm run test:browser -- clips media   # only some: files links media clips downloads offline
npm run test:browser -- library       # your real library: Tokify running, your TikTok_Data_*.zip in the folder
```

Chromium on a desktop screen and WebKit on an iPhone 13 screen. External services are replaced with stand-ins, and your music is not touched (except `library` and `repeat`, which add a temporary playlist and remove it). Screenshots go to `screenshots/`. WebKit is not a physical iPhone: Files, AirDrop and the lock screen still need a real device. WebKit for Windows cannot play `blob:` media, so on Windows the saved-MP3 playback step runs only in Chromium.

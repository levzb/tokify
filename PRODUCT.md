# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node server (built-in `node:sqlite`, ffmpeg for audio) + Svelte 5 SPA built with Vite. Runs on the owner's Mac; the iPhone can reach it through Tailscale (`tailscale serve` for HTTPS).

## Users

Exactly one person, the owner. They collect short music fragments ("sounds") on TikTok and want to listen to them as a music library, mostly on an iPhone (Safari and the Home Screen web app), often with the screen locked and the phone in a pocket. They also use it on a desktop.

## Product Purpose

A private player for the owner's favorite TikTok sounds. It takes the TikTok data export (JSON format, zip or folder), finds the Favorite Sounds list, downloads each sound's audio and cover, and turns the result into playlists. Success: put on a playlist, lock the phone, and it keeps playing with the chosen transitions, controllable from the lock screen and headphones.

## Operating Context

- Input: TikTok "Download your data" export in JSON. Only Favorite Sounds are used (decision 2026-10-31); liked videos are ignored.
- Audio/video file imports (added 2026-10-31) use the same drop zone. Photos/documents are rejected; the server probes real audio before showing the import preview. The preview mirrors a playlist header with artwork on the left and directly editable title/author on the right, without visible input fields. Filename supplies the default editable title; author is entered by the owner. All external files go into one `external` upload, «Мои файлы», pinned first in Uploads and included in All songs.
- Each TikTok import ("выгрузка") becomes a playlist named by the owner. Custom playlists are built by hand from library songs.
- Sounds that cannot be downloaded stay visible, greyed, with the reason. They are never dropped silently.
- Sound pages only expose their data to a real browser. The server opens them in headless Chromium on the owner's Mac (explicitly authorized by the owner, for their own favorites, personal use).

## Capabilities and Constraints

- Password login; one user.
- Downloaded audio and covers are copyrighted and personal. They live only in `data/` (gitignored) and never go into any repository.
- iOS constraints shape playback: `audio.volume` is read-only on iOS, and Web Audio is suspended while the screen is locked. Transitions therefore have to be baked into a single continuous server-rendered stream, not mixed live in the browser.
- Real-device verification of lock-screen behavior has to be done by the owner. The builder has no iPhone and no iOS Simulator.

## Brand Commitments

Visual language is pinned to the owner's site https://dyke.win/: pure black, white, and greys; Inter plus JetBrains Mono; 16px cards with a top highlight line; hover lift; `cubic-bezier(.2,.8,.2,1)`; white primary buttons; pill segmented tabs; glow taken from the content's own color. Page organization follows Spotify. Minimalism: nothing decorative the owner did not ask for.

## Product Principles

1. Playback reliability on a locked iPhone beats every visual or feature nicety.
2. Never lose a song silently. Failures are shown, explained, and retryable.
3. Imports and hand-made playlists behave identically.
4. Add a convenience only if it doesn't make the interface harder.

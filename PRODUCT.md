# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone who installs Tokify on their own computer (`git clone` + `npm run setup`; Windows, macOS, Linux). Each install has one listener: the person whose library it is. They collect music fragments ("sounds") from TikTok, add YouTube / SoundCloud / Spotify links and their own audio or video files, and listen to them as a music library: on the desktop, and on an iPhone (Safari or the Home Screen web app), often with the screen locked and the phone in a pocket.

## Product Purpose

A private, self-hosted music player built from the listener's own sources. It turns a TikTok data export, pasted links and dropped files into a library of playlists, plays them as one continuous stream with transitions, trims songs, and exports offline MP3/ZIP downloads. Success: put on a playlist, lock the phone, and it keeps playing with the chosen transitions, controllable from the lock screen and headphones.

## Positioning

Everything runs on the listener's own computer: their audio, covers and library stay in `data/`, nothing is uploaded, no account. TikTok favorite sounds become a real library with transitions baked into a server-rendered stream, which is what makes it keep playing on a locked iPhone.

## Operating Context

- Inputs: the TikTok "Download your data" export in JSON (only Favorite Sounds are used), links (TikTok, YouTube, SoundCloud, Spotify → matched on YouTube), and audio/video files dropped into the same box on Home.
- Each TikTok import ("upload") becomes a playlist named by the listener; link and file imports go to the pinned **My files** upload. Custom playlists are built by hand.
- Songs that cannot be downloaded stay visible, greyed, with the reason and a retry. Never dropped silently.
- Page organization follows Spotify: sidebar of playlists, Home with uploads, playlist view, player bar; on phones a bottom bar, mini player and full-screen Now Playing (`iphone/`).
- iPhone access goes through `tailscale serve`; the server itself listens only on 127.0.0.1.

## Capabilities and Constraints

- No login or password; protection is localhost-only plus Host/cross-site checks.
- Stack: Node server (`node:sqlite`, bundled ffmpeg/ffprobe, yt-dlp, headless Chromium for TikTok pages) + Svelte 5 SPA built with Vite. Fonts are self-hosted via @fontsource.
- Downloaded audio and covers are copyrighted and personal: they live only in `data/` and never go into the repository.
- iOS shapes playback: `audio.volume` is read-only and Web Audio is suspended while locked, so transitions are rendered on the server into one stream.
- Real-device lock-screen verification is done by the owner; the builder has no iPhone.
- Planned, not yet specified: many user-customizable parts of the interface. The owner will describe them later; the visual system must leave room for user-adjustable values.

## Brand Commitments

- Name: Tokify.
- 2026-11-20: the previous pinned look (the owner's site dyke.win: pure black, white and greys) is retired. The whole interface moves to a frosted-glass (matte glass) style. Color is open; the owner asked for a recommendation.

## Evidence on Hand

- Real libraries are personal; there are no screenshots, users or testimonials to publish. Do not invent any.

## Product Principles

1. Playback reliability on a locked iPhone beats every visual or feature nicety.
2. Never lose a song silently. Failures are shown, explained and retryable.
3. Imports and hand-made playlists behave identically.
4. Add a convenience only if it doesn't make the interface harder.
5. The listener's library is theirs: local, private, adjustable.

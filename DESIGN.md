---
name: Tokify
description: Content is the colour, glass not boxes. Styled after Liner (tryliner/desktop).
colors:
  ground: "#070708"
  accent: "#ffffff"
  on-accent: "#000000"
  primary: "#d9d9dd"
  on-primary: "#000000"
  text: "#ffffff"
  muted: "rgba(255, 255, 255, .7)"
  faint: "rgba(255, 255, 255, .5)"
  danger: "#ff6b6b"
  island: "rgba(0, 0, 0, .5)"
  surface: "rgba(22, 22, 24, .86)"
  glass-btn: "rgba(255, 255, 255, .09)"
  glass-btn-hover: "rgba(255, 255, 255, .16)"
  fill-0: "rgba(255, 255, 255, .04)"
  fill-1: "rgba(255, 255, 255, .07)"
  fill-2: "rgba(255, 255, 255, .10)"
  fill-3: "rgba(255, 255, 255, .14)"
  edge: "rgba(255, 255, 255, .08)"
typography:
  hero:
    fontFamily: "Inter Variable (opsz), -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  page-heading:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "26px"
    fontWeight: 700
  heading:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  cover: "6px"
  control: "8px"
  island: "10px"
  hero-art: "10px"
  item: "12px"
  list: "14px"
  sheet: "20px"
spacing:
  gap: "8px"
  rail: "64px"
  player: "72px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-ghost-hover:
    backgroundColor: "{colors.fill-2}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    height: "32px"
  chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  input:
    backgroundColor: "{colors.fill-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
    height: "44px"
  island:
    backgroundColor: "{colors.island}"
    rounded: "{rounded.island}"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
    padding: "22px"
  track-row:
    rounded: "{rounded.item}"
    height: "60px"
---

# Design System: Tokify

## Overview

**Creative North Star: "Content is the colour"** (reference: Liner, `tryliner/desktop`, its `docs/DESIGN.md`).

The page sits straight on a heavily blurred copy of a cover (`src/Ambient.svelte`, baked once into a canvas by `src/blur.js`): an open playlist lights the room with its own cover, elsewhere the playing song does, else the library's first. There is no main panel, and almost nothing that lives on the page gets a box: buttons, chips, icons, the track list and meta sit directly on the backdrop. Boxes are kept for three things: the dark islands of the rail and the player (the same black 50%), playlist cards on Home, side sheets, and whatever floats over content (menus, tooltips, toasts).

**Key Characteristics:**
- On the page, not in a box. Fill appears only as state: hover, selected, pressed, a toggle that is on.
- Rounded rectangles, not pills: 8 for controls and chips, 12 for fields, rows and cards, 20 for dialogs.
- One solid button colour (`--primary`, light grey) for the main action and the chosen chip; everything else is bare text or icon until hovered.
- Calm motion: one curve, `cubic-bezier(.22, 1, .36, 1)`, 0.15–0.25s.
- Adjustable later via `:root`: `--accent`, `--primary`, `--ambient-strength`, `--glass-blur`.

## Colors

### Primary
- **Button Grey** (`--primary`, #d9d9dd, black text): Play all, Upload, Save, Prepare download, the active chip.
- **White** (`--accent`): the round play button, progress, the repeat-one badge, selection ticks.

### Neutral
- **Island** (black 50% + blur 24): rail, player, side sheets.
- **Surface** (rgba(22,22,24,.86) + blur 40, saturate 1.5): menus, tooltips, toasts, and sheets on phones.
- **Glass button** (white 9%, hover 16%): reserved; the page itself uses no resting fills.
- **Fills 1/2/3** (white 7/10/14%): hover and the link field / hover on bare buttons, selected / active toggle.
- **Text** white, **muted** 70%, **faint** 50% (second lines, durations, meta).

**The Readable Light Rule.** The backdrop is clamped (`brightness(.8)`, veil 28–62%) and an extra black shade scales with the cover colour's luminance, so white type stays readable on a bare page over a light cover.

## Typography

**Font:** Inter Variable with the optical-size axis (self-hosted). Liner uses SF Pro, which can't ship outside Apple platforms; Inter opsz is its stated fallback.

Scale: caption 12, body 13, label 14 (row and card titles), title 15, heading 18 (panel titles), page heading 26 ("Uploads"), hero 30 (playlist title) with an 18px subtitle. Titles 500, headings 600–700. Durations use tabular numerals.

## Layout

Desktop: 8px outer padding; a 64px rail island matching the player (Home, Create playlist, a rule, then playlist covers with name tooltips); the page fills the rest (max 1400px, 16px sides); the 72px player island sits on the bottom of the page column and the content scrolls under it. Phone (≤760px): no rail island; a frosted bottom bar of covers, a mini player above it, full-screen Now Playing, dialogs as bottom sheets.

## Elevation & Depth

Depth is blur, not shadow, and only floating things have it. Only covers (`0 6px 20px rgba(0,0,0,.35)`) and floating surfaces (`0 20px 60px rgba(0,0,0,.5)`) cast shadows.

**The Backdrop Root Rule.** An ancestor with `filter`, `opacity` < 1 or `backdrop-filter` switches its descendants' blur off. Overlays animate their colour; the page transition uses `animation-fill-mode: backwards`; on phones sheets sit in a dimming overlay that never blurs; desktop has no overlays at all.

## Shapes

Covers 6 (hero art 10), controls and chips 8, islands 10, fields, rows, cards, dialog buttons 12, list panel 14 (top corners), dialogs 20. The only circles are the play button, slider thumbs and switches.

## Components

- **Playlist hero** (Liner EntityHero): 208px cover (layered shadow), text bottom-aligned beside it: 30–46px/800 title (tracking -.03em), a `.meta-line` (`Upload · 966 songs · 4 hr 10 min · 276 unavailable`), then the actions row: a 56px white round play (`.pp`, Pause while this playlist plays), a shuffle icon with an accent dot when on, a hairline, and three song-ending toggles (`endDirect` / `endFade` / `endCrossfade` in `util.js`): Direct and Crossfade from Lucide (a square split down the middle, two intersecting squares), Fade from Material Symbols (`transition_fade`, a solid block dissolving into dots). Icons only, names in the tooltip; the chosen one sits on `--fill-2` and its icon pops once. Download, select and menu stay bare icons on the right. Phones: the cover centred above, the endings as a full-width row of three.
- **Track list**: rows of 60px straight on the page, 12px radius on hover; the playing row shows equaliser bars and a 600 title, no fill. With a mouse a song's own parts edit themselves: the title and the author are buttons only as wide as their words (hover: white 10% behind the text, a text cursor); a click turns the text into a field in the row itself (white 10% fill, 1px white 35% inner edge, same type, so nothing moves), Enter or clicking away saves, Escape cancels. The cover shows a picture icon over a 50% shade on hover and opens the image picker. The rest of the row plays. On touch, tap-to-play wins and these stay in the song menu.
- **Home**: the link field (the one resting fill, it is the main entry), then the add-music peak: an **upload stage** (white 7% fill tinted from the left by the first cover's colour, 12px radius; three of your own covers fanned out with a white round upload badge, a 30px "Upload music" title, Upload files primary + Choose a folder; covers spread on hover; a picked file turns the badge into a check and shows Upload / Another file) beside a **New playlist card**: a plain flat card (fill 7%) with an empty cover (fill 7%, a muted plus that turns white on hover), "New playlist" and the name it will get. No shadow, no tint, no dashed outline: dashes mean "drop files here". Then the page heading, bare chips and a bare download icon, and a grid of playlist cards (white 7% fill, 12px radius and padding, hover 10%; cover 6px corners, 14/500 title, 13px faint meta, a play button rising on hover).
- **Player island**: cover flush with the left edge, title 15 and artist; prev / play / next with a thin progress line; shuffle, repeat and queue as bare icons, then volume.
- **Actions are icons** (`.btn.icon`, `.icon-btn`): no text on buttons anywhere. The icon says it and the shared tooltip (`src/Tooltip.svelte`, surface, 13/500, after 450ms, instant between neighbours, with the key if there is one) names it from the button's `aria-label`, which keeps the old wording. A count may sit beside an icon (⬇ 12). Primary icon actions are wider (64, or 96 in panels) so the main one still reads first. Panels drop Cancel/Hide: × closes. Tabs, chips and option tiles stay words: they are choices, not actions.
- **Icon buttons**: never draw a box. Hover and press brighten the icon itself; a toggle that is on turns white with a 4px dot under it; keyboard focus is a soft round ring.
- **Playlist title**: click (or Rename in the menu) turns it into an inline field; Enter or leaving it saves, Escape cancels.
- **Draft playlists**: a playlist made with New playlist is removed when you leave it with its default name, no cover and no songs.
- **Docking** (`src/dock.svelte.js`, desktop only): the rail docks left or right, the player bottom or top. Drag either island by its grip (six dots at the foot of the rail; a short bar on the player's page-facing edge, shown on hover) or by any empty part of it; it lifts with a shadow and follows the pointer, the target slot shows as a solid white 6% fill with a 1.5px white 35% inner edge (never dashed), and on release everything glides into place (420ms, the house curve). Clicking a grip flips the island. Remembered per browser in `tokify.layout`.
- **Lyrics** (`src/Lyrics.svelte`, `server/lyrics.js`): words that follow the music when LRCLIB has timings that fit the recording (Spotify songs get them at import; others when the length matches within 3.5 s): lines 21/700, the sung one full white and 2.5% larger, sung ones 50%, the rest 34%; it is kept 40% down the panel (smooth scroll, paused 3 s after a hand scroll), a tap on a line seeks there, an instrumental break is three breathing dots, the credit reads `Synced lyrics from LRCLIB`. Otherwise plain words in the one panel, opened from the player (follows the playing song) or a song's menu (stays on that song). The panel's light is the song's cover; words are 17/1.75 weight 500, stanzas kept, the list fades out at its foot and scrolls. A song with a real name is looked up by it on LRCLIB; an "original sound" is recognised by Shazam first (three 12 s clips, two must agree, then a slowed copy for sped-up sounds). When the song turns out to have another name, a `--fill-1` card says "It's <title> <artist>" with a rename button. While it listens: five breathing bars and one line. The foot credits the source and has a "Look again" icon. Results are cached per song.
- **Stage** (`src/Stage.svelte`, `src/stage.svelte.js`, words shared through `src/lyrics.svelte.js`): full screen inside the browser window (never the browser's own full screen), from the player's expand icon, the Lyrics panel's foot, Now Playing on a phone, or F; F, Esc or the shrink icon (top right) leave. The rail folds to 0 and the page dissolves (blur 14, .45s), the side panel steps out and comes back after; only the player stays, now across the window. The room is the playing song: the usual ambient plus two round blurred copies of the cover (72px canvases faded to their edge, only scaled and moved by the GPU: no blend mode, no mask) drifting and turning slowly (48 s / 63 s, paused with the music), a dark vignette for reading. Left: the cover (10px, a shadow tinted with its colour, breathing 1.8% while playing, stepping back to 94% when paused), the title 24–40/800, artist, `Playlist · from Spotify`, `Next: title · artist`. Right: timed words at their own display scale, 28–56/800, tracking -.028em, max 21em: the sung line full white and filled word by word (by letters; Japanese, Chinese and Korean by character) as it is sung, the next lines stepping back (opacity .46 → .1) into soft focus (blur up to 4.5px), the sung ones dimmer still; the sung line sits 36% down (30% on a phone) and every line slides there with a 32 ms stagger per line of distance (.8 s), a short cascade. A break (and a long intro) is three dots that fill up until the next line. Tap a line to go there. Plain words scroll at 22–34/700; a song without words gives the room to a centred cover with its state (Looking for the words…, Instrumental, No words found). With a mouse the pointer and the exit hide after 2.6 s still; touch keeps the exit. Under 1100px the song sits above its words (96px cover, 56px on a phone).
- **Lighter effects** (`src/perf.svelte.js`, Settings → Look): a switch, never flipped by itself (`html.lite`, remembered in `tokify.lite`). It keeps the look and drops what a slow device chokes on: the ambient keeps its colour glow without the scaled-up cover, the stage's light stands still, the cover stops breathing, lines lose their blur, whole-window blurs in transitions become plain fades. While the stage is open or the page scrolls frames are still counted; if the typical gap is over 25 ms (under ~40 fps) a toast offers it once (Lighten), and Settings says what it measured.
- **Settings** (`#/settings`, `src/Settings.svelte`; values in `src/prefs.svelte.js` as `tokify.prefs`, applied by App.svelte to `--accent`, `--on-accent`, `--ambient-strength`, `--glass-blur`, `--island` and every `--r-*`): the gear right under Home in the rail (turns 45° on hover, 90° while open; on phones second in the bottom bar). Head: a 32–48/800 title and the tabs on the right, a `--primary` pad sliding under the chosen one (.42s); a tab's content settles in (fade, 10px rise, 6px blur). Type is a step larger than the rest of the app: block titles 17/600, lines 15, values 14 faint. Each setting is its own block (`--fill-1`, `--r-item`, 20px padding). **Look** is a studio: a big live model of this Tokify on the left (sticky; rail with Home and gear, page with a hero and rows, the side panel with a switch, the player; drawn with the real cover light, tint, frost, accent and corners) beside the blocks: Accent (eight mini play buttons: six light colours, From the cover, and Your colour, a rainbow ring opening the system colour picker; a dark colour of your own gets a white glyph), Cover light 15–100%, Glass as two sliders, Tint 10–92% black and Frost 0–48px blur, Corners 0–180% (scales every radius together), Lighter effects; then Back to the original look (with Undo). **Layout** (desktop): four arrangements as models of the window, sidebar left/right × player below/on top. **Playback**: Crossfade full width with two striped song lanes overlapping by as much as it is set (0.5–12 s, the first lane named after the playing song), Sleep timer (36/800 countdown, chips, an accent edge while it runs), Sound (its name 28/800, opens the panel). **Library**: 44/800 total, a 14px bar split into Music (accent), Covers, Downloads, Tools and other, the disk's free space; Search history and Quit Tokify side by side. **Plugins** (`plugins/`, `server/plugins.js`): a block per plugin, drawn by Tokify from its plugin.json so none brings its own look: a 44px plug tile (`--fill-2`, the accent with `--on-accent` glyph while on), name, version and disk use, a switch; its description, a status line with a 6px accent meter, an error in `--danger`; once on, a hairline and its settings as the usual controls (choice → chips, toggle → switch, number → Fader, text → input) and its actions as filled quiet buttons; song actions join every song's menu. Empty: one block telling where plugins go. **Keys** (desktop): two columns of blocks with 38px keycaps. Phones: four tabs across the width, the model above the blocks, one column.
- **Sound** (`src/Sound.svelte`, `src/sound.svelte.js`, `server/effects.js`): how the music sounds, one setting for everything that plays, remembered per browser. Opened from the player's sliders icon (a dot under it while any effect is on; its tooltip names the sound) or the phone's Now Playing. Top: six preset tiles in the `.fmt` tile style (Original, Slowed + Reverb, Sped up, Nightcore, Bass boosted, 8D), each drawing its effect in bars (slow bars with an echo, packed fast bars, fat low bars, a dot orbiting a head); the chosen one moves only while music plays. Below, separated by hairlines: Speed (0.5–1.5×, two-sided from 1× with a detent) with a Keep pitch switch, Bass, Reverb (named Room/Hall/Cathedral), an 8D switch, and a 5-band equaliser of upright faders over the live response curve (bass included), with Flat/Warm/Vocal/Bright chips. Sliders are `Fader.svelte`: 4px rail, 18px white knob, white fill; set by a preset they glide (.45s `--ease`), dragged they follow. The panel's lead is the preset name or "Custom"; the foot has an undo icon back to the original. Downloads offer a "Sound: <name>" switch that bakes the same chain in with ffmpeg. **Scope:** at the top, a two-up switch with a lit pad that slides between "All songs" (a small fan of library covers, the shared sound's name) and "This song" (the song's cover, its own sound or "Same as all songs"). Opened from the player it follows the song that plays; from a song's menu ("Sound") or its badge it stays on that song. A song with its own sound keeps it whatever all songs use, the player switches at each change of song, and track lists show a small pill with the sliders icon and the sound's name next to the author. In song scope the foot offers "Use the sound for all songs". **Your presets:** one row under the six tiles, never more tiles: a "Your presets" button (count, or the chosen preset's name and tone) that drops a solid list down over the controls, and a dashed square "+" that saves the sound made by hand (enabled only for a sound that is not built in or saved yet; it turns the row into a name field, Enter saves, Escape cancels). Each list row draws its tone (the curve, an echo with reverb, the speed), a check on the chosen one and a delete button (on hover with a mouse, always on touch); deleting offers Undo. The panel's middle (scope to equaliser) is its own scroller with soft fades under the fixed head and foot. All tile rows are the height of the tallest (`grid-auto-rows: 1fr`). Kept per browser, up to 12. In downloads a ZIP keeps each song's own sound; the one long MP3 takes the sound for all songs.
- **Search** (`src/Search.svelte`, state in `src/search.svelte.js`): one field at the top of Home for words and links (60px, magnifier on the left, `/` key hint, a magnifier find button; search actions always use the magnifier, never an arrow). Focusing it clears the room: the rest of Home lifts out of the flow and dissolves (220ms, blur + fade), the field stays with a one-line hint and up to six recent searches (this browser only, forgettable one by one); results then take Home's place, so nothing is ever pushed down. An empty field closes it again: Esc, the back arrow that replaces the magnifier, a click elsewhere, or Home in the rail; Home settles back in (420ms). `/` or ⌘K from anywhere comes back to Home and into the field; a link pasted anywhere on Home opens straight in it. Words search YouTube as you type (450ms pause; straight from its web API, under a second). Results: the chosen hit sits big on the left (16:9 cover with a 56px play badge on its edge, 24/700 title, artist, source · length · destination, a wide download button and trim), every hit stands in the column on the right as a song row (48px cover, the chosen one on `--fill-2`). The cover is the 30-second preview: a previewing row turns its cover into a little spinning record, fills itself left to right as the seconds pass and counts down; the big cover breathes; the whole room takes the preview's cover light. Previews stop when the main player plays or Home is left; they are prepared ahead for the first three hits and on hover, since YouTube makes the downloader wait a few seconds. Downloads run per hit, side by side; a done row shows an accent check that opens it.
- **Playlist links** (same field; `parsePlaylistLink` in `server/shared.js`, `importPlaylist` in `server/imports.js`): a YouTube / YouTube Music playlist, a SoundCloud set or a Spotify playlist or album shows as a card beside its numbered songs (square cover, name 24/700, owner, `.meta-line` `Spotify playlist · 100 songs · 4 h 38 min`, at most two 13px notes: Spotify's 100-song limit without sign-in, and that the audio is each song's YouTube recording). One wide icon action: Import N songs → Open playlist; once imported, Add N new songs and a ghost Check again. While it downloads a 4px white progress line and `12 of 100 downloaded · 1 failed`; each row ends in a spinner, an accent check, or a danger alert whose tooltip is the reason. The playlist remembers its link (`playlists.origin`, `.link`): importing again follows the source order and fetches only what is new or failed. A Spotify song keeps Spotify's title, artist and cover; its audio is the best matching recording (YouTube's `Artist - Topic` first, same length within a few seconds, no live/sped-up/cover versions unless the song is one; SoundCloud when YouTube has none). On a phone the card is a 132px cover beside the name, notes and action full width below. The playlist header reads `From Spotify` (a link to the source).
- **Menu**: surface, 11px radius, 36px items with 8px radius. **Toast**: surface, 12px radius, 13/600.
- **Sheet** (`src/SheetFrame.svelte` is the panel, `src/Modal.svelte` its content): there is one panel and no overlays on desktop. Uploads, file import, offline download, trimming, the queue and confirmations all open in the same dark island (black 50% + blur, 10px radius) on the free side of the screen: right when the rail is on the left, left when it is on the right. It is always 440px wide and the page makes room for it and stays usable. Opening something while it is open swaps only the content (the old content fades out, the new settles in with a short stagger); the panel, its edge and the page never move. A dialog (confirm, rename) sits over the current content, which comes back once it is answered. × or Escape closes the top one. Inside: an 18/600 title with a one-line 14px muted lead (optionally beside a 52px cover), the controls, then the actions pinned to the bottom. Content is the colour: the top 300px of the panel always catches a cover's light (its own `art`, else the cover lighting the room), baked by the same blur engine as the page backdrop and crossfading on a swap. Lists inside scroll on their own and dissolve into the footer. Type follows the site: section labels 13/500 muted, row titles 14, meta and times 13, buttons 14; nothing below 12 (only the waveform ruler). Queue: a now-playing card (72px cover, live progress, equaliser) above the list. Trim: the view follows the selection on its own (glides to the excerpt with 20% room after every change); holding an edge against a side of the waveform pulls the view back out. A transport row: playhead time, cut-before / play / cut-after (the cut icons show the crossed-out side and the kept waveform), loop. Space pauses and resumes in place, `[` and `]` cut at the playhead. Listen offline: two format tiles that draw what you get (one long wave vs. a stack of songs), selected = white 70% inner ring. Keep copy to labels and counts: no explanatory paragraphs. Phones keep a bottom sheet over a light dim, with the same cover light.
- **Drop state**: dragging files anywhere over Home frosts the whole window (black 45% + blur 40), a 2px white ring inset 10px with 18px corners breathes between 55 and 100%, and the cards (one per file, up to three) spring in and float in the middle with a count chip.

## Do's and Don'ts

- **Do** reuse these parts; add a missing one to `app.css` before using it twice.
- **Do** keep colour coming from covers; chrome stays white or black at low alpha.
- **Don't** box what lives on the page: no cards around actions, no fills on resting chips, icons or search, no panel behind lists.
- **Don't** nest glass in glass, use pills for buttons or chips, gradient text, or a brand hue.

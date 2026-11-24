# Tokify plugins

A plugin is a folder here: `plugins/<id>/`. Tokify finds it when it starts and lists it in **Settings → Plugins**,
where it is turned on and off and its settings are changed. Plugins are off until turned on (unless their
`plugin.json` says `"enabled": true`).

Plugins run with full access to this computer. Add only ones you wrote or trust.

```
plugins/my-plugin/
  plugin.json        what it is, its settings and actions
  server.js          export default function activate(t) { … }
  worker.py          optional heavy part, run with t.python()
```

Whatever a plugin downloads (models, a Python environment, caches) goes to `data/plugins/<id>/` (`t.data`), which
is private and never committed. When `data/plugins/<id>/venv` exists, `t.python()` uses it.

## plugin.json

```json
{
  "id": "my-plugin",              // lowercase, digits, dashes; the folder has the same name
  "name": "My plugin",
  "version": "0.1.0",
  "api": 1,                        // the plugin API it was written for
  "description": "One or two sentences for Settings.",
  "server": "server.js",
  "settings": [
    { "key": "mode", "type": "choice", "label": "Mode", "options": ["Fast", "Precise"], "default": "Fast", "help": "…" },
    { "key": "auto", "type": "toggle", "label": "Do it in the background", "default": false },
    { "key": "limit", "type": "number", "label": "Limit", "min": 1, "max": 15, "step": 1, "unit": "min", "default": 6 },
    { "key": "token", "type": "text", "label": "Token", "placeholder": "…" }
  ],
  "actions": [
    { "id": "check", "label": "Check the setup", "scope": "plugin" },   // a button in Settings
    { "id": "align", "label": "Align lyrics", "scope": "song", "icon": "lyrics" }  // an item in every song's menu
  ]
}
```

Tokify draws the settings and actions itself, so every plugin looks like the rest of Tokify.

## server.js: what `t` offers

| | |
|---|---|
| `t.lyrics.addProvider({ name, priority, find })` | Asked when Tokify found no timed words. `find(track, { audioFile, text, title, artist })` returns `{ synced: 'LRC', text, source }` or `null` to pass. |
| `t.on('track.ready', (trackId) => …)` | A song finished downloading or was re-cut. |
| `t.action(id, ({ trackId }) => ({ message }))` | Runs an action declared in plugin.json; `message` shows as a toast. |
| `t.route(method, path, ({ query, body }) => json)` | A request at `/api/plugins/<id>/<path>`. |
| `t.status(text, progress)` | A line (and a 0–1 bar) under the plugin in Settings; `t.status(null)` clears it. |
| `t.settings()` | Its current settings. |
| `t.store.get(key)`, `t.store.set(key, value)` | A small JSON store in the library database. |
| `t.data` | Its folder in `data/plugins/<id>/`. |
| `t.python(script, input)` | Runs a Python script from the plugin folder: JSON in on stdin, JSON out on stdout. |
| `t.tools.ffmpeg()`, `t.tools.ffprobe()` | Paths of the bundled tools. |
| `t.log(…)` | Logs with the plugin's name. |

`export function deactivate()` is called when the plugin is turned off.

A plugin cannot take Tokify down: a failure while starting, in a hook or an action becomes the plugin's error line
in Settings, and playback never waits on a plugin.

`lyrics-align/` is a placeholder for the AI lyrics aligner. It uses every hook but never changes any lyrics.

# Chainsaw

A browser-based live-coding sequencer: **Strudel** patterns, **LSDJ**'s
phrase → chain structure, and a scene grid you play the whole thing from.

Write a pattern, commit it to a named slot, sequence slots into chains, put
either in a scene, and play the set by firing scenes and cells. Every edit
propagates to every place that references it, quantized to a bar boundary so
nothing glitches. The whole project is one human-readable JSON file.

There is no separate timeline view to write a song into first — the grid is the
song.

It installs as a PWA and works with the network off.

**Live at <https://fiddlydigital.github.io/Chainsaw/>**

```
npm install
npm run dev        # http://localhost:5173
npm run verify     # lint, format, types, unit tests, build, end to end
```

## How it fits together

```
UI (React)  →  Project Store (zustand)  →  Scheduler (Engine)  →  Strudel
```

The UI never talks to the audio engine. Every action — editing code, dragging a
chain, firing a scene — goes through the store, which the Engine observes. That
keeps the JSON document authoritative and makes save, load and undo fall out for
free.

| Directory          | What lives there                                                                  |
| ------------------ | --------------------------------------------------------------------------------- |
| `schema/`          | `project.schema.json`, the authoritative document definition (JSON Schema)        |
| `src/model/`       | TypeScript mirror of the schema, defaults, and validation (ajv + reference rules) |
| `src/audio/`       | Timing, timeline resolution, the Strudel combinators, and the scheduler           |
| `src/store/`       | The project store (persisted shape) and the runtime store (ephemeral)             |
| `src/persistence/` | File System Access API save/load, `localStorage` autosave                         |
| `src/ui/`          | One component per surface: transport, grid, editors, project panel                |

The layer worth reading first is `src/audio/timeline.ts`. It resolves the whole
project — slots, chains, whatever the grid has triggered — into per-track
**timelines**: plain descriptions of which slot occupies which stretch of
cycles. It touches no Strudel and no audio, so the hard part of the system is
unit-testable without an audio context. `src/audio/patterns.ts` is what turns a
timeline into sound.

## Three decisions worth knowing about

**Changes never overwrite what is already playing.** A rebuild does not swap the
scheduler's pattern. It appends the new pattern as a _piece_ starting at the next
boundary (`pieces()` in `audio/patterns.ts`), so every cycle before that boundary
— including audio the scheduler has already queried and queued — still resolves
to exactly what it did before. The switch is sample-accurate rather than a race
against the scheduler's next tick.

**Patterns are queried at absolute time.** A clip playing at cycle 12 is
queried at cycle 12, so `note("<c e g>")` keeps advancing across the set
exactly as it would in the stock Strudel REPL. Strudel's own `slowcat`
cannot do this — it re-times each branch to its own rotation count — which is
why `timelinePattern()` exists.

**A slot is windowed, not squashed.** A slot's length in cycles is
`length / stepsPerCycle`, so the LSDJ default (16 steps at `16n`) is exactly one
cycle. Halve the length and you hear its first eight steps and then it moves on,
which is what shortening an LSDJ phrase does. It is not compressed into half the
time — write `.fast(2)` if that is what you want.

## Sound

The built-in kit (`bd sd hh oh cp rim cb lt mt ht`) is **synthesised**, not
sampled: oscillators and a noise buffer built at trigger time. Strudel's usual
drums are sample packs fetched from a CDN, and an installed PWA has to make
noise in aeroplane mode. Strudel's waveform and ZZFX synths are registered
alongside them, so `sound("sawtooth")`, `note(...)`, and the whole effects chain
work as normal.

## Playing it

**Every track has a fader, a mute and a solo**, in its column heading — the
grid's headings are the mixer.

Solo is exclusive: the moment anything is soloed, everything else drops out.
Mute wins over solo on the same track, so a stray solo cannot resurrect a track
you deliberately killed. The fader is `postgain`, so it never fights the
dynamics a slot or a chain step wrote into the pattern itself, and a fader all
the way down schedules nothing at all rather than triggering silent voices.

All three are document state, so a set saved mid-performance restores what was
killed; all three are undoable and land on a boundary like every other change.
The record is sparse — a track nobody has touched leaves no trace in the file,
which is why the cleanup compares field by field against declared defaults
rather than by truthiness: a fader at 0 is falsy and meaningful, and a fader at
1 is truthy and the default.

**Scenes can be reordered** with ↑/↓, and **`follow` walks the list**: a scene
runs until its longest cell has had one full pass, then the next fires. The
last scene holds rather than looping. Anything that is not a whole scene — one
cell fired by hand, a track stopped, Esc — stops the follow, because there is
no longer a scene to advance from.

Between `follow` and a list of scenes, an arranged set is a list you walk down
rather than a timeline you draw.

## MIDI

Chainsaw owns the timeline, so it is the **master**: 24 clock ticks per quarter
note, plus Start, Stop, Continue and Song Position, out to an output you pick
in the transport. No notes and no controllers yet.

Ticks are queued ahead with timestamps rather than fired off a timer — the
browser delivers a timestamped MIDI message far more precisely than a
JavaScript interval, and the queue survives the main thread being busy with a
rebuild. Starting from the top is a bare Start; resuming mid-song is a Song
Position followed by Continue, which is the difference between a receiver
playing bar 1 and playing along with you.

Access is requested when you pick an output rather than on load: asking for a
permission nobody has shown interest in is how you get it denied for the
session. The choice is remembered in `localStorage` rather than in the project,
because a port id means nothing on another machine — the same reason the master
fader is not in there either.

Reconnecting on load is conditional on `navigator.permissions` already
reporting `midi` as granted. Calling `requestMIDIAccess` outright would put a
prompt in front of someone who has never asked for MIDI, on every boot; if the
browser will not answer the permission question, Chainsaw waits to be asked
properly instead of gambling. A remembered device that is not plugged in this
time simply leaves the clock off.

## The scratch pad

The scratch pad is the stock Strudel REPL, kept intact: type an expression, hit
`Ctrl/Cmd + Enter`, and it plays. What it is not is a separate instrument —
**it sounds alongside whatever the tracks are already playing**, over the top
of whatever the grid has playing, all against the same transport. So you can write an idea while a set is running and hear it in
context without touching the document.

**Evaluating never starts the song.** With the transport stopped, evaluating
starts the clock — the pattern needs something to run against — and plays the
scratch pad alone; the grid stays out until you press play. So the transport's
button follows _the grid_ rather than the clock — showing "playing" while the
grid is silent would say the wrong thing. Pressing play brings the grid in on
the next boundary, underneath whatever the scratch pad is already doing.

Pause and stop are still the transport, and take everything with them. To
silence the scratch pad on its own, use `mute` or `hush` below.

Like everything else in Chainsaw it is boundary-quantized: evaluating queues
the pattern for the next bar or cycle per the transport's `quantize` setting,
so it drops in on the beat rather than the instant you finished typing.

Three ways to mix it, all of them queued the same way:

| Control | Does                                                        |
| ------- | ----------------------------------------------------------- |
| —       | Alongside the tracks, the stock REPL behaviour              |
| `mute`  | Out of the mix, pattern kept compiled and ready             |
| `solo`  | On its own, silencing the tracks without touching the scene |
| `hush`  | Discarded entirely; the code stays in the editor            |

`mute` and `solo` are faders rather than an undo: the compiled pattern survives
either way, so coming back out of one costs no recompile and loses nothing.
Soloing with nothing in the scratch pad does not silence the set — a mode only
means anything while there is a pattern to apply it to.

Whenever the layer is sounding, the transport carries a **scratch** pill next
to the live one, and clicking it mutes. The pad is one of three panes on a
phone, so the layer has to be visible and stoppable from wherever you are.

## Keys

Ableton's transport, Strudel's evaluate. Nothing fires while the caret is in a
text field.

| Key                | Does                                              |
| ------------------ | ------------------------------------------------- |
| `Ctrl/Cmd + Enter` | Evaluate the scratch pad / commit the slot's code |
| `Space`            | Play or pause                                     |
| `Ctrl/Cmd + .`     | Stop                                              |
| `Esc`              | Stop every clip                                   |
| `Ctrl/Cmd + Z`     | Undo (`Shift` to redo)                            |
| `Ctrl/Cmd + S`     | Save (`Shift` for save as)                        |
| `Ctrl/Cmd + O`     | Open                                              |

## On a phone

The three columns are a desktop luxury. Below 760px wide — or on anything
short enough that stacking two panes would leave each of them a couple of
centimetres, which is every phone in landscape — the layout shows **one pane at
a time**, switched from a bar along the bottom. All three stay mounted, so
switching panes costs no scroll position, no editor undo history and no
CodeMirror state; the two you are not looking at are `visibility: hidden`,
which also takes them out of the tab order and the accessibility tree.

Opening something steers that bar for you: tapping a slot brings up the editor,
tapping a chain brings up the stage the chain editor sits in. Otherwise a tap
in the project panel would look like it did nothing.

The transport keeps play, stop, the position readout and the live pills. The
other eleven controls fold into a tray behind `⋯`, because at a phone's width
they wrap into four rows and leave nothing for the grid. On a wide screen that
tray is `display: contents` — it is not a box at all, and the bar is the same
single flat row it has always been.

Sizing is by input device (`pointer: coarse`) rather than by viewport, so a
1024px tablet gets the same targets a phone does and a narrow desktop window
does not. Fields go to 16px there, which is the threshold below which iOS
Safari zooms the page on focus and never zooms back out.

**A symbol row sits between the editor and the keyboard.** Every character a
Strudel pattern is made of — `"`, `(`, `*`, `~`, `<`, `@` — is behind a layout
switch on a phone keyboard, so `s("bd*4, hh*8").gain(0.8)` costs eight round
trips to the symbol page and back. The row carries the ones that are not on the
letter page, in roughly the order a pattern needs them, plus the button that
plays what you just wrote. Brackets insert as pairs with the caret between
them and `→` steps over the closer, because a phone has no arrow keys and
placing a caret by tapping at it is a coin toss.

One thing follows the finger rather than the viewport: `--keyboard` carries how
much of the screen the on-screen keyboard is covering. Android shrinks the
layout viewport itself, but iOS Safari shrinks only the visual one, which would
leave the symbol row and the pane switcher underneath the keyboard exactly when
they are wanted.

`e2e/mobile.spec.ts` drives all of it at 390×844 with touch input and asserts
the properties that actually matter: nothing overflows sideways in any pane,
nothing is too small to hit, the pen tool and block dragging work from a
finger, and a whole pattern can be typed without ever leaving the letter
keyboard.

## Updates

An update is never applied on its own: swapping the service worker reloads the
page, and doing that in the middle of a set would stop the music. A new build
installs in the background, waits, and Chainsaw offers it — **a new version of
Chainsaw is ready**, with a reload button and a "not now".

That deliberate wait is also the trap, and it is worth knowing about because
the failure is silent. A waiting worker does not control the page, and a plain
reload does not hand it control: the old worker keeps serving the old cache, so
reloading appears to do nothing and the app looks stuck on an old version for
as long as any tab stays open. Two things have to happen, and both live in
`src/pwa.ts` — something has to _look_ for a new build, and something has to
_tell_ the app one is ready. Without the first, a long-lived tab never notices;
without the second, it notices and says nothing.

So Chainsaw checks on a timer, when the tab becomes visible again, and when the
network comes back — the browser's own check happens on navigation, which is no
help at all to a sequencer that has been open since before the deploy.

`e2e/update.spec.ts` tests this against a real deploy rather than a stub: the
test server reads from disk on every request, and the worker's bytes are what
the browser compares, so rewriting `dist/sw.js` mid-test _is_ a deploy.

## The project file

One `.chainsaw.json` document, validated on load and on every mutation against
`schema/project.schema.json` plus the referential rules in
`src/model/validate.ts`. A mutation that would produce an invalid document is
rejected whole — the store is left byte-identical and the reason is shown
inline. Ids are unique across slots _and_ chains, because a grid cell holds one
string and the resolver has to know which it is.

Where the File System Access API exists, Save writes back to the file you
opened; elsewhere it downloads. Either way a copy is autosaved to
`localStorage`, and an autosave that no longer validates is discarded rather
than loaded, so a bad one cannot wedge the app on boot.

**Opening an older project.** The schema is closed — `additionalProperties:
false` — so a field the format has dropped does not get ignored on load, it
makes the whole document invalid and the file refuses to open. `src/model/migrate.ts`
strips those fields on the way in, before validation sees them, and reports
what it removed so the app can say so rather than quietly discarding part of
someone's project.

Right now that means one thing: a project written before the arrangement was
removed loses its placements. Its slots and chains are untouched and still in
the project panel, ready to drop into a scene. Nothing is written back to disk
until you save, so the original file keeps its arrangement until you choose
otherwise.

## Answers to the PRD's open questions

1. **Strudel's current API.** Verified against `@strudel/core` 1.2.6 /
   `@strudel/webaudio` 1.3.0. Chainsaw drives `Cyclist` directly rather than
   using Strudel's `repl()`, which is what makes boundary-quantized swapping
   possible. Tempo is `scheduler.setCps`; at the defaults (120bpm, one cycle per
   bar, 4/4) that is 0.5, Strudel's own default, so a pattern typed here runs at
   the tempo it would in the stock REPL.

   `@strudel/core` imports `SalatRepl` from `@kabelsalat/web`, whose published
   bundle is an IIFE exposing no module exports — importing anything from
   `@strudel/core` fails outright under Vite, Vitest and Node alike. Since the
   REPL is unused, the package is aliased to a stub
   (`src/audio/shims/kabelsalat.ts`). Likewise `noteToMidi` is documented as
   exported from `@strudel/webaudio` but is absent from its built bundle, so it
   is reimplemented in `src/audio/note.ts` to identical rules.

2. **Composing `instrument.base` with `slot.code`.** Structurally, never by
   concatenating source. Both are evaluated separately and combined with
   `instrument.set.out(slot)`, which takes structure and value precedence from
   the slot and fills in whatever controls the instrument declared and the slot
   did not. Changing a slot's instrument therefore cannot disturb its code, and a
   slot can always override one of the instrument's controls by setting it.

3. **Keybindings.** See the table above.

4. **Baking live performance into an arrangement.** Moot: there is no
   arrangement to bake into. Chainsaw had a written timeline alongside the grid
   and it went, because a grid _and_ a timeline is two ways to say the same
   thing and one of them was Ableton's. `meta.lastSceneState` still records what
   was playing at save time, so a set comes back the way it was left.

## Editor behaviour

Committing a code edit is explicit by default — `Ctrl+Enter`, or leaving the
field — so a half-typed expression never reaches the audio. The `auto` checkbox
in the slot editor turns on the debounced-as-you-type behaviour the PRD also
allows.

Compile failures are attributed to the slot they came from and shown there; the
rest of the project keeps playing.

## Not in this version

Multi-performer sync, audio export, MIDI/OSC out, undo across sessions, and slot
variations. The document is flat and name-addressed, which is what a CRDT layer
would need later.

## Deployment

Every push to `main` that passes CI publishes to GitHub Pages
(`.github/workflows/pages.yml`). It waits on CI rather than running beside it,
and builds the commit CI passed on rather than whatever `main` has become since.

**One-time setup, by a repo admin:** Settings → Pages → Build and deployment →
Source: **GitHub Actions**. The workflow cannot do this for you. `GITHUB_TOKEN`
can deploy to Pages with `pages: write` but cannot create the site, which needs
admin, so until the switch is flipped the deploy fails at `configure-pages` with
"Resource not accessible by integration" — with the build already green above
it. Re-run the Pages workflow afterwards and it publishes.

Nothing about the build is Pages-specific. The app is built entirely
base-relative — asset URLs, the manifest's `scope` and `start_url`, and the
service worker's scope and precache list — so the same bundle works at a domain
root and under a folder like `/Chainsaw/` alike. That is easy to get wrong and
invisible until deployed, so CI runs the whole end-to-end suite at **both**
bases, offline test included:

```
npm run test:e2e                      # served at /
BASE_PATH=/Chainsaw/ npm run test:e2e # served at /Chainsaw/, as Pages does
```

`scripts/serve.mjs` is what serves them, rather than `vite preview`, because
preview can only serve a domain root and it is the folder case that breaks.
It also sends `Vary: Origin` on purpose — see the note in that file.

`public/.nojekyll` is belt and braces: artifact-based Pages deployment does not
run Jekyll at all, but it costs nothing and keeps things working if the repo is
ever switched to publishing from a branch.

To deploy somewhere else, serve `dist/` from anywhere; there is no server side
and no build-time host configuration.

## Licence

**AGPL-3.0-or-later** — see [LICENSE](LICENSE). This is not a free choice:
Chainsaw links against Strudel, which is AGPL, so it has to be.

Note what that means if you deploy it. Section 13 covers people who interact
with the program remotely over a network, which is what a hosted Chainsaw is:
they must be prominently offered its Corresponding Source. That is why the
transport bar carries a permanent **source** link (`src/source.ts`). If you fork
this and put it online, point that link at your fork — and keep it.

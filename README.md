# Chainsaw

A browser-based live-coding sequencer: **Strudel** patterns, **LSDJ**'s
phrase → chain → song structure, and an **Ableton**-style scene grid for
triggering over the top of a written arrangement.

Write a pattern, commit it to a named slot, sequence slots into chains, place
chains on a timeline, and improvise over all of it from the grid. Every edit
propagates to every place that references it, quantized to a bar boundary so
nothing glitches. The whole project is one human-readable JSON file.

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
| `src/ui/`          | One component per surface: transport, grid, arrangement, editors, panel           |

The layer worth reading first is `src/audio/timeline.ts`. It resolves the whole
project — slots, chains, arrangement, live overrides — into per-track
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

**Patterns are queried at absolute time.** A slot sitting at cycle 12 of the
arrangement is queried at cycle 12, so `note("<c e g>")` keeps advancing across
the song exactly as it would in the stock Strudel REPL. Strudel's own `slowcat`
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

## Keys

Ableton's transport, Strudel's evaluate. Nothing fires while the caret is in a
text field.

| Key                | Does                                              |
| ------------------ | ------------------------------------------------- |
| `Ctrl/Cmd + Enter` | Evaluate the scratch pad / commit the slot's code |
| `Space`            | Play or pause                                     |
| `Ctrl/Cmd + .`     | Stop                                              |
| `Esc`              | Drop live overrides, return to the arrangement    |
| `Ctrl/Cmd + Z`     | Undo (`Shift` to redo)                            |
| `Ctrl/Cmd + S`     | Save (`Shift` for save as)                        |
| `Ctrl/Cmd + O`     | Open                                              |

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

4. **Baking live performance into the arrangement.** Not implemented, and the
   schema does not preclude it: `meta.lastSceneState` already records what was
   playing at save time in the same shape a scene uses, so a future "bake" only
   has to write placements from it.

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

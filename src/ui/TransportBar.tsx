import { useState } from 'react'
import { midiSupported } from '../audio/midiAccess'
import { QUANTIZE_OPTIONS, type Quantize } from '../model/types'
import { SOURCE_URL, LICENSE } from '../source'
import { CommittedInput } from './CommittedInput'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'

/** Sentinel option value: choosing it asks for MIDI access rather than a port. */
const ENABLE = '__enable__'

export interface TransportBarProps {
  onSave: () => void
  onSaveAs: () => void
  onOpen: () => void
  onNew: () => void
}

/**
 * Play/stop, tempo, position, master volume and the global quantize (PRD §8.1).
 *
 * Everything past the transport itself lives in `.transport-more`, which is
 * `display: contents` on a wide screen — one flat row, exactly as before — and
 * a collapsible tray on a narrow one, where fifteen controls would otherwise
 * wrap into four rows and leave no room for the grid.
 */
export function TransportBar({ onSave, onSaveAs, onOpen, onNew }: TransportBarProps) {
  const [showMore, setShowMore] = useState(false)
  const project = useProject((state) => state.project)
  const dirty = useProject((state) => state.dirty)
  const setMeta = useProject((state) => state.setMeta)
  const undo = useProject((state) => state.undo)
  const redo = useProject((state) => state.redo)
  const canUndo = useProject((state) => state.past.length > 0)
  const canRedo = useProject((state) => state.future.length > 0)

  const status = useRuntime((state) => state.status)
  const masterVolume = useRuntime((state) => state.masterVolume)
  const setMasterVolume = useRuntime((state) => state.setMasterVolume)
  const tracksPlaying = useRuntime((state) => state.tracksPlaying)
  const play = useRuntime((state) => state.play)
  const pause = useRuntime((state) => state.pause)
  const stop = useRuntime((state) => state.stop)
  const activeScene = useRuntime((state) => state.activeScene)
  const overrides = useRuntime((state) => state.overrides)
  const stopAll = useRuntime((state) => state.stopAll)
  const midiOutputs = useRuntime((state) => state.midiOutputs)
  const midiOutputId = useRuntime((state) => state.midiOutputId)
  const enableMidi = useRuntime((state) => state.enableMidi)
  const setMidiOutput = useRuntime((state) => state.setMidiOutput)
  const scratchMode = useRuntime((state) => state.scratchMode)
  const scratchLive = useRuntime((state) => state.scratchLive)
  const setScratchMode = useRuntime((state) => state.setScratchMode)

  const bar = Math.floor(status.bar)
  const beatInBar = status.bar - bar
  const live = Object.keys(overrides).length > 0
  const playing = status.started && tracksPlaying

  return (
    <header className="transport">
      <div className="transport-group">
        {/*
         * Reflects the song, not the clock. Evaluating a scratch pattern runs
         * the clock without the song, and showing that as "playing" would say
         * the grid is running when it is silent.
         */}
        <button
          className={`play ${playing ? 'on' : ''}`}
          onClick={() => (playing ? pause() : void play())}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={stop} aria-label="Stop" title="Stop (Ctrl+.)">
          ■
        </button>
      </div>

      <div className="transport-group counter" aria-live="off">
        <span className="counter-bar" aria-label="Bar">
          {String(bar + 1).padStart(3, '0')}
        </span>
        <span className="counter-sub">.{Math.floor(beatInBar * 4) + 1}</span>
        <span className="counter-cycle">cyc {status.cycle.toFixed(2)}</span>
      </div>

      {status.pendingAt !== null && (
        <span className="pill pending" title="A change is queued for the next boundary">
          queued → cyc {status.pendingAt.toFixed(0)}
        </span>
      )}
      {live && (
        <button className="pill live" onClick={stopAll} title="Stop every clip (Esc)">
          live{activeScene ? `: ${activeScene}` : ''} ✕
        </button>
      )}
      {/* The scratch layer sounds from wherever you are, so it has to be
          visible — and stoppable — from wherever you are. */}
      {scratchLive && scratchMode !== 'off' && (
        <button
          className="pill scratch"
          onClick={() => setScratchMode('off')}
          title="The scratch pad is in the mix. Click to mute it."
        >
          scratch{scratchMode === 'solo' ? ' solo' : ''}
        </button>
      )}

      <button
        className={`transport-toggle ${showMore ? 'on' : ''}`}
        onClick={() => setShowMore(!showMore)}
        aria-expanded={showMore}
        aria-label="Project and tempo controls"
        title="Project and tempo controls"
      >
        ⋯
      </button>

      <div className={`transport-more ${showMore ? 'open' : ''}`}>
        <label className="field">
          <span>bpm</span>
          <input
            type="number"
            min={20}
            max={400}
            step={1}
            value={project.meta.bpm}
            onChange={(event) => setMeta({ bpm: Number(event.target.value) })}
          />
        </label>

        <label className="field">
          <span>cyc/bar</span>
          <input
            type="number"
            min={0.25}
            max={16}
            step={0.25}
            value={project.meta.cyclesPerBar}
            onChange={(event) => setMeta({ cyclesPerBar: Number(event.target.value) })}
          />
        </label>

        <label className="field">
          <span>tracks</span>
          <input
            type="number"
            min={1}
            max={32}
            value={project.meta.trackCount}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (next < project.meta.trackCount && !confirmTruncate(next)) return
              setMeta({ trackCount: next })
            }}
          />
        </label>

        <label className="field">
          <span>quantize</span>
          <select
            value={project.meta.quantize ?? 'bar'}
            onChange={(event) => setMeta({ quantize: event.target.value as Quantize })}
          >
            {QUANTIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'bar' ? 'next bar' : option === 'cycle' ? 'next cycle' : 'immediate'}
              </option>
            ))}
          </select>
        </label>

        {/*
         * MIDI access prompts the user, so it is not requested on load — the
         * list stays empty until someone shows interest by opening this.
         */}
        {midiSupported() && (
          <label className="field">
            <span>midi</span>
            <select
              value={midiOutputId ?? ''}
              onChange={(event) => {
                if (event.target.value === ENABLE) void enableMidi()
                else setMidiOutput(event.target.value || null)
              }}
              title="Send MIDI clock, start/stop and song position to this output"
            >
              <option value="">off</option>
              {midiOutputs.map((output) => (
                <option key={output.id} value={output.id}>
                  {output.name}
                </option>
              ))}
              {midiOutputs.length === 0 && <option value={ENABLE}>enable…</option>}
            </select>
          </label>
        )}

        <label className="field volume">
          <span>vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(event) => setMasterVolume(Number(event.target.value))}
            aria-label="Master volume"
          />
        </label>

        <div className="transport-group right">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
          <CommittedInput
            className="project-name"
            value={project.meta.name}
            onCommit={(name) => setMeta({ name })}
            ariaLabel="Project name"
          />
          {dirty && <span className="dot" title="Unsaved changes" />}
          <button onClick={onNew}>new</button>
          <button onClick={onOpen} title="Open (Ctrl+O)">
            open
          </button>
          <button onClick={onSave} title="Save (Ctrl+S)">
            save
          </button>
          <button onClick={onSaveAs} title="Save as (Ctrl+Shift+S)">
            save as
          </button>
          {/* AGPL §13: anyone using this over a network is offered the source. */}
          <a
            className="source-link"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener license"
            title={`Chainsaw is free software (${LICENSE}) — get the source`}
          >
            source
          </a>
        </div>
      </div>
    </header>
  )
}

function confirmTruncate(next: number): boolean {
  return window.confirm(`Reducing to ${next} tracks removes any scene cells above track ${next}. Continue?`)
}

import { QUANTIZE_OPTIONS, type Quantize } from '../model/types'
import { CommittedInput } from './CommittedInput'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'

export interface TransportBarProps {
  onSave: () => void
  onSaveAs: () => void
  onOpen: () => void
  onNew: () => void
}

/** Play/stop, tempo, position, master volume and the global quantize (PRD §8.1). */
export function TransportBar({ onSave, onSaveAs, onOpen, onNew }: TransportBarProps) {
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
  const play = useRuntime((state) => state.play)
  const pause = useRuntime((state) => state.pause)
  const stop = useRuntime((state) => state.stop)
  const activeScene = useRuntime((state) => state.activeScene)
  const overrides = useRuntime((state) => state.overrides)
  const returnToArrangement = useRuntime((state) => state.returnToArrangement)

  const bar = Math.floor(status.bar)
  const beatInBar = status.bar - bar
  const live = Object.keys(overrides).length > 0

  return (
    <header className="transport">
      <div className="transport-group">
        <button
          className={`play ${status.started ? 'on' : ''}`}
          onClick={() => (status.started ? pause() : void play())}
          aria-label={status.started ? 'Pause' : 'Play'}
          title={status.started ? 'Pause (space)' : 'Play (space)'}
        >
          {status.started ? '❚❚' : '▶'}
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

      {status.pendingAt !== null && (
        <span className="pill pending" title="A change is queued for the next boundary">
          queued → cyc {status.pendingAt.toFixed(0)}
        </span>
      )}
      {live && (
        <button className="pill live" onClick={returnToArrangement} title="Return to arrangement (Esc)">
          live{activeScene ? `: ${activeScene}` : ''} ⏎ arrangement
        </button>
      )}

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
      </div>
    </header>
  )
}

function confirmTruncate(next: number): boolean {
  return window.confirm(`Reducing to ${next} tracks removes any arrangement and scene cells above track ${next}. Continue?`)
}

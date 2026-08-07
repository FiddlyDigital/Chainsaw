import { useCallback, useEffect, useRef, useState } from 'react'
import { nextId } from '../model/defaults'
import { STEP_RESOLUTIONS, type StepResolution } from '../model/types'
import { slotCycles } from '../audio/timing'
import { referencesToSlot } from '../audio/timeline'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { CommittedInput } from './CommittedInput'
import { PatternKeys } from './PatternKeys'
import { useCoarsePointer } from './viewport'

/** Delay before an auto-committing editor pushes an edit into the project. */
const AUTO_COMMIT_MS = 300

/**
 * The scratch pad and the slot editor (PRD §8.2, §8.3), which are the same
 * editor pointed at different things.
 *
 * Committing is explicit by default — Ctrl+Enter, or leaving the field — so a
 * half-typed expression never reaches the audio. Turning on `auto` gives the
 * debounced behaviour §7.3 also allows, for performers who want the pattern to
 * follow their typing.
 */
export function EditorPanel() {
  const editing = useRuntime((state) => state.editing)
  return editing ? <SlotEditor key={editing} slotId={editing} /> : <ScratchPad />
}

function ScratchPad() {
  const scratch = useRuntime((state) => state.scratch)
  const setScratch = useRuntime((state) => state.setScratch)
  const evaluateScratch = useRuntime((state) => state.evaluateScratch)
  const scratchError = useRuntime((state) => state.scratchError)
  const scratchMode = useRuntime((state) => state.scratchMode)
  const setScratchMode = useRuntime((state) => state.setScratchMode)
  const clearScratch = useRuntime((state) => state.clearScratch)
  const setEditing = useRuntime((state) => state.setEditing)
  const project = useProject((state) => state.project)
  const createSlot = useProject((state) => state.createSlot)
  const coarse = useCoarsePointer()
  const editor = useRef<CodeEditorHandle>(null)
  // The editor owns the text; nothing here renders it, so a ref is enough and
  // typing costs no re-renders.
  const draft = useRef(scratch)

  const commitToSlot = () => {
    const code = draft.current
    const suggestion = nextId('A', Object.keys(project.slots))
    const id = window.prompt('Commit this pattern to which slot?', suggestion)
    if (!id) return
    if (project.slots[id]) {
      if (!window.confirm(`Slot "${id}" already exists. Replace its code?`)) return
      useProject.getState().updateSlot(id, { code })
    } else if (!createSlot(id, { code })) {
      return
    }
    setEditing(id)
  }

  return (
    <section className="editor-panel">
      <header className="editor-head">
        <h2>scratch</h2>
        <span className="hint keys">
          Ctrl+Enter to evaluate — plays alongside the tracks, like the stock REPL. Mute or solo to change the mix.
        </span>
        <div className="spacer" />
        <button onClick={() => void evaluateScratch(draft.current)}>evaluate</button>
        {/*
         * A channel strip for the scratch layer: mute takes it out of the mix
         * and solo takes everything else out, both at the next boundary like
         * any other change. The pattern survives either way, so these are
         * faders rather than an undo — which is what makes them usable
         * mid-set.
         */}
        <button
          className={scratchMode === 'off' ? 'on' : ''}
          onClick={() => setScratchMode(scratchMode === 'off' ? 'stack' : 'off')}
          aria-pressed={scratchMode === 'off'}
          title="Take the scratch pattern out of the mix, keeping it ready"
        >
          mute
        </button>
        <button
          className={scratchMode === 'solo' ? 'on' : ''}
          onClick={() => setScratchMode(scratchMode === 'solo' ? 'stack' : 'solo')}
          aria-pressed={scratchMode === 'solo'}
          title="Play the scratch pattern on its own, silencing the tracks"
        >
          solo
        </button>
        <button onClick={commitToSlot} title="Turn this pattern into a reusable slot">
          commit to slot…
        </button>
        <button onClick={clearScratch} title="Discard the scratch pattern without touching the tracks">
          hush
        </button>
      </header>
      <CodeEditor
        ref={editor}
        value={scratch}
        onChange={(code) => {
          draft.current = code
        }}
        onEvaluate={(code) => {
          setScratch(code)
          void evaluateScratch(code)
        }}
        ariaLabel="Scratch pad"
        placeholder={'s("bd*4, hh*8")'}
      />
      {scratchError && <p className="inline-error">{scratchError}</p>}
      {coarse && (
        <PatternKeys
          editor={editor}
          onRun={() => void evaluateScratch(editor.current?.read() ?? draft.current)}
          runLabel="play"
        />
      )}
    </section>
  )
}

function SlotEditor({ slotId }: { slotId: string }) {
  const project = useProject((state) => state.project)
  const updateSlot = useProject((state) => state.updateSlot)
  const renameSlot = useProject((state) => state.renameSlot)
  const setEditing = useRuntime((state) => state.setEditing)
  const errors = useRuntime((state) => state.status.errors)

  const coarse = useCoarsePointer()
  const editor = useRef<CodeEditorHandle>(null)

  const slot = project.slots[slotId]
  // The editor is the document's home while it is open; `draft` only carries
  // the latest text over to whatever commits it. Passing the stored code back
  // in as `value` is what lets an undo or a file load reach an open editor.
  const draft = useRef(slot?.code ?? '')
  const [auto, setAuto] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const commit = useCallback(
    (code: string) => {
      if (code !== useProject.getState().project.slots[slotId]?.code) updateSlot(slotId, { code })
    },
    [slotId, updateSlot],
  )

  const onChange = useCallback(
    (code: string) => {
      draft.current = code
      if (!auto) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => commit(code), AUTO_COMMIT_MS)
    },
    [auto, commit],
  )

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  if (!slot) {
    return (
      <section className="editor-panel">
        <header className="editor-head">
          <h2>slot {slotId}</h2>
          <button onClick={() => setEditing(null)}>close</button>
        </header>
        <p className="inline-error">This slot no longer exists.</p>
      </section>
    )
  }

  const uses = referencesToSlot(project, slotId)
  const error = errors[`slot ${slotId}`]

  return (
    <section className="editor-panel" onBlur={() => commit(draft.current)}>
      <header className="editor-head">
        <h2>
          slot
          <CommittedInput
            className="id-input"
            value={slotId}
            onCommit={(next) => {
              if (!renameSlot(slotId, next)) return false
              setEditing(next)
              return true
            }}
            ariaLabel="Slot id"
          />
        </h2>
        <span className="hint">
          {slotCycles(slot)} cycle{slotCycles(slot) === 1 ? '' : 's'}
          {uses.chains.length > 0 && ` · used by ${uses.chains.join(', ')}`}
        </span>
        <div className="spacer" />
        <label className="check" title="Commit edits as you type, debounced">
          <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
          auto
        </label>
        <button onClick={() => commit(draft.current)}>commit</button>
        <button onClick={() => setEditing(null)}>close</button>
      </header>

      <div className="slot-fields">
        <label className="field">
          <span>instrument</span>
          <select
            value={slot.instrument ?? ''}
            onChange={(event) =>
              updateSlot(slotId, event.target.value ? { instrument: event.target.value } : { instrument: undefined })
            }
          >
            <option value="">none</option>
            {Object.keys(project.instruments).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>length</span>
          <input
            type="number"
            min={1}
            max={256}
            value={slot.length}
            onChange={(event) => updateSlot(slotId, { length: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>steps</span>
          <select value={slot.steps} onChange={(event) => updateSlot(slotId, { steps: event.target.value as StepResolution })}>
            {STEP_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>colour</span>
          <input type="color" value={slot.color} onChange={(event) => updateSlot(slotId, { color: event.target.value })} />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={slot.muted}
            onChange={(event) => updateSlot(slotId, { muted: event.target.checked })}
          />
          mute
        </label>
      </div>

      <CodeEditor
        ref={editor}
        value={slot.code}
        onChange={onChange}
        onEvaluate={commit}
        ariaLabel={`Slot ${slotId} code`}
        placeholder={slot.instrument ? 'note("c e g")' : 's("bd*4")'}
      />
      {error && <p className="inline-error">{error}</p>}
      {coarse && (
        <PatternKeys editor={editor} onRun={() => commit(editor.current?.read() ?? draft.current)} runLabel="commit" />
      )}
      {slot.instrument && (
        <p className="hint footnote">
          composed with instrument <code>{slot.instrument}</code>: {project.instruments[slot.instrument]?.base}
        </p>
      )}
    </section>
  )
}

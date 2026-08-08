import { useCallback, useEffect, useRef } from 'react'
import { emptyProject } from './model/defaults'
import { clearAutosave, readAutosave } from './persistence/autosave'
import { openProject, saveAs, writeTo } from './persistence/files'
import { useProject } from './store/project'
import { useRuntime } from './store/runtime'
import { ChainEditor } from './ui/ChainEditor'
import { EditorPanel } from './ui/EditorPanel'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { GridView } from './ui/GridView'
import { ProjectPanel } from './ui/ProjectPanel'
import { TransportBar } from './ui/TransportBar'
import { UpdateBanner } from './ui/UpdateBanner'
import { useAutosave, useEngineSync, useFailureReports, useSceneFollow, useShortcuts } from './ui/useAppEffects'
import { useKeyboardInset } from './ui/viewport'

export default function App() {
  useEngineSync()
  useAutosave()
  useSceneFollow()
  useFailureReports()
  useKeyboardInset()

  const load = useProject((state) => state.load)
  const markSaved = useProject((state) => state.markSaved)
  const sheet = useRuntime((state) => state.sheet)
  const setSheet = useRuntime((state) => state.setSheet)
  const toggleSheet = useRuntime((state) => state.toggleSheet)
  const editing = useRuntime((state) => state.editing)
  const editingPrebake = useRuntime((state) => state.editingPrebake)
  const editingChain = useRuntime((state) => state.editingChain)
  const audioReady = useRuntime((state) => state.status.audioReady)
  // A sheet covers most of the grid, so the bar that opens it says what is
  // going on behind it.
  const failing = useRuntime((state) => Object.keys(state.status.errors).length > 0)

  const handle = useRef<FileSystemFileHandle | null>(null)
  // In the store rather than in this component, so anything can raise one:
  // a rejected mutation, an autosave that could not write, a promise that
  // failed with nobody waiting on it.
  const notice = useRuntime((state) => state.notice)
  const setNotice = useRuntime((state) => state.notify)
  const dismissNotice = useRuntime((state) => state.dismissNotice)

  // Pick up where the last session left off. A stored document that no longer
  // validates is ignored by `readAutosave`, so this cannot wedge the app.
  useEffect(() => {
    const saved = readAutosave()
    if (saved && load(saved)) useRuntime.getState().adoptProject()
  }, [load])

  // …including the MIDI output, where the browser will reconnect silently.
  useEffect(() => {
    void useRuntime.getState().restoreMidi()
  }, [])

  const doSave = useCallback(async () => {
    const project = useProject.getState().project
    try {
      if (handle.current) {
        await writeTo(handle.current, project)
      } else {
        handle.current = await saveAs(project)
      }
      markSaved()
      setNotice(`saved ${project.meta.name}`)
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      setNotice(`could not save: ${error instanceof Error ? error.message : String(error)}`, 'bad')
    }
  }, [markSaved, setNotice])

  const doSaveAs = useCallback(async () => {
    const project = useProject.getState().project
    try {
      handle.current = await saveAs(project)
      markSaved()
      setNotice(`saved ${project.meta.name}`)
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      setNotice(`could not save: ${error instanceof Error ? error.message : String(error)}`, 'bad')
    }
  }, [markSaved, setNotice])

  const doOpen = useCallback(async () => {
    try {
      const opened = await openProject()
      if (!opened) return
      if (load(opened.project)) {
        useRuntime.getState().adoptProject()
        handle.current = opened.handle
        // Say what an older file lost on the way in. Dropping part of someone's
        // project without mentioning it is how they find out much later.
        setNotice(
          opened.dropped.length > 0
            ? `opened ${opened.project.meta.name} — dropped ${opened.dropped.join('; ')}`
            : `opened ${opened.project.meta.name}`,
        )
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      setNotice(error instanceof Error ? error.message : String(error), 'bad')
    }
  }, [load, setNotice])

  const doNew = useCallback(() => {
    if (useProject.getState().dirty && !window.confirm('Discard unsaved changes and start a new project?')) return
    handle.current = null
    clearAutosave()
    if (load(emptyProject())) useRuntime.getState().adoptProject()
  }, [load])

  useShortcuts({ onSave: () => void doSave(), onSaveAs: () => void doSaveAs(), onOpen: () => void doOpen() })

  // An error stays until it is dismissed. "saved" does not need reading twice;
  // "could not save" does, and three seconds is not long enough to notice it
  // from across a room.
  useEffect(() => {
    if (!notice || notice.tone === 'bad') return
    const timer = setTimeout(dismissNotice, 3000)
    return () => clearTimeout(timer)
  }, [notice, dismissNotice])

  return (
    <div className="app">
      <TransportBar onSave={() => void doSave()} onSaveAs={() => void doSaveAs()} onOpen={() => void doOpen()} onNew={doNew} />

      {/*
       * `data-sheet` is what the narrow layout reads. There the grid is the
       * screen — it is the song, and a phone has room for one thing — and the
       * two side panels come over it and go away again. Every panel stays
       * mounted either way, so opening one never costs an editor its undo
       * history or a scroll position.
       *
       * One boundary per panel rather than one around the lot: a slot whose
       * code breaks the editor's render should cost the editor, not the grid
       * that is currently playing and not the transport that stops it.
       */}
      <main className="body" data-sheet={sheet ?? ''}>
        <div className="stage">
          {!audioReady && (
            <p className="hint stage-hint" role="status">
              press play to start audio
            </p>
          )}
          <ErrorBoundary where="grid">
            <GridView />
          </ErrorBoundary>
          {editingChain && (
            <ErrorBoundary where="chain editor" compact>
              <ChainEditor />
            </ErrorBoundary>
          )}
        </div>

        {/* Tapping the grid behind an open sheet puts it away, which is the
            gesture people try first and the fastest way back to the clips. */}
        <button className="scrim" onClick={() => setSheet(null)} aria-label="Close panel" tabIndex={sheet ? 0 : -1} />

        <Sheet name="project" open={sheet === 'project'} onClose={() => setSheet(null)}>
          <ErrorBoundary where="project panel">
            <ProjectPanel />
          </ErrorBoundary>
        </Sheet>

        <Sheet name="editor" open={sheet === 'editor'} onClose={() => setSheet(null)}>
          <ErrorBoundary where="editor">
            <EditorPanel />
          </ErrorBoundary>
        </Sheet>
      </main>

      {/* Narrow screens only: what brings the two panels over the grid. */}
      <nav className="dock" aria-label="Panels">
        <button
          className={sheet === 'project' ? 'on' : ''}
          onClick={() => toggleSheet('project')}
          aria-expanded={sheet === 'project'}
        >
          project
        </button>
        <button
          className={sheet === 'editor' ? 'on' : ''}
          onClick={() => toggleSheet('editor')}
          aria-expanded={sheet === 'editor'}
        >
          {editingPrebake ? 'prebake' : editing ? `slot ${editing}` : 'scratch'}
          {failing && <span className="dock-mark bad" title="A pattern failed to compile" />}
        </button>
      </nav>

      <UpdateBanner />
      {notice && (
        <div className={`notice ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'} key={notice.id}>
          {notice.message}
          {notice.tone === 'bad' && (
            <button className="mini" onClick={dismissNotice} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One of the two panels that slide over the grid on a narrow screen.
 *
 * `display: contents` above the breakpoint, so on a wide screen this element
 * is not in the layout at all and the panel inside it is a column of the grid
 * exactly as if the wrapper were not there — the same trick the transport's
 * tray uses. Everything that makes it a sheet is in the narrow query.
 */
function Sheet({
  name,
  open,
  onClose,
  children,
}: {
  name: string
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`sheet sheet-${name} ${open ? 'open' : ''}`}>
      {/* Looks like the grab handle the shape implies, and does what pulling
          one down would do — a phone with no Escape key needs a target that is
          not a 30px × in a corner. */}
      <button className="sheet-handle" onClick={onClose} aria-label={`Close ${name}`} tabIndex={open ? 0 : -1} />
      {children}
    </div>
  )
}

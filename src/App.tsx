import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyProject } from './model/defaults'
import { clearAutosave, readAutosave } from './persistence/autosave'
import { openProject, saveAs, writeTo } from './persistence/files'
import { useProject } from './store/project'
import { useRuntime } from './store/runtime'
import { ChainEditor } from './ui/ChainEditor'
import { EditorPanel } from './ui/EditorPanel'
import { GridView } from './ui/GridView'
import { ProjectPanel } from './ui/ProjectPanel'
import { TransportBar } from './ui/TransportBar'
import { UpdateBanner } from './ui/UpdateBanner'
import { useAutosave, useEngineSync, useSceneFollow, useShortcuts } from './ui/useAppEffects'
import { useKeyboardInset } from './ui/viewport'

export default function App() {
  useEngineSync()
  useAutosave()
  useSceneFollow()
  useKeyboardInset()

  const load = useProject((state) => state.load)
  const markSaved = useProject((state) => state.markSaved)
  const pane = useRuntime((state) => state.pane)
  const setPane = useRuntime((state) => state.setPane)
  const editing = useRuntime((state) => state.editing)
  const editingChain = useRuntime((state) => state.editingChain)
  const audioReady = useRuntime((state) => state.status.audioReady)
  // The pane switcher hides two thirds of the app at a time, so it carries the
  // two things you would otherwise have to go and look for.
  const live = useRuntime((state) => Object.keys(state.overrides).length > 0)
  const failing = useRuntime((state) => Object.keys(state.status.errors).length > 0)

  const handle = useRef<FileSystemFileHandle | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
      setNotice(`could not save: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [markSaved])

  const doSaveAs = useCallback(async () => {
    const project = useProject.getState().project
    try {
      handle.current = await saveAs(project)
      markSaved()
      setNotice(`saved ${project.meta.name}`)
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      setNotice(`could not save: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [markSaved])

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
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [load])

  const doNew = useCallback(() => {
    if (useProject.getState().dirty && !window.confirm('Discard unsaved changes and start a new project?')) return
    handle.current = null
    clearAutosave()
    if (load(emptyProject())) useRuntime.getState().adoptProject()
  }, [load])

  useShortcuts({ onSave: () => void doSave(), onSaveAs: () => void doSaveAs(), onOpen: () => void doOpen() })

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <div className="app">
      <TransportBar onSave={() => void doSave()} onSaveAs={() => void doSaveAs()} onOpen={() => void doOpen()} onNew={doNew} />

      {/* `data-pane` is what the narrow layout reads to show one column at a
          time. Every column stays mounted either way, so switching panes never
          costs an editor its undo history or a scroll position. */}
      <main className="body" data-pane={pane}>
        <ProjectPanel />

        <div className="stage">
          {!audioReady && (
            <p className="hint stage-hint" role="status">
              press play to start audio
            </p>
          )}
          <GridView />
          {editingChain && <ChainEditor />}
        </div>

        <EditorPanel />
      </main>

      {/* Narrow screens only: the column switcher. */}
      <nav className="pane-bar" aria-label="Panes">
        <button className={pane === 'project' ? 'on' : ''} onClick={() => setPane('project')} aria-current={pane === 'project'}>
          project
        </button>
        <button className={pane === 'stage' ? 'on' : ''} onClick={() => setPane('stage')} aria-current={pane === 'stage'}>
          grid
          {live && <span className="pane-mark live" title="Something is playing in the grid" />}
        </button>
        <button className={pane === 'editor' ? 'on' : ''} onClick={() => setPane('editor')} aria-current={pane === 'editor'}>
          {editing ? `slot ${editing}` : 'scratch'}
          {failing && <span className="pane-mark bad" title="A pattern failed to compile" />}
        </button>
      </nav>

      <UpdateBanner />
      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}

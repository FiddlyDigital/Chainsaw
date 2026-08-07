import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyProject } from './model/defaults'
import { clearAutosave, readAutosave } from './persistence/autosave'
import { openProject, saveAs, writeTo } from './persistence/files'
import { useProject } from './store/project'
import { useRuntime } from './store/runtime'
import { ArrangementView } from './ui/ArrangementView'
import { ChainEditor } from './ui/ChainEditor'
import { EditorPanel } from './ui/EditorPanel'
import { GridView } from './ui/GridView'
import { ProjectPanel } from './ui/ProjectPanel'
import { TransportBar } from './ui/TransportBar'
import { useAutosave, useEngineSync, useShortcuts } from './ui/useAppEffects'

export default function App() {
  useEngineSync()
  useAutosave()

  const load = useProject((state) => state.load)
  const markSaved = useProject((state) => state.markSaved)
  const panel = useRuntime((state) => state.panel)
  const setPanel = useRuntime((state) => state.setPanel)
  const editingChain = useRuntime((state) => state.editingChain)
  const audioReady = useRuntime((state) => state.status.audioReady)

  const handle = useRef<FileSystemFileHandle | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Pick up where the last session left off. A stored document that no longer
  // validates is ignored by `readAutosave`, so this cannot wedge the app.
  useEffect(() => {
    const saved = readAutosave()
    if (saved) load(saved)
  }, [load])

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
        handle.current = opened.handle
        setNotice(`opened ${opened.project.meta.name}`)
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
    load(emptyProject())
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

      <main className="body">
        <ProjectPanel />

        <div className="stage">
          <nav className="tabs">
            <button className={panel === 'grid' ? 'on' : ''} onClick={() => setPanel('grid')}>
              grid
            </button>
            <button className={panel === 'arrangement' ? 'on' : ''} onClick={() => setPanel('arrangement')}>
              arrangement
            </button>
            {!audioReady && <span className="hint">press play to start audio</span>}
          </nav>
          {panel === 'grid' ? <GridView /> : <ArrangementView />}
          {editingChain && <ChainEditor />}
        </div>

        <EditorPanel />
      </main>

      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}

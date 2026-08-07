/**
 * The wiring between the store, the scheduler and the browser.
 *
 * All of it is one-directional and lives here rather than in components:
 * project changes flow to the Engine and to autosave, and keyboard shortcuts
 * flow back into store actions.
 */
import { useEffect } from 'react'
import { debounce, writeAutosave } from '../persistence/autosave'
import { useProject } from '../store/project'
import { getEngine, useRuntime } from '../store/runtime'

/** Push every accepted document into the scheduler. */
export function useEngineSync(): void {
  useEffect(() => {
    const engine = getEngine()
    void engine.setProject(useProject.getState().project)
    let last = useProject.getState().project
    const unsubscribe = useProject.subscribe((state) => {
      if (state.project === last) return
      last = state.project
      void engine.setProject(state.project)
    })
    return () => {
      unsubscribe()
      engine.dispose()
    }
  }, [])
}

/** Keep a recent copy in localStorage. Never blocks, never throws. */
export function useAutosave(): void {
  useEffect(() => {
    const flush = debounce((project: Parameters<typeof writeAutosave>[0]) => writeAutosave(project), 1000)
    let last = useProject.getState().project
    const unsubscribe = useProject.subscribe((state) => {
      if (state.project === last) return
      last = state.project
      flush(state.project)
    })
    return () => {
      unsubscribe()
      flush.cancel()
    }
  }, [])
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

export interface Shortcuts {
  onSave: () => void
  onSaveAs: () => void
  onOpen: () => void
}

/**
 * Transport and file shortcuts.
 *
 * Mostly Ableton's (space, Ctrl+. to stop) with Strudel's Ctrl+Enter for
 * evaluate, which the editors handle themselves. Nothing fires while the caret
 * is in a text field, so typing a pattern never stops the transport.
 */
export function useShortcuts({ onSave, onSaveAs, onOpen }: Shortcuts): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const runtime = useRuntime.getState()

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        ;(event.shiftKey ? onSaveAs : onSave)()
        return
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        onOpen()
        return
      }
      if (mod && event.key === '.') {
        event.preventDefault()
        runtime.stop()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        if (isTyping(event.target)) return // let the editor keep its own history
        event.preventDefault()
        if (event.shiftKey) useProject.getState().redo()
        else useProject.getState().undo()
        return
      }
      if (isTyping(event.target)) return

      if (event.key === ' ') {
        event.preventDefault()
        if (runtime.status.started) runtime.pause()
        else void runtime.play()
        return
      }
      if (event.key === 'Escape') {
        runtime.returnToArrangement()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, onSaveAs, onOpen])
}

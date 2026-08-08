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

/**
 * Everything that can go wrong away from a button press, said out loud.
 *
 * Three things used to fail in silence: a mutation the store rejected, which
 * was reported only inside the project panel — a pane that is not on screen at
 * all on a phone; a promise nobody awaited; and an error thrown outside React's
 * tree, where an error boundary cannot reach. None of them are things the
 * performer can be expected to deduce from the music stopping.
 */
export function useFailureReports(): void {
  useEffect(() => {
    const { notify } = useRuntime.getState()

    let lastReported = useProject.getState().lastError
    const unsubscribe = useProject.subscribe((state) => {
      if (state.lastError === lastReported) return
      lastReported = state.lastError
      if (state.lastError) notify(state.lastError, 'bad')
    })

    const onError = (event: ErrorEvent) => notify(event.message || 'something went wrong', 'bad')
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      notify(reason instanceof Error ? reason.message : String(reason), 'bad')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      unsubscribe()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}

/** Keep a recent copy in localStorage. Never blocks, never throws. */
export function useAutosave(): void {
  useEffect(() => {
    // Storage full, or turned off. Said once and not again: it fails on every
    // keystroke after the first, and the file on disk is still the truth.
    let warned = false
    const save = (project: Parameters<typeof writeAutosave>[0]) => {
      if (writeAutosave(project) || warned) return
      warned = true
      useRuntime.getState().notify('could not autosave — save to a file to be safe', 'bad')
    }
    const flush = debounce(save, 1000)
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

/**
 * How far ahead of a scene's end to ask for the next one, in cycles.
 *
 * The trigger is quantized like any other, so it has to be asked for *inside*
 * the boundary it should land on, not at it — request it exactly on the end and
 * the quantizer rounds up to the following bar and leaves a gap. Small enough
 * that it cannot reach back past an earlier boundary, comfortably larger than
 * the frame that notices it is due.
 */
const FOLLOW_LEAD_CYCLES = 0.05

/**
 * Fire the next scene when the current one has played through.
 *
 * Subscribing to the transport rather than running a timer of its own means
 * this cannot disagree with the position everything else is reading. The store
 * decides *when* a scene is done — `sceneEndsAt`, computed once when the scene
 * was triggered — so all this does is notice the moment arriving.
 */
export function useSceneFollow(): void {
  useEffect(
    () =>
      useRuntime.subscribe((state) => {
        if (!state.autoAdvance || !state.status.started) return
        if (state.sceneEndsAt === null) return
        // Inside a store subscriber: a throw here would propagate back into
        // whichever `set` published the frame, and the transport is what
        // publishes those.
        try {
          if (state.status.cycle >= state.sceneEndsAt - FOLLOW_LEAD_CYCLES) state.advanceScene()
        } catch (error) {
          console.error('[chainsaw follow]', error)
        }
      }),
    [],
  )
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
        // Toggles the song, matching the transport button. The clock may be
        // running for a scratch pattern with the song stopped.
        if (runtime.status.started && runtime.tracksPlaying) runtime.pause()
        else void runtime.play()
        return
      }
      if (event.key === 'Escape') {
        runtime.stopAll()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, onSaveAs, onOpen])
}

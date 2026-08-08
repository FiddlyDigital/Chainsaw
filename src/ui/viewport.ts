/**
 * What the browser will tell us about how the app is being held.
 *
 * Layout is CSS's job and almost all of it stays there. This is the part it
 * cannot do: a measurement no media query exposes.
 */
import { useEffect, useSyncExternalStore } from 'react'

const COARSE = '(hover: none) and (pointer: coarse)'

const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COARSE) : null

function subscribe(onChange: () => void): () => void {
  coarse?.addEventListener('change', onChange)
  return () => coarse?.removeEventListener('change', onChange)
}

/**
 * True when the thing pointing at the screen is a finger.
 *
 * The stylesheet asks the same question for every size it changes. This is for
 * the one place the answer decides whether something exists at all rather than
 * how big it is: the editor's symbol row, which a keyboard has no use for.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => coarse?.matches ?? false,
    () => false,
  )
}

/**
 * Publish how much of the viewport the on-screen keyboard is covering as
 * `--keyboard`, so the layout can shrink out from under it.
 *
 * Android Chrome honours `interactive-widget=resizes-content` and shrinks the
 * layout viewport itself, so this lands on zero there and costs nothing. iOS
 * Safari does not: it shrinks the visual viewport only and leaves the layout
 * viewport full height, which puts everything anchored to the bottom of the
 * app — the dock, the editor's symbol row — underneath the keyboard,
 * exactly when they are most wanted.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      // A pinch-zoom shrinks the visual viewport too, and that is not a keyboard.
      const covered = viewport.scale > 1.01 ? 0 : window.innerHeight - viewport.height - viewport.offsetTop
      document.documentElement.style.setProperty('--keyboard', `${Math.max(0, Math.round(covered))}px`)
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--keyboard')
    }
  }, [])
}

/**
 * Service worker registration, and noticing when a new build is waiting.
 *
 * An update is never applied on its own: swapping the worker reloads the page,
 * and doing that in the middle of a set would stop the music. So a new build
 * installs in the background, waits, and the app offers it to the performer.
 *
 * That deliberate wait is also the trap. A waiting worker does not control the
 * page, and a plain reload does not hand it control — the old worker keeps
 * serving the old cache, and the update stays invisible for as long as any tab
 * remains open. Two things have to happen for it to land, and both live here:
 * something has to *look* for a new build, and something has to *tell* the app
 * one is ready. Without the first, a long-lived tab never notices; without the
 * second, it notices and says nothing.
 */

/** How often a running tab looks for a new build. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000

let registration: ServiceWorkerRegistration | null = null
let waiting: ServiceWorker | null = null
let reloading = false
const listeners = new Set<(ready: boolean) => void>()

function announce(worker: ServiceWorker | null): void {
  if (worker === waiting) return
  waiting = worker
  for (const listener of listeners) listener(waiting !== null)
}

/**
 * Whether a worker is an update rather than a first install.
 *
 * With no controller this page is not being served by a worker at all, so the
 * one that just installed is the first — there is nothing to update *from*,
 * and announcing it would send the performer to reload a page that is already
 * current.
 */
function isUpdate(worker: ServiceWorker | null): boolean {
  return worker !== null && navigator.serviceWorker.controller !== null
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      // Resolved against the page, not the module, so Chainsaw can be served
      // from a subdirectory as happily as from a domain root.
      .register(new URL('./sw.js', window.location.href).href, { scope: './' })
      .then((current) => {
        registration = current

        const track = (worker: ServiceWorker | null) => {
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && isUpdate(worker)) announce(worker)
          })
        }

        if (isUpdate(current.waiting)) announce(current.waiting)
        current.addEventListener('updatefound', () => track(current.installing))

        watchForUpdates()
      })
      .catch(() => {
        // No service worker means no offline mode; the app still runs.
      })
  })
}

/**
 * Look for a new build periodically, and whenever the tab is likely to have
 * missed one.
 *
 * The browser checks for a new worker on navigation, which is no help at all
 * to a tab that has been open since before the deploy — and a sequencer is
 * left open. Coming back to the tab and coming back online are both moments
 * when something may have shipped since anyone last looked.
 */
function watchForUpdates(): void {
  setInterval(checkForUpdate, CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('online', checkForUpdate)
}

/** Ask the browser whether a new build has been deployed. Cheap and silent. */
export function checkForUpdate(): void {
  registration?.update().catch(() => {
    // Offline, or the server is down. There is nothing to report and nothing
    // to do; the next check will find it.
  })
}

export function hasUpdate(): boolean {
  return waiting !== null
}

/**
 * Subscribe to update availability. Fires immediately with the current state,
 * and returns an unsubscribe.
 */
export function onUpdateAvailable(listener: (ready: boolean) => void): () => void {
  listeners.add(listener)
  listener(waiting !== null)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Apply a waiting update and reload. Only ever called from a user action.
 *
 * The reload is driven by `controllerchange` rather than fired straight after
 * the message, because the new worker has to take over before the page is
 * worth reloading — reload too early and the old worker serves the old cache
 * one more time, which looks exactly like the button not working.
 */
export function applyUpdate(): void {
  if (!waiting) return
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    },
    { once: true },
  )
  waiting.postMessage('SKIP_WAITING')
}

/** Test seam: forget everything this module has learned about the page. */
export function resetForTests(): void {
  registration = null
  waiting = null
  reloading = false
  listeners.clear()
}

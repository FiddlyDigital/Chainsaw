/**
 * Service worker registration.
 *
 * An update is never applied on its own: swapping the worker reloads the page,
 * and doing that in the middle of a set would stop the music. The app is told
 * an update is waiting and applies it when the performer says so.
 */
let waiting: ServiceWorker | null = null
let onUpdate: (() => void) | null = null

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      // Resolved against the page, not the module, so Chainsaw can be served
      // from a subdirectory as happily as from a domain root.
      .register(new URL('./sw.js', window.location.href).href, { scope: './' })
      .then((registration) => {
        const track = (worker: ServiceWorker | null) => {
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = worker
              onUpdate?.()
            }
          })
        }
        if (registration.waiting && navigator.serviceWorker.controller) {
          waiting = registration.waiting
          onUpdate?.()
        }
        registration.addEventListener('updatefound', () => track(registration.installing))
      })
      .catch(() => {
        // No service worker means no offline mode; the app still runs.
      })
  })
}

export function hasUpdate(): boolean {
  return waiting !== null
}

export function onUpdateAvailable(callback: () => void): void {
  onUpdate = callback
  if (waiting) callback()
}

/** Apply a waiting update and reload. Only ever called from a user action. */
export function applyUpdate(): void {
  if (!waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  waiting.postMessage('SKIP_WAITING')
}

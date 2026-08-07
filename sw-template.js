/**
 * Chainsaw service worker.
 *
 * The whole app shell — including Strudel and the synthesised kit — is
 * precached at install, so an installed Chainsaw makes noise with the network
 * off. There is nothing to fetch at runtime: the built-in sounds are
 * synthesised rather than sampled, which is why offline works at all.
 *
 * The PRECACHE and VERSION placeholders below are filled in at build time by
 * the plugin in `vite.config.ts`, from the files the build actually emitted.
 * They are deliberately named without their delimiters in this comment, so
 * that the substitution does not paste a copy of the file list in here too.
 */
const VERSION = '__VERSION__'
const CACHE = `chainsaw-${VERSION}`
const PRECACHE = __PRECACHE__

/**
 * `ignoreVary` is essential, not a tidy-up.
 *
 * Precached entries are stored by `cache.addAll`, whose requests carry no
 * `Origin` header. The page's own module scripts are fetched in CORS mode and
 * do send one. A server that answers with `Vary: Origin` (or `Vary:
 * Accept-Encoding`, which anything gzipping tends to) therefore makes every
 * precached asset a miss for the very requests the precache exists to serve,
 * and the app fails to boot offline. These are all same-origin files with
 * content-hashed names: the URL alone identifies them.
 */
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(PRECACHE)
      // Do not activate behind the performer's back: a swap mid-set would
      // reload the page. `SKIP_WAITING` comes from the app when it is safe.
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigations resolve to the cached shell, so a deep link works offline too.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const shell = await cache.match(PRECACHE[0], MATCH)
        if (shell) return shell
        try {
          return await fetch(request)
        } catch {
          return new Response('Chainsaw is offline and has no cached shell.', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          })
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request, MATCH)
      if (hit) return hit
      try {
        const response = await fetch(request)
        // Built assets are content-hashed, so anything new is worth keeping.
        if (response.ok && response.type === 'basic') cache.put(request, response.clone())
        return response
      } catch {
        // Offline and not precached. A clear status beats a network error.
        return new Response('', { status: 504, statusText: 'Offline and not cached' })
      }
    })(),
  )
})

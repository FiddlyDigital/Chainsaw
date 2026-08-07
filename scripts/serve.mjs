/**
 * Static server for the end-to-end suite.
 *
 * It exists instead of `vite preview` for one reason: GitHub Pages serves the
 * app from a subdirectory (`/Chainsaw/`), and an app whose asset URLs, manifest
 * scope and service-worker scope are all base-relative has a way of working at
 * exactly one of a domain root and a folder. This serves either, so the suite
 * can check both.
 *
 *   node scripts/serve.mjs --port=4180 [--prefix=/Chainsaw/] [--dir=dist]
 *
 * It deliberately sends `Vary: Origin`, which is not padding. Real servers and
 * CDNs send it (GitHub Pages varies on Accept-Encoding), and it is what caught
 * the service worker precaching every asset and then missing all of them: the
 * Cache API honours Vary, `cache.addAll` requests carry no Origin header, and
 * the page's own module scripts do. Take this header away and the offline test
 * stops testing anything.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

const port = Number(arg('port', 4180))
const dir = resolve(process.cwd(), arg('dir', 'dist'))
// Normalised to exactly one leading and one trailing slash.
const prefix = `/${arg('prefix', '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\//, '/')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end(`not under ${prefix}`)
    return
  }

  let rest = url.pathname.slice(prefix.length)
  if (rest === '' || rest.endsWith('/')) rest += 'index.html'

  // normalize collapses any ../ before it can escape the served directory.
  const file = join(dir, normalize(`/${rest}`))
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
    return
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    // See the note at the top of this file — this header is the point.
    vary: 'Origin',
  })
  createReadStream(file).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${dir} at http://127.0.0.1:${port}${prefix}`)
})

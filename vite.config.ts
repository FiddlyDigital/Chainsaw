import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * `@strudel/core` imports `SalatRepl` from `@kabelsalat/web`, whose published
 * bundle is an IIFE with no module exports — importing it fails everywhere.
 * Chainsaw drives Strudel's `Cyclist` directly and never uses its REPL, so the
 * DSP compiler is stubbed out. See `src/audio/shims/kabelsalat.ts`.
 */
const kabelsalatShim = here('./src/audio/shims/kabelsalat.ts')

/** Emit a service worker that precaches the built shell and the public files. */
function serviceWorker(): Plugin {
  return {
    name: 'chainsaw-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((name) => name !== 'index.html')
        .map((name: string) => `./${name}`)
      // Dotfiles are excluded: `.nojekyll` is a marker for GitHub Pages, not
      // part of the app, and precaching it would make the whole install fail
      // if it ever went missing — `cache.addAll` is all-or-nothing.
      const publicFiles = readdirSync(here('./public'))
        .filter((name) => !name.startsWith('.'))
        .map((name) => `./${name}`)
      const precache = ['./index.html', ...built, ...publicFiles]
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)

      const template = readFileSync(here('./sw-template.js'), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        // replaceAll, not replace: the tokens appear in the template's own
        // documentation as well as in the code.
        source: template.replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2)).replaceAll('__VERSION__', version),
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: { '@kabelsalat/web': kabelsalatShim },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Strudel ships ESM that must go through Vite's transform (and the
    // kabelsalat alias above) rather than being externalised to Node.
    server: { deps: { inline: [/@strudel/, /superdough/] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.spec.*', 'src/test/**', 'src/main.tsx', 'src/env.d.ts'],
    },
  },
})

import { existsSync, globSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Path to a Chromium already present in the image, if any.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` images pin a browser build that may not match the
 * revision this `@playwright/test` wants. Pointing at the installed binary is
 * preferable to downloading a second copy.
 */
const preinstalledChromium = (() => {
  const explicit = process.env.CHROMIUM_PATH
  if (explicit && existsSync(explicit)) return explicit
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root) return undefined
  return globSync(`${root}/chromium-*/chrome-linux/chrome`).sort().at(-1)
})()

/**
 * Where the app is served from during the run.
 *
 * GitHub Pages puts it under `/Chainsaw/`, and everything the app builds —
 * asset URLs, the manifest's scope, the service worker's scope and precache —
 * is base-relative. That either works at both a domain root and a folder or at
 * neither, so CI runs the suite at both. Set `BASE_PATH=/Chainsaw/` to check
 * the folder case locally.
 */
const basePath = `/${(process.env.BASE_PATH ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\//, '/')
const port = 4180
const origin = `http://127.0.0.1:${port}`

/**
 * End-to-end tests run against the **built** app, not the dev server: the
 * service worker, the chunking and the asset paths are all part of what is
 * being checked.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    // Trailing slash matters: `page.goto('.')` resolves against it.
    baseURL: `${origin}${basePath}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Use the Chromium already on the machine when there is one, so an
          // image with a pinned browser does not have to re-download it.
          ...(preinstalledChromium ? { executablePath: preinstalledChromium } : {}),
          // Headless Chromium has no audio device; this gives Web Audio a
          // silent sink so the scheduler and superdough run for real.
          args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
        },
      },
    },
  ],
  webServer: {
    // Not `vite preview`: that can only serve a domain root, and it is the
    // folder case that breaks. See `scripts/serve.mjs`.
    command: `node scripts/serve.mjs --port=${port} --prefix=${basePath}`,
    url: `${origin}${basePath}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})

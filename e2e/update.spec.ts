import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * The update prompt, against a real deploy.
 *
 * The service worker's bytes are what the browser compares to decide a new
 * build exists, and the test server reads from disk on every request — so
 * rewriting `dist/sw.js` mid-test *is* a deploy, as far as the browser is
 * concerned. Nothing here is stubbed.
 *
 * This is worth doing for real because the failure it guards against is
 * entirely silent: a new build installs, waits, and is never mentioned, so
 * reloading appears to do nothing and the app looks stuck on an old version.
 */

const WORKER = resolve('dist/sw.js')

/** Wait until a worker is serving the page; until then there is no "update". */
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })
}

/** Change the worker's bytes, which is all a deploy is to the browser. */
function deploy(original: string) {
  writeFileSync(WORKER, `${original}\n// deployed at ${Date.now()}\n`)
}

const banner = (page: Page) => page.locator('.update-banner')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('notices a deploy without navigating, and applies it when asked', async ({ page }) => {
  const original = readFileSync(WORKER, 'utf8')
  try {
    await page.goto('.')
    await controlled(page)
    await expect(banner(page)).toHaveCount(0)

    deploy(original)

    // No reload: this is the long-lived tab a sequencer actually lives in.
    // Coming back to it is enough to find out something shipped.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(banner(page)).toBeVisible({ timeout: 20_000 })

    // Applying it reloads the page under the new worker.
    await page.evaluate(() => {
      ;(window as unknown as { __beforeUpdate: boolean }).__beforeUpdate = true
    })
    await banner(page).getByRole('button', { name: 'reload' }).click()

    // `waitForFunction` rather than a poll of `evaluate`: the page navigates
    // out from under this, and an evaluate that lands mid-navigation throws
    // rather than returning a value.
    await page.waitForFunction(() => !(window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate, undefined, {
      timeout: 20_000,
    })

    // The worker that was waiting is now the one in charge, and nothing is
    // left waiting behind it.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration()
            return {
              waiting: registration?.waiting !== null && registration?.waiting !== undefined,
              active: !!registration?.active,
            }
          }),
        { timeout: 20_000 },
      )
      .toEqual({ waiting: false, active: true })

    await expect(banner(page)).toHaveCount(0)
    // …and the app is still the app.
    await expect(page.locator('.transport')).toBeVisible()
  } finally {
    writeFileSync(WORKER, original)
  }
})

test('a reload alone finds the deploy too, rather than silently keeping the old one', async ({ page }) => {
  const original = readFileSync(WORKER, 'utf8')
  try {
    await page.goto('.')
    await controlled(page)

    deploy(original)

    // Reloading is what anyone does when they expect new changes. On its own
    // it does not hand over to the waiting worker — which is exactly why the
    // banner has to appear rather than the reload appearing to do nothing.
    await page.reload()
    await expect(banner(page)).toBeVisible({ timeout: 20_000 })
  } finally {
    writeFileSync(WORKER, original)
  }
})

test('says nothing on a first install', async ({ page }) => {
  await page.goto('.')
  await controlled(page)
  // Nothing to update from, so offering a reload would send someone to
  // refresh a page that is already current.
  await page.waitForTimeout(1_000)
  await expect(banner(page)).toHaveCount(0)
})

test('the prompt can be dismissed and does not block the transport', async ({ page }) => {
  const original = readFileSync(WORKER, 'utf8')
  try {
    await page.goto('.')
    await controlled(page)
    deploy(original)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(banner(page)).toBeVisible({ timeout: 20_000 })

    await banner(page).getByRole('button', { name: 'Not now' }).click()
    await expect(banner(page)).toHaveCount(0)

    // "Not now" is a real answer mid-set, and the set carries on.
    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  } finally {
    writeFileSync(WORKER, original)
  }
})

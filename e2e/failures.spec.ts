import { expect, test, type Page } from '@playwright/test'

/**
 * What the app does when something goes wrong that nobody clicked on.
 *
 * Worth driving in a browser rather than unit-testing, because the thing that
 * can be wrong is not the reporting — it is whether the report reaches a screen
 * showing a different pane, which only the real layout decides. A phone shows
 * one pane at a time, and the place these used to be written was inside one of
 * the other two.
 */
const PHONE = { width: 390, height: 844 }

async function failFromNowhere(page: Page, message: string) {
  // A rejection with nothing awaiting it: the shape of every fire-and-forget
  // call into the engine.
  await page.evaluate((text) => {
    void Promise.reject(new Error(text))
  }, message)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('a failure nobody is waiting on still reaches the performer', async ({ page }) => {
  await page.goto('.')
  await failFromNowhere(page, 'the trigger failed: no such slot')

  const notice = page.locator('.notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('no such slot')
  await expect(notice).toHaveClass(/bad/)
})

test('and reaches it on a phone, whichever pane is up', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('.')

  // The grid, which is not where errors used to be written.
  await page.locator('.pane-bar').getByRole('button', { name: 'grid' }).click()
  await failFromNowhere(page, 'something went wrong')

  await expect(page.locator('.notice')).toBeVisible()

  // …and on the editor pane too, without being raised again.
  await page
    .locator('.pane-bar')
    .getByRole('button', { name: /scratch|slot/ })
    .click()
  await expect(page.locator('.notice')).toBeVisible()
})

test('an error waits to be read; a confirmation does not', async ({ page }) => {
  await page.goto('.')

  await failFromNowhere(page, 'a failure worth reading')
  // Well past the three seconds a "saved" message gets.
  await page.waitForTimeout(4_000)
  await expect(page.locator('.notice')).toBeVisible()

  await page.locator('.notice').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.locator('.notice')).toHaveCount(0)
})

test('a failure does not stop the transport', async ({ page }) => {
  await page.goto('.')
  await page.locator('.transport .play').click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  await failFromNowhere(page, 'trouble')

  await expect(page.locator('.notice')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('a tempo whose first digit is out of range can still be typed', async ({ page }) => {
  await page.goto('.')

  // 90 arrives as "9" first, which the document will not have: bounded at 20.
  const bpm = page.getByLabel('bpm')
  await bpm.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('90')

  await expect(bpm).toHaveValue('90')
  await expect(page.locator('.notice')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chainsaw.autosave.v1') ?? '{}')?.meta?.bpm), {
      timeout: 5_000,
    })
    .toBe(90)
})

test('clearing a number field is not an error, and leaves the document alone', async ({ page }) => {
  await page.goto('.')

  const tracks = page.getByLabel('tracks')
  await tracks.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')

  await expect(tracks).toHaveValue('')
  await expect(page.locator('.notice')).toHaveCount(0)
  // The grid still has every column: an empty field is not zero tracks.
  await expect(page.locator('.grid .track-head')).toHaveCount(8)

  // Leaving it puts the real value back.
  await page.locator('.grid').click({ position: { x: 5, y: 5 } })
  await expect(tracks).toHaveValue('8')
})

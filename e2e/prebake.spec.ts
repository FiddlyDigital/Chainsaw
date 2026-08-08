import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * The project's prebake: definitions every slot can use.
 *
 * Worth driving in a real browser rather than unit-testing, because the thing
 * that can be wrong is not the storing — it is whether a definition made in one
 * evaluation is still there when a completely separate one compiles a slot.
 * Only Strudel's own registry and the JavaScript that survives an evaluation
 * decide that, and neither is visible from a unit test.
 */
function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || /not found|not a function/i.test(message.text())) problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(String(error)))
  return problems
}

const editor = (page: Page) => page.locator('.code-editor .cm-content')

async function openPrebake(page: Page) {
  await page.locator('.prebake-entry').click()
  await expect(page.locator('.editor-head h2')).toHaveText('prebake')
}

async function setPrebake(page: Page, code: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(code)
  await page.locator('.editor-head').getByRole('button', { name: 'commit' }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('the demo ships a helper the demo itself uses', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')

  // D1 calls `.wide()`, which exists only because the prebake registered it.
  await expect(page.locator('.project-panel')).toContainText('.wide(0.5)')

  await page.getByRole('button', { name: 'Play' }).click()
  await page.locator('.grid tbody tr').nth(2).locator('.scene-trigger').click()
  await page.waitForTimeout(2_500)

  // Open D1 to see the verdict. A slot that failed to compile says so only in
  // its own editor, so checking anywhere else would pass whether the helper
  // exists or not.
  await page.locator('.project-panel .entry', { hasText: 'D1' }).first().click()
  await expect(page.locator('.editor-head')).toContainText('slot')
  await expect(page.locator('.editor-panel .inline-error')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a helper defined in the prebake reaches a slot', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')

  await openPrebake(page)
  await setPrebake(page, "register('quieter', (amount, pat) => pat.gain(amount))")

  // A separate evaluation entirely, in a slot rather than the prebake.
  await page.locator('.project-panel .entry', { hasText: 'A1' }).first().click()
  await expect(page.locator('.editor-head')).toContainText('slot')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("bd*4").quieter(0.4)')
  await page.keyboard.press('ControlOrMeta+Enter')

  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2_000)

  await expect(page.locator('.editor-panel .inline-error')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a broken prebake is reported and takes nothing down with it', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  await openPrebake(page)
  await setPrebake(page, "register('wide', ")

  await expect(page.locator('.editor-panel .inline-error')).toBeVisible()
  // The set carries on: a prebake is not allowed to stop the music.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  // …and fixing it clears the report.
  await setPrebake(page, "register('wide', (x, pat) => pat.room(x))")
  await expect(page.locator('.editor-panel .inline-error')).toHaveCount(0)
})

test('warns about a name in double quotes, which would silently register nothing', async ({ page }) => {
  await page.goto('.')
  await openPrebake(page)

  await setPrebake(page, 'register("verb", (x, pat) => pat.room(x))')
  await expect(page.locator('.inline-warning')).toContainText('single quotes')
  // No error, note: it compiles perfectly and does nothing, which is the point.
  await expect(page.locator('.editor-panel .inline-error')).toHaveCount(0)

  await setPrebake(page, "register('verb', (x, pat) => pat.room(x))")
  await expect(page.locator('.inline-warning')).toHaveCount(0)
})

test('the prebake is saved with the project', async ({ page }) => {
  await page.goto('.')
  await openPrebake(page)
  await setPrebake(page, "register('saved', (x, pat) => pat.gain(x))")

  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chainsaw.autosave.v1') ?? '{}').prebake), {
      timeout: 5_000,
    })
    .toBe("register('saved', (x, pat) => pat.gain(x))")
})

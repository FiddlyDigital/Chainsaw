import { expect, test, type Page } from '@playwright/test'

/**
 * The narrow layout, driven at a phone's size with touch input.
 *
 * The interesting property is not that it looks right — it is that nothing
 * ends up unreachable: no pane off the side of the screen, no control too
 * small to hit, and every gesture the desktop does with a hover or a keyboard
 * shortcut available some other way.
 */

const PHONE = { width: 390, height: 844 }

test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

/** How far the widest thing on the page sticks out past the viewport. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

const paneButton = (page: Page, name: 'project' | 'stage' | 'editor') =>
  page.locator('.pane-bar button').nth(['project', 'stage', 'editor'].indexOf(name))

test('shows one pane at a time, switched from the bar at the bottom', async ({ page }) => {
  await page.goto('.')

  // The stage is where a set starts.
  await expect(page.locator('.pane-bar')).toBeVisible()
  await expect(page.locator('.stage')).toBeVisible()
  await expect(page.locator('.project-panel')).toBeHidden()
  await expect(page.locator('.editor-panel')).toBeHidden()

  await paneButton(page, 'project').tap()
  await expect(page.locator('.project-panel')).toBeVisible()
  await expect(page.locator('.stage')).toBeHidden()

  await paneButton(page, 'editor').tap()
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.project-panel')).toBeHidden()
})

test('nothing overflows sideways, in any pane or view', async ({ page }) => {
  await page.goto('.')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await paneButton(page, 'stage').tap()
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).tap()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await paneButton(page, 'project').tap()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await paneButton(page, 'editor').tap()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // …including with the transport's tray of controls open.
  await page.locator('.transport-toggle').tap()
  await expect(page.getByLabel('tracks')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('the transport keeps play and position; the rest folds into a tray', async ({ page }) => {
  await page.goto('.')

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.locator('.counter-bar')).toBeVisible()
  // Everything else starts collapsed, so the transport is one row deep.
  await expect(page.getByRole('button', { name: 'save as' })).toBeHidden()
  await expect(page.getByLabel('tracks')).toBeHidden()

  await page.locator('.transport-toggle').tap()
  await expect(page.getByRole('button', { name: 'save as' })).toBeVisible()
  await expect(page.getByLabel('Master volume')).toBeVisible()

  await page.locator('.transport-toggle').tap()
  await expect(page.getByRole('button', { name: 'save as' })).toBeHidden()
})

test('opening something for editing brings its pane forward', async ({ page }) => {
  await page.goto('.')

  await paneButton(page, 'project').tap()
  await page.locator('.project-panel .entry', { hasText: 'A1' }).first().tap()

  // A slot opens the editor pane…
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.editor-head')).toContainText('slot')
  // …and CodeMirror measured itself on the way out of hiding, rather than
  // coming up as a zero-height box.
  const editor = page.locator('.code-editor .cm-content')
  expect((await editor.boundingBox())?.height ?? 0).toBeGreaterThan(20)

  // …a chain opens the stage, where the chain editor lives.
  await paneButton(page, 'project').tap()
  await page.locator('.project-panel .entry', { hasText: 'DRUMS_A' }).first().tap()
  await expect(page.locator('.chain-editor')).toBeVisible()
  await expect(page.locator('.stage')).toBeVisible()
})

test('a scene fires from touch, and the arrangement can be edited by touch', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).tap()

  await page.locator('.grid tbody tr').nth(1).locator('.scene-trigger').tap()
  await expect(page.locator('.pill.live')).toContainText('drop')

  // Place a chain with the pen tool, then drag it three bars along.
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).tap()
  await page.locator('.chip', { hasText: 'DRUMS_A' }).tap()
  const lane = page.locator('.track-row').nth(4).locator('.lane')
  await lane.tap({ position: { x: 110, y: 10 } })
  const block = lane.locator('.block').first()
  await expect(block).toBeVisible()

  const before = await block.boundingBox()
  await block.hover()
  await page.mouse.down()
  await page.mouse.move((before?.x ?? 0) + 98, (before?.y ?? 0) + 8, { steps: 8 })
  await page.mouse.up()
  const after = await block.boundingBox()
  expect(after?.x ?? 0).toBeGreaterThan(before?.x ?? 0)
})

test('every control is big enough to hit', async ({ page }) => {
  await page.goto('.')
  await page.locator('.transport-toggle').tap()

  // 28px is below the usual 44px guidance, but this is a tracker: the whole
  // point is dense. It is the floor at which a target stops being a coin toss.
  const tooSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, select, input[type="checkbox"]')]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .filter(({ box }) => box.height < 28 || box.width < 18)
      .map(({ element, box }) => `${element.className || element.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`),
  )
  expect(tooSmall).toEqual([])
})

test('the wide layout keeps all three panes and no pane bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('.')

  await expect(page.locator('.pane-bar')).toBeHidden()
  await expect(page.locator('.project-panel')).toBeVisible()
  await expect(page.locator('.stage')).toBeVisible()
  await expect(page.locator('.editor-panel')).toBeVisible()
  // The tray is `display: contents` here, so its contents are simply in the bar.
  await expect(page.getByRole('button', { name: 'save as' })).toBeVisible()
  await expect(page.locator('.transport-toggle')).toBeHidden()
})

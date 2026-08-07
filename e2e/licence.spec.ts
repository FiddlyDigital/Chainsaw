import { expect, test } from '@playwright/test'

/**
 * Chainsaw is AGPL-3.0-or-later, and section 13 says users interacting with it
 * remotely over a network must be prominently offered its Corresponding Source.
 * A deployed Chainsaw is exactly that, so the link is a licence obligation
 * rather than a nicety — and obligations that live in a UI are the kind of
 * thing that quietly disappears in a layout tidy-up. Hence a test.
 */
test('offers the source, as AGPL section 13 requires', async ({ page }) => {
  await page.goto('.')

  const link = page.locator('.source-link')
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', 'https://github.com/FiddlyDigital/Chainsaw')

  // Visible without opening a menu or scrolling: the transport bar is on screen
  // for the whole session.
  await expect(page.locator('.transport .source-link')).toHaveCount(1)
})

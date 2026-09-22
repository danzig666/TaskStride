import { test, expect } from '@playwright/test'

test('loads the All tasks workspace by default', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible(); const views = page.getByRole('navigation', { name: 'Smart views' }).getByRole('button'); await expect(views.first()).toContainText('All tasks') })
test('creates a task without opening its details', async ({ page }) => {
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: 'Add a task' })
  await expect(composer).toBeEnabled()
  await composer.fill('E2E task')
  await composer.press('Enter')
  await expect(page.getByRole('region', { name: 'Tasks' }).getByText('E2E task')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toBeHidden()

  await page.getByRole('region', { name: 'Tasks' }).getByText('E2E task').click()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toHaveValue('E2E task')
})
test('completes and undoes a task', async ({ page }) => { await page.goto('/'); const button = page.getByRole('button', { name: 'Complete Book dentist appointment' }); await button.click(); await expect(page.getByText('Task completed')).toBeVisible(); await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.getByRole('button', { name: 'Complete Book dentist appointment' })).toBeVisible() })
test('searches tasks', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Book dentist appointment').first()).toBeVisible()
  await page.keyboard.press('/')
  const dialog = page.getByRole('dialog', { name: 'Search tasks' })
  await dialog.getByPlaceholder('Search title, notes, or list…').fill('dentist')
  await expect(dialog.getByText('Book dentist appointment')).toBeVisible()
})
test('supports dark mode', async ({ page }) => { await page.goto('/'); await page.getByRole('button', { name: 'Settings' }).click(); await page.getByLabel('Theme').selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark') })
test('uses dedicated mobile navigation', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); const nav = page.getByRole('navigation', { name: 'Mobile navigation' }); await expect(nav).toBeVisible(); const today = nav.getByRole('button', { name: 'Today' }); await today.click(); await expect(today).toHaveClass(/active/) })
test('switches to Hungarian', async ({ page }) => { await page.goto('/'); await page.getByRole('button', { name: 'Settings' }).click(); await page.getByLabel('Language').selectOption('hu'); await expect(page.getByRole('heading', { name: 'Összes feladat' })).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('lang', 'hu') })
test('reorders tasks by dragging anywhere on the row', async ({ page }) => {
  await page.goto('/')
  const rows = page.getByRole('region', { name: 'Tasks' }).locator('article')
  const source = rows.filter({ hasText: 'Review Q4 product brief' }).first()
  const target = rows.filter({ hasText: 'Send updated launch timeline' }).first()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('Task rows are not visible')
  // Grab the row body, away from the checkbox and the attachment link.
  await page.mouse.move(from.x + from.width * 0.55, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width * 0.55 + 12, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(to.x + to.width * 0.55, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => {
    const titles = await page.getByRole('region', { name: 'Tasks' }).locator('article strong').allTextContents()
    return titles.indexOf('Review Q4 product brief') > titles.indexOf('Send updated launch timeline')
  }).toBe(true)
  // The drop must not be mistaken for a tap that opens the task.
  await expect(page.getByText('Task details')).toBeHidden()
})

test('still opens a task when the row is clicked without dragging', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('region', { name: 'Tasks' }).locator('article').filter({ hasText: 'Review Q4 product brief' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toHaveValue('Review Q4 product brief')
})

test('shows the mobile composer only after the add button is pressed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: 'Add a task' })
  await expect(composer).toBeHidden()

  await page.getByRole('button', { name: 'Show the task composer' }).click()
  await expect(composer).toBeVisible()
  await expect(composer).toBeFocused()

  await composer.fill('Composed on a phone')
  await composer.press('Enter')
  await expect(page.getByText('Composed on a phone')).toBeVisible()
})

test('wraps long task text instead of scrolling sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show the task composer' }).click()
  const composer = page.getByRole('textbox', { name: 'Add a task' })
  await composer.fill('Re: Fwd: https://mail.google.com/mail/u/0/#inbox/FMfcgzQbfXtVeryLongGmailThreadIdentifier1234567890')
  await composer.press('Enter')
  await expect(page.getByText(/FMfcgzQbfXtVeryLongGmailThreadIdentifier/)).toBeVisible()

  const overflow = await page.evaluate(() => {
    const list = document.querySelector('.task-list')
    return {
      list: list ? list.scrollWidth - list.clientWidth : 0,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(overflow.list).toBeLessThanOrEqual(1)
  expect(overflow.page).toBeLessThanOrEqual(1)
})

test('imports only the tasks that are missing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Review Q4 product brief')).toBeVisible()

  await page.getByLabel('Import tasks').setInputFiles({
    name: 'taskstride-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      exportedAt: '2026-01-01T00:00:00.000Z',
      lists: [{ id: 'work', title: 'Work' }],
      tasks: [
        { id: 'w1', title: 'Review Q4 product brief', taskListId: 'work' },
        { title: 'Restored from a backup', taskListId: 'work' },
      ],
    })),
  })

  await expect(page.getByText('Restored from a backup')).toBeVisible()
  await expect(page.getByText('1 imported · 1 already existed')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tasks' }).locator('article strong', { hasText: 'Review Q4 product brief' })).toHaveCount(1)
})

test('lets the edge sign-in and the auth backend see navigations the worker would otherwise answer', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  // Cloudflare Access sets its cookie on /cdn-cgi/access/authorized; the worker must not answer it.
  for (const path of ['/cdn-cgi/access/authorized?token=abc', '/api/auth/return?to=%2F']) {
    const response = await page.goto(path)
    expect(response?.fromServiceWorker(), path).toBe(false)
  }
  // Ordinary deep links are still served from the cached shell, so the app keeps working offline.
  const deepLink = await page.goto('/any/view')
  expect(deepLink?.fromServiceWorker()).toBe(true)
})

test('completes and edits a subtask from its parent', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('region', { name: 'Tasks' }).getByText('Review Q4 product brief').click()

  await page.getByRole('button', { name: 'Complete Collect launch questions' }).click()
  await expect(page.getByRole('button', { name: 'Mark incomplete Collect launch questions' })).toBeVisible()

  const title = page.getByRole('textbox', { name: 'Edit subtask: Collect launch questions' })
  await title.fill('Collect launch blockers')
  await title.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Edit subtask: Collect launch blockers' })).toHaveValue('Collect launch blockers')
})

// Every layer that covers the list must close on Back rather than leave the app.
const phoneLayers: Array<[string, (page: import('@playwright/test').Page) => Promise<import('@playwright/test').Locator>]> = [
  ['settings', async (page) => { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Settings' }).click(); return page.getByRole('dialog', { name: 'Settings' }) }],
  ['search', async (page) => { await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Search' }).click(); return page.getByRole('dialog', { name: 'Search tasks' }) }],
  ['navigation menu', async (page) => { await page.getByRole('button', { name: 'Open navigation' }).click(); return page.locator('.sidebar-open') }],
  ['command menu', async (page) => { await page.keyboard.press('Control+k'); return page.getByRole('dialog', { name: 'Command menu' }) }],
  ['task composer', async (page) => { await page.getByRole('button', { name: 'Show the task composer' }).click(); return page.getByRole('textbox', { name: 'Add a task' }) }],
  ['task details', async (page) => { await page.getByRole('region', { name: 'Tasks' }).getByText('Review Q4 product brief').click(); return page.getByRole('textbox', { name: 'Task details' }) }],
]
for (const [name, open] of phoneLayers) {
  test(`Back closes the ${name} on a phone instead of leaving the app`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('data:text/html,<title>previous site</title>')
    await page.goto('/')
    await expect(page.getByText('Review Q4 product brief').first()).toBeVisible()
    const layer = await open(page)
    await expect(layer).toBeVisible()

    await page.goBack()

    await expect(layer).toBeHidden()
    expect(page.url()).toContain('127.0.0.1:4173')
    // With everything closed, Back leaves as usual.
    await page.goBack()
    await expect(page).toHaveTitle('previous site')
  })
}

test('Back closes stacked layers one at a time', async ({ page }) => {
  // A tablet shows the details as a side sheet, so search can open on top of it.
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto('/')
  await page.getByRole('region', { name: 'Tasks' }).getByText('Review Q4 product brief').click()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toBeVisible()
  await page.keyboard.press('/')
  await expect(page.getByRole('dialog', { name: 'Search tasks' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('dialog', { name: 'Search tasks' })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'Task details' })).toBeHidden()
  expect(page.url()).toContain('127.0.0.1:4173')
})

test('phones search from the bars instead of a filter row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('Review Q4 product brief').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Filter tasks…' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Search' }).first()).toBeVisible()
})

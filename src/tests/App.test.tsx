import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useUiStore } from '../store/uiStore'

vi.mock('../db/cache', () => ({ cacheSnapshot: vi.fn(), clearCache: vi.fn(), readSnapshot: vi.fn(async () => ({ lists: [], tasks: [] })), syncCacheVersion: '2' }))

const renderApp = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>)

describe('TaskStride UI', () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); useUiStore.setState({ activeView: 'all', selectedTaskId: undefined, theme: 'system', density: 'comfortable', horizon: 7, favoriteLists: [], locale: 'en' }) })
  afterEach(() => vi.restoreAllMocks())
  it('shows live progress while tasks are synchronizing', async () => { renderApp(); expect(await screen.findByRole('status', { name: 'Syncing…' })).toBeInTheDocument(); expect(await screen.findByRole('heading', { name: /^All tasks \(\d+\)$/ })).toBeInTheDocument() })
  it('opens on All tasks and keeps it first in navigation', async () => { renderApp(); expect(await screen.findByRole('heading', { name: /^All tasks \(\d+\)$/ })).toBeInTheDocument(); const buttons = screen.getByRole('navigation', { name: 'Smart views' }).querySelectorAll('button'); expect(buttons[0]).toHaveTextContent('All tasks') })
  it('quick-adds a task without opening its details', async () => { const user = userEvent.setup(); renderApp(); const input = await screen.findByRole('textbox', { name: 'Add a task' }); await waitFor(() => expect(input).toBeEnabled()); await user.type(input, 'Plan next week{Enter}'); expect(await screen.findByText('Plan next week')).toBeInTheDocument(); expect(screen.queryByRole('textbox', { name: 'Task details' })).not.toBeInTheDocument() })
  it('opens task details', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByText('Review Q4 product brief')); expect(screen.getByText('Task details')).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Task details' })).toHaveValue('Review Q4 product brief') })
  it('uses mobile browser history to close task details on Back', async () => { vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: query === '(max-width: 767px)', media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })); const pushState = vi.spyOn(window.history, 'pushState'); const user = userEvent.setup(); renderApp(); await user.click(await screen.findByText('Review Q4 product brief')); expect(pushState).toHaveBeenCalled(); expect(screen.getByText('Task details')).toBeInTheDocument(); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); await waitFor(() => expect(screen.queryByText('Task details')).not.toBeInTheDocument()) })
  it('shows attached Gmail and generic links in task details', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByText('Review Q4 product brief')); const gmailLink = screen.getAllByRole('link', { name: /Product brief discussion/ }).find((item) => item.closest('.links-block')); expect(gmailLink).toHaveAttribute('href', 'https://mail.google.com/mail/#all/example'); expect(gmailLink).toHaveTextContent('Gmail'); expect(screen.getByRole('link', { name: /Product specification/ })).toHaveAttribute('href', 'https://example.com/specification') })
  it('shows the Google updated timestamp in task rows', async () => { renderApp(); const title = await screen.findByText('Review Q4 product brief'); expect(title.closest('article')).toHaveTextContent('Updated') })
  it('shows a clickable email icon and link text in the task row', async () => { renderApp(); const title = await screen.findByText('Review Q4 product brief'); const link = title.closest('article')?.querySelector<HTMLAnchorElement>('.task-email-link'); expect(link).toHaveAttribute('href', 'https://mail.google.com/mail/#all/example'); expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveTextContent('Product brief discussion') })
  it('opens search and finds cached tasks', async () => { const user = userEvent.setup(); renderApp(); await screen.findAllByText('Review Q4 product brief'); await user.keyboard('/'); const search = screen.getByPlaceholderText('Search title, notes, or list…'); await user.type(search, 'dentist'); expect(screen.getAllByText('Book dentist appointment').length).toBeGreaterThan(0) })
  it('opens settings and switches theme', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByRole('button', { name: 'Settings' })); await user.selectOptions(screen.getByLabelText('Theme'), 'dark'); await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark')) })
  it('keeps the composer out of the way on phones until the add button is pressed', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: query === '(max-width: 767px)', media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }))
    const user = userEvent.setup()
    const { container } = renderApp()
    await screen.findByText('Review Q4 product brief')

    expect(container.querySelector('.app')).toHaveAttribute('data-composer', 'closed')
    await user.click(screen.getByRole('button', { name: 'Show the task composer' }))

    expect(container.querySelector('.app')).toHaveAttribute('data-composer', 'open')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Add a task' })).toHaveFocus())
  })

  it('reorders from the whole row and keeps a keyboard-only activator', async () => {
    renderApp()
    const title = await screen.findByText('Review Q4 product brief')
    const row = title.closest('article')

    expect(row?.querySelector('.drag-handle')).toBeNull()
    expect(row?.closest('.sortable-task')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Reorder Review Q4 product brief' })).toHaveClass('drag-keyboard')
  })

  it('imports only the tasks that are missing from the workspace', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText('Review Q4 product brief')

    const backup = JSON.stringify({
      exportedAt: '2026-01-01T00:00:00.000Z',
      lists: [{ id: 'work', title: 'Work' }],
      tasks: [
        { id: 'w1', title: 'Review Q4 product brief', taskListId: 'work' },
        { title: 'Research weekend train routes', taskListId: 'personal', taskListTitle: 'Personal' },
        { title: 'Restored from backup', notes: 'Only this one is missing.', taskListId: 'work' },
      ],
    })
    await user.upload(screen.getByLabelText('Import tasks'), new File([backup], 'taskstride-export.json', { type: 'application/json' }))

    expect(await screen.findByText('Restored from backup')).toBeInTheDocument()
    expect(screen.getAllByText('Review Q4 product brief')).toHaveLength(1)
    expect(screen.getAllByText('Research weekend train routes')).toHaveLength(1)
  })

  it('switches the complete interface to Hungarian', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByRole('button', { name: 'Settings' })); await user.selectOptions(screen.getByLabelText('Language'), 'hu'); expect(await screen.findByRole('heading', { name: /^Összes feladat \(\d+\)$/ })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Beállítások' })).toBeInTheDocument() })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useUiStore } from '../store/uiStore'

vi.mock('../db/cache', () => ({ cacheSnapshot: vi.fn(), clearCache: vi.fn(), readSnapshot: vi.fn(async () => ({ lists: [], tasks: [] })) }))

const renderApp = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>)

describe('TaskFlow UI', () => {
  beforeEach(() => { localStorage.clear(); useUiStore.setState({ activeView: 'all', selectedTaskId: undefined, theme: 'system', density: 'comfortable', horizon: 7, favoriteLists: [], locale: 'en' }) })
  it('opens on All tasks and keeps it first in navigation', async () => { renderApp(); expect(await screen.findByRole('heading', { name: 'All tasks' })).toBeInTheDocument(); const buttons = screen.getByRole('navigation', { name: 'Smart views' }).querySelectorAll('button'); expect(buttons[0]).toHaveTextContent('All tasks') })
  it('quick-adds a task', async () => { const user = userEvent.setup(); renderApp(); const input = await screen.findByRole('textbox', { name: 'Add a task' }); await waitFor(() => expect(input).toBeEnabled()); await user.type(input, 'Plan next week{Enter}'); expect(await screen.findByRole('textbox', { name: 'Task details' })).toHaveValue('Plan next week') })
  it('opens task details', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByText('Review Q4 product brief')); expect(screen.getByText('Task details')).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Task details' })).toHaveValue('Review Q4 product brief') })
  it('opens search and finds cached tasks', async () => { const user = userEvent.setup(); renderApp(); await screen.findAllByText('Review Q4 product brief'); await user.keyboard('/'); const search = screen.getByPlaceholderText('Search title, notes, or list…'); await user.type(search, 'dentist'); expect(screen.getAllByText('Book dentist appointment').length).toBeGreaterThan(0) })
  it('opens settings and switches theme', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByRole('button', { name: 'Settings' })); await user.selectOptions(screen.getByLabelText('Theme'), 'dark'); await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark')) })
  it('switches the complete interface to Hungarian', async () => { const user = userEvent.setup(); renderApp(); await user.click(await screen.findByRole('button', { name: 'Settings' })); await user.selectOptions(screen.getByLabelText('Language'), 'hu'); expect(await screen.findByRole('heading', { name: 'Összes feladat' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Beállítások' })).toBeInTheDocument() })
})

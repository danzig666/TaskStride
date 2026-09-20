import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight,
  Circle, Cloud, CloudOff, Command, Download, GripVertical, Inbox, Keyboard, Link2, ListTodo,
  Mail, Menu, Moon, MoreHorizontal, Plus, RefreshCw, Search, Settings, Sparkles, Trash2, WifiOff, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { enUS, hu as huLocale } from 'date-fns/locale'
import { repository, mockMode } from './api/repository'
import { googleAuth } from './auth/googleAuth'
import { cacheSnapshot, clearCache, readSnapshot, syncCacheVersion } from './db/cache'
import { dateKeyToGoogleDue, dueToDateKey, formatDue, isOverdue } from './lib/dates'
import { messages, type AppLocale } from './i18n'
import { buildTaskTree, canMoveAcrossLists, inSmartView, reconcileTasks, searchTasks, sortByGoogleOrder, sortByPosition, type SmartView } from './lib/tasks'
import { useUiStore } from './store/uiStore'
import type { GoogleTask, GoogleTaskList, TaskPatch, TaskWithList } from './types/googleTasks'

type WorkspaceData = { lists: GoogleTaskList[]; tasks: TaskWithList[] }
type SyncProgress = { phase: 'lists' | 'tasks' | 'saving'; downloaded: number; completedLists: number; totalLists: number }
const viewInfo: Record<SmartView, { labelKey: 'all' | 'today' | 'upcoming' | 'noDate' | 'completed' | 'assigned'; icon: typeof Sparkles }> = {
  all: { labelKey: 'all', icon: ListTodo }, today: { labelKey: 'today', icon: Sparkles }, upcoming: { labelKey: 'upcoming', icon: CalendarDays },
  'no-date': { labelKey: 'noDate', icon: Circle }, completed: { labelKey: 'completed', icon: Check }, assigned: { labelKey: 'assigned', icon: Inbox },
}
const accents = ['indigo', 'coral', 'teal', 'amber']
const noSubtasks: GoogleTask[] = []

async function fetchWorkspace(onProgress: (progress: SyncProgress) => void): Promise<WorkspaceData> {
  const syncStartedAt = new Date().toISOString()
  onProgress({ phase: 'lists', downloaded: 0, completedLists: 0, totalLists: 0 })
  const snapshot = await readSnapshot().catch(() => ({ lists: [], tasks: [], lastSync: undefined, syncVersion: undefined }))
  const lists = await repository.listTaskLists()
  const cachedListIds = new Set(snapshot.lists.map((list) => list.id))
  let downloaded = 0
  let completedLists = 0
  onProgress({ phase: 'tasks', downloaded, completedLists, totalLists: lists.length })
  const tasks = (await Promise.all(lists.map(async (list) => {
    const incremental = Boolean(snapshot.lastSync && snapshot.syncVersion === syncCacheVersion && cachedListIds.has(list.id))
    const incoming: GoogleTask[] = []; let pageToken: string | undefined
    do { const page = await repository.listTasks(list.id, { pageToken, updatedMin: incremental ? snapshot.lastSync : undefined, showCompleted: true, showDeleted: incremental, showHidden: true, showAssigned: true, maxResults: 100 }); incoming.push(...(page.items ?? [])); downloaded += page.items?.length ?? 0; onProgress({ phase: 'tasks', downloaded, completedLists, totalLists: lists.length }); pageToken = page.nextPageToken } while (pageToken)
    const cached = snapshot.tasks.filter((task) => task.taskListId === list.id)
    const ordered = incremental ? reconcileTasks(cached, incoming) : sortByPosition(incoming.filter((task) => !task.deleted))
    completedLists += 1
    onProgress({ phase: 'tasks', downloaded, completedLists, totalLists: lists.length })
    return ordered.map((task) => ({ ...task, taskListId: list.id, taskListTitle: list.title }))
  }))).flat()
  onProgress({ phase: 'saving', downloaded, completedLists, totalLists: lists.length })
  await cacheSnapshot(lists, tasks, syncStartedAt)
  return { lists, tasks }
}

export default function App() {
  const queryClient = useQueryClient()
  const { activeView, selectedTaskId, theme, density, horizon, locale, setActiveView, selectTask, setTheme, setDensity, setHorizon, setLocale } = useUiStore()
  const m = messages[locale]
  const [authVersion, setAuthVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [quickTitle, setQuickTitle] = useState('')
  const [quickDate, setQuickDate] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const quickInput = useRef<HTMLInputElement>(null)
  const taskListViewport = useRef<HTMLElement>(null)
  const connected = mockMode || googleAuth.connected

  useEffect(() => { const listener = () => setAuthVersion((value) => value + 1); googleAuth.addEventListener('change', listener); return () => googleAuth.removeEventListener('change', listener) }, [])
  useEffect(() => { readSnapshot().then((snapshot) => { if (snapshot.lists.length) queryClient.setQueryData(['workspace', authVersion], { lists: snapshot.lists, tasks: snapshot.tasks }) }).catch(() => undefined) }, [queryClient, authVersion])
  useEffect(() => { const onOnline = () => { setOnline(true); toast.success(messages[useUiStore.getState().locale].backOnline); queryClient.invalidateQueries({ queryKey: ['workspace'] }) }; const onOffline = () => { setOnline(false); toast(messages[useUiStore.getState().locale].offline) }; window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) } }, [queryClient])
  useEffect(() => { const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.dataset.theme = resolved }, [theme])
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const workspace = useQuery({ queryKey: ['workspace', authVersion], queryFn: () => fetchWorkspace(setSyncProgress), enabled: connected && online, refetchOnWindowFocus: true, retry: 1 })
  const syncState: 'synced' | 'syncing' | 'offline' | 'reconnect' | 'error' = !online ? 'offline' : !connected ? 'reconnect' : workspace.isError ? 'error' : workspace.isFetching ? 'syncing' : workspace.data ? 'synced' : 'syncing'

  const data = workspace.data ?? queryClient.getQueryData<WorkspaceData>(['workspace', authVersion]) ?? { lists: [], tasks: [] }
  const selectedTask = useMemo(() => data.tasks.find((task) => task.id === selectedTaskId), [data.tasks, selectedTaskId])
  const activeList = data.lists.find((list) => list.id === activeView)
  const smart = activeView in viewInfo ? activeView as SmartView : null
  const viewLabel = smart ? m[viewInfo[smart].labelKey] : activeList?.title ?? m.tasksTab
  const baseTasks = useMemo(() => smart ? data.tasks.filter((task) => inSmartView(task, smart, horizon)) : data.tasks.filter((task) => task.taskListId === activeView && !task.hidden), [activeView, data.tasks, horizon, smart])
  const visibleTasks = useMemo(() => searchTasks(sortByGoogleOrder(baseTasks, data.lists), query), [baseTasks, data.lists, query])
  const rootTasks = useMemo(() => visibleTasks.filter((task) => !task.parent), [visibleTasks])
  const incomplete = useMemo(() => rootTasks.filter((task) => task.status !== 'completed'), [rootTasks])
  const completed = useMemo(() => rootTasks.filter((task) => task.status === 'completed'), [rootTasks])
  const subtasksByParent = useMemo(() => {
    const grouped = new Map<string, TaskWithList[]>()
    for (const task of data.tasks) if (task.parent) {
      const siblings = grouped.get(task.parent)
      if (siblings) siblings.push(task)
      else grouped.set(task.parent, [task])
    }
    return grouped
  }, [data.tasks])
  const sortableTaskIds = useMemo(() => incomplete.map((task) => task.id), [incomplete])
  // TanStack Virtual manages its own mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const taskVirtualizer = useVirtualizer({
    count: incomplete.length,
    getScrollElement: () => taskListViewport.current,
    estimateSize: () => density === 'compact' ? 52 : 76,
    getItemKey: (index) => incomplete[index].id,
    initialRect: { width: 700, height: 600 },
    overscan: 10,
  })
  const virtualTaskRows = import.meta.env.MODE === 'test' ? incomplete.map((_, index) => ({ index, start: index * 76 })) : taskVirtualizer.getVirtualItems()
  const virtualTaskListHeight = import.meta.env.MODE === 'test' ? incomplete.length * 76 : taskVirtualizer.getTotalSize()
  const defaultListId = activeList?.id ?? data.lists[0]?.id
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  useEffect(() => { if (taskListViewport.current) taskListViewport.current.scrollTop = 0 }, [activeView, query])

  const optimisticMutation = useMutation({
    mutationFn: async ({ task, patch }: { task: TaskWithList; patch: TaskPatch }) => repository.patchTask(task.taskListId, task.id, patch),
    onMutate: async ({ task, patch }) => { await queryClient.cancelQueries({ queryKey: ['workspace'] }); const previous = queryClient.getQueryData<WorkspaceData>(['workspace', authVersion]); queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...patch, updated: new Date().toISOString() } as TaskWithList : item) }) : current); return { previous } },
    onError: (error, variables, context) => { if (context?.previous) queryClient.setQueryData(['workspace', authVersion], context.previous); toast.error(error instanceof Error ? error.message : m.couldNotSave, { action: { label: 'Retry', onClick: () => optimisticMutation.mutate(variables) } }) },
    onSuccess: (saved, { task }) => queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...saved, taskListId: item.taskListId, taskListTitle: item.taskListTitle } : item) }) : current),
  })

  const createTask = async () => {
    const title = quickTitle.trim(); if (!title || !defaultListId) return
    if (!online || !connected) return toast.error(!online ? 'Reconnect to add a task.' : 'Reconnect Google to add a task.')
    const list = data.lists.find((item) => item.id === defaultListId)!
    const temporary: TaskWithList = { id: `local-${crypto.randomUUID()}`, title, due: quickDate ? dateKeyToGoogleDue(quickDate) : undefined, status: 'needsAction', position: '0', taskListId: list.id, taskListTitle: list.title }
    setQuickTitle(''); setQuickDate(''); queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: [temporary, ...current.tasks] }) : current)
    try { const saved = await repository.createTask(list.id, { title, due: temporary.due }); queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: current.tasks.map((task) => task.id === temporary.id ? { ...saved, taskListId: list.id, taskListTitle: list.title } : task) }) : current) }
    catch (error) { queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: current.tasks.filter((task) => task.id !== temporary.id) }) : current); toast.error(error instanceof Error ? error.message : 'Couldn’t create task', { action: { label: 'Retry', onClick: createTask } }) }
  }

  const mutateTask = optimisticMutation.mutate
  const toggleTask = useCallback((task: TaskWithList) => {
    const completing = task.status !== 'completed'
    mutateTask({ task, patch: { status: completing ? 'completed' : 'needsAction', completed: completing ? new Date().toISOString() : null } })
    toast(completing ? m.taskCompleted : m.taskReopened, { action: { label: m.undo, onClick: () => mutateTask({ task: { ...task, status: completing ? 'completed' : 'needsAction' }, patch: { status: task.status, completed: task.completed ?? null } }) } })
  }, [m.taskCompleted, m.taskReopened, m.undo, mutateTask])

  const deleteTask = async (task: TaskWithList) => {
    const snapshot = { ...task }; queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => current ? ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id && item.parent !== task.id) }) : current); selectTask(undefined)
    try { await repository.deleteTask(task.taskListId, task.id); toast(m.taskDeleted, { action: { label: m.undo, onClick: async () => { const restored = await repository.createTask(task.taskListId, { title: snapshot.title, notes: snapshot.notes, due: snapshot.due }); await queryClient.invalidateQueries({ queryKey: ['workspace'] }); selectTask(restored.id) } } }) } catch (error) { await queryClient.invalidateQueries({ queryKey: ['workspace'] }); toast.error(error instanceof Error ? error.message : m.couldNotSave) }
  }

  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['workspace'] }); toast.success(m.refreshed) }
  const connect = async () => { try { await googleAuth.connect(''); await queryClient.invalidateQueries({ queryKey: ['workspace'] }) } catch (error) { toast.error(error instanceof Error ? error.message : 'Couldn’t connect Google') } }
  const exportTasks = () => { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), lists: data.lists, tasks: data.tasks }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `taskstride-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); toast.success(m.exported) }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const activeTask = data.tasks.find((task) => task.id === active.id); const overTask = data.tasks.find((task) => task.id === over.id)
    if (!activeTask || !overTask) return
    const taskListId = activeList?.id ?? (smart === 'all' && activeTask.taskListId === overTask.taskListId ? activeTask.taskListId : undefined)
    if (!taskListId) { toast.error(m.reorderHint); return }
    const siblings = incomplete.filter((task) => task.taskListId === taskListId && !task.parent); const oldIndex = siblings.findIndex((task) => task.id === active.id); const newIndex = siblings.findIndex((task) => task.id === over.id); if (oldIndex < 0 || newIndex < 0) return
    const ordered = arrayMove(siblings, oldIndex, newIndex); const previous = newIndex > 0 ? ordered[newIndex - 1].id : undefined
    queryClient.setQueryData<WorkspaceData>(['workspace', authVersion], (current) => {
      if (!current) return current
      const tasks = current.tasks.map((task) => { const order = ordered.findIndex((item) => item.id === task.id); return order >= 0 ? { ...task, position: String(order).padStart(12, '0') } : task })
      const fromIndex = tasks.findIndex((task) => task.id === active.id); const targetIndexBeforeMove = tasks.findIndex((task) => task.id === over.id)
      if (fromIndex >= 0 && targetIndexBeforeMove >= 0) { const [moved] = tasks.splice(fromIndex, 1); const targetIndex = tasks.findIndex((task) => task.id === over.id); tasks.splice(newIndex > oldIndex ? targetIndex + 1 : targetIndex, 0, moved) }
      return { ...current, tasks }
    })
    try { await repository.moveTask({ taskListId, taskId: String(active.id), previous }) } catch (error) { await queryClient.invalidateQueries({ queryKey: ['workspace'] }); toast.error(error instanceof Error ? error.message : 'Couldn’t reorder task') }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editable = (event.target as HTMLElement)?.matches('input, textarea, [contenteditable="true"]')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); return }
      if (editable) return
      if (event.key === '/') { event.preventDefault(); setSearchOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>('[data-global-search]')?.focus(), 0) }
      else if (['n', 'q'].includes(event.key.toLowerCase())) quickInput.current?.focus()
      else if (event.key === '?') setShortcutsOpen(true)
      else if (event.key === 'Escape') { setCommandOpen(false); setSettingsOpen(false); setShortcutsOpen(false); selectTask(undefined) }
      else if (event.key === ' ' && selectedTask) { event.preventDefault(); toggleTask(selectedTask) }
      else if (event.key === 'Enter' && !selectedTask && incomplete[0]) selectTask(incomplete[0].id)
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  })

  useEffect(() => {
    const context = document.modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const register = (tool: WebMcpTool) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined) } catch { /* unsupported preview */ } }
    register({ name: 'list_visible_tasks', title: 'List visible tasks', description: 'Read the tasks currently visible in TaskStride.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => ({ view: viewLabel, tasks: visibleTasks.map(({ id, title, status, due, taskListTitle }) => ({ id, title, status, due: dueToDateKey(due), list: taskListTitle })) }) })
    register({ name: 'create_task', title: 'Create task', description: 'Create a real Google Task in a selected list.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, taskListId: { type: 'string' }, due: { type: 'string', description: 'Optional date in YYYY-MM-DD format.' } }, required: ['title'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input) => { const value = input as { title?: unknown; taskListId?: unknown; due?: unknown }; if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('title is required'); const listId = typeof value.taskListId === 'string' ? value.taskListId : defaultListId; if (!listId || !data.lists.some((list) => list.id === listId)) throw new Error('A valid taskListId is required'); if (value.due !== undefined && (typeof value.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.due))) throw new Error('due must be YYYY-MM-DD'); const created = await repository.createTask(listId, { title: value.title.trim(), due: typeof value.due === 'string' ? dateKeyToGoogleDue(value.due) : undefined }); await queryClient.invalidateQueries({ queryKey: ['workspace'] }); return { id: created.id, title: created.title, listId } } })
    register({ name: 'complete_task', title: 'Complete task', description: 'Mark an existing Google Task complete.', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input) => { const taskId = (input as { taskId?: unknown }).taskId; if (typeof taskId !== 'string') throw new Error('taskId is required'); const task = data.tasks.find((item) => item.id === taskId); if (!task) throw new Error('Task not found'); await repository.patchTask(task.taskListId, task.id, { status: 'completed', completed: new Date().toISOString() }); await queryClient.invalidateQueries({ queryKey: ['workspace'] }); return { id: task.id, status: 'completed' } } })
    return () => lifecycle.abort()
  }, [data.lists, data.tasks, defaultListId, queryClient, viewLabel, visibleTasks])

  if (!connected && !data.tasks.length) return <Welcome onConnect={connect} />

  const navViews = (Object.entries(viewInfo) as [SmartView, typeof viewInfo[SmartView]][]).filter(([key]) => key !== 'assigned' || data.tasks.some((task) => task.assignmentInfo))
  return <div className={`app ${selectedTask ? 'has-details' : ''}`} data-density={density} data-sidebar={useUiStore.getState().sidebarCollapsed ? 'collapsed' : 'open'}>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Check /></span><span>TaskStride</span></div>
      <button className="account-card" onClick={mockMode ? undefined : connect}><span className="avatar">{mockMode ? 'DE' : 'G'}</span><span className="account-copy"><strong>{mockMode ? m.demo : connected ? m.googleTasks : m.reconnectGoogle}</strong><small><i className={syncState} /> <SyncLabel state={syncState} /></small></span><ChevronDown size={15} /></button>
      <nav className="primary-nav" aria-label={m.smartViews}>{navViews.map(([key, { icon: Icon, labelKey }]) => <button className={activeView === key ? 'active' : ''} key={key} onClick={() => { setActiveView(key); setMobileMenu(false) }}><Icon /><span>{m[labelKey]}</span><em>{data.tasks.filter((task) => inSmartView(task, key, horizon)).length}</em></button>)}</nav>
      <div className="section-title"><span>{m.myLists}</span><button aria-label={m.addList} onClick={async () => { const title = window.prompt(locale === 'hu' ? 'Lista neve' : 'List name'); if (!title?.trim()) return; await repository.createTaskList(title.trim()); await refresh() }}><Plus /></button></div>
      <nav className="list-nav" aria-label={m.taskLists}>{data.lists.map((list, index) => <button key={list.id} className={activeView === list.id ? 'active' : ''} onClick={() => { setActiveView(list.id); setMobileMenu(false) }}><i className={`dot ${accents[index % accents.length]}`} /><span>{list.title}</span><em>{data.tasks.filter((task) => task.taskListId === list.id && task.status !== 'completed').length}</em></button>)}</nav>
      <button className="settings-link" onClick={() => setSettingsOpen(true)}><Settings /><span>{m.settings}</span></button>
    </aside>

    <main className="workspace">
      <header className="mobile-topbar"><button onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu /></button><strong>{viewLabel}</strong><button onClick={() => setSearchOpen(true)} aria-label="Search"><Search /></button></header>
      {syncState === 'reconnect' && <div className="reconnect-bar"><CloudOff /> {m.cachedReadonly} <button onClick={connect}>{m.reconnect}</button></div>}
      {syncState === 'offline' && <div className="reconnect-bar"><WifiOff /> {m.offlineCached}</div>}
      {syncState === 'error' && <div className="reconnect-bar"><CloudOff /> {m.syncErrorDetail} <button onClick={() => workspace.refetch()}>{m.retry}</button></div>}
      {syncState === 'syncing' && syncProgress && <div className="sync-progress" role="status" aria-label={m.syncing} aria-live="polite"><div><RefreshCw className="spinning" /><span>{syncProgress.phase === 'lists' ? m.syncLoadingLists : syncProgress.phase === 'saving' ? m.syncSaving : m.syncProgress.replace('{count}', String(syncProgress.downloaded)).replace('{done}', String(syncProgress.completedLists)).replace('{total}', String(syncProgress.totalLists))}</span></div><i aria-hidden="true"><span /></i></div>}
      <header className="view-header"><div><p className="eyebrow">{new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p><h1>{viewLabel}</h1><p>{incomplete.length ? (incomplete.length === 1 ? m.focusOne : m.focusMany.replace('{count}', String(incomplete.length))) : smart === 'today' ? m.nothingToday : m.noTasksHere}</p></div><div className="header-actions"><button className="icon-button" onClick={refresh} aria-label={m.refreshTasks}><RefreshCw className={workspace.isFetching ? 'spinning' : ''} /></button><button className="icon-button" onClick={() => setCommandOpen(true)} aria-label={m.commandMenu}><MoreHorizontal /></button></div></header>
      <section className="quick-add"><span className="quick-plus"><Plus /></span><input ref={quickInput} value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createTask() }} aria-label={m.addATask} placeholder={defaultListId ? m.addTask : m.createListFirst} disabled={!defaultListId || !online || !connected} /><div className="quick-actions"><label className="date-control"><CalendarDays /><span>{m.date}</span><input type="date" value={quickDate} onChange={(event) => setQuickDate(event.target.value)} aria-label={m.dueDate} /></label><kbd>N</kbd></div></section>
      <div className="filter-bar"><span>{visibleTasks.length} {m.tasks}</span><label className="task-filter"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={m.filterTasks} aria-label={m.filterTasks} />{query && <button type="button" onClick={() => setQuery('')} aria-label={m.clearFilter}><X /></button>}</label></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={sortableTaskIds} strategy={verticalListSortingStrategy}><section className="task-list" aria-label="Tasks" ref={taskListViewport}>
        {!incomplete.length && !completed.length && <EmptyState view={smart} query={query} onAdd={() => quickInput.current?.focus()} />}
        <div className="virtual-task-list" style={{ height: virtualTaskListHeight }}>{virtualTaskRows.map((virtualRow) => { const task = incomplete[virtualRow.index]; return <div className="virtual-task-row" data-index={virtualRow.index} key={task.id} ref={taskVirtualizer.measureElement} style={{ transform: `translateY(${virtualRow.start}px)` }}>{activeList || smart === 'all' ? <SortableTaskRow task={task} selected={selectedTaskId === task.id} showList={smart === 'all'} subtasks={subtasksByParent.get(task.id) ?? noSubtasks} onSelectTask={selectTask} onToggleTask={toggleTask} /> : <TaskRow task={task} selected={selectedTaskId === task.id} showList={Boolean(smart)} subtasks={subtasksByParent.get(task.id) ?? noSubtasks} onSelectTask={selectTask} onToggleTask={toggleTask} />}</div> })}</div>
        {completed.length > 0 && <><button className="completed-heading"><ChevronDown /> Completed <span>{completed.length}</span></button>{completed.map((task) => <TaskRow key={task.id} task={task} selected={selectedTaskId === task.id} showList={Boolean(smart)} subtasks={noSubtasks} onSelectTask={selectTask} onToggleTask={toggleTask} />)}</>}
      </section></SortableContext></DndContext>
    </main>

    {selectedTask && <TaskDetails key={selectedTask.id} task={selectedTask} lists={data.lists} subtasks={buildTaskTree(data.tasks.filter((task) => task.parent === selectedTask.id))} onClose={() => selectTask(undefined)} onToggle={() => toggleTask(selectedTask)} onPatch={(patch) => optimisticMutation.mutate({ task: selectedTask, patch })} onDelete={() => deleteTask(selectedTask)} onMove={async (destinationTasklist) => { const allowed = canMoveAcrossLists(selectedTask); if (!allowed.allowed) return toast.error(allowed.reason); await repository.moveTask({ taskListId: selectedTask.taskListId, taskId: selectedTask.id, destinationTasklist }); selectTask(undefined); await refresh() }} onCreateSubtask={async (title) => { await repository.createTask(selectedTask.taskListId, { title }, selectedTask.id); await refresh() }} />}
    <nav className="bottom-nav" aria-label={m.mobileNavigation}><button className={activeView === 'all' ? 'active' : ''} onClick={() => setActiveView('all')}><ListTodo /><span>{m.tasksTab}</span></button><button className={activeView === 'today' ? 'active' : ''} onClick={() => setActiveView('today')}><Sparkles /><span>{m.todayTab}</span></button><button className="add-mobile" onClick={() => quickInput.current?.focus()}><Plus /></button><button className={activeView === 'upcoming' ? 'active' : ''} onClick={() => setActiveView('upcoming')}><CalendarDays /><span>{m.upcomingTab}</span></button><button onClick={() => setSearchOpen(true)}><Search /><span>{m.searchTab}</span></button></nav>
    {mobileMenu && <button className="scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
    <button className="command-hint" onClick={() => setCommandOpen(true)}><Command />K</button>

    {searchOpen && <Modal title={m.searchTasks} onClose={() => setSearchOpen(false)} className="search-modal"><div className="global-search"><Search /><input data-global-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder={m.searchPlaceholder} /></div><div className="search-results">{searchTasks(data.tasks, query).slice(0, 12).map((task) => <button key={task.id} onClick={() => { selectTask(task.id); setSearchOpen(false) }}><span className="mini-check">{task.status === 'completed' && <Check />}</span><span><strong>{task.title}</strong><small>{task.taskListTitle}{task.due ? ` · ${formatDue(task.due, new Date(), locale === 'hu' ? huLocale : enUS)}` : ''}</small></span><ChevronRight /></button>)}</div></Modal>}
    {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={(view) => { setActiveView(view); setCommandOpen(false) }} onCreate={() => { setCommandOpen(false); quickInput.current?.focus() }} onRefresh={() => { setCommandOpen(false); void refresh() }} onSettings={() => { setCommandOpen(false); setSettingsOpen(true) }} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onExport={exportTasks} onShortcuts={() => { setCommandOpen(false); setShortcutsOpen(true) }} />}
    {settingsOpen && <SettingsPanel theme={theme} density={density} horizon={horizon} locale={locale} onLocale={setLocale} onTheme={setTheme} onDensity={setDensity} onHorizon={setHorizon} onRefresh={refresh} onExport={exportTasks} onClear={async () => { await clearCache(); toast.success(m.cacheCleared) }} onDisconnect={async () => { googleAuth.disconnect(); await clearCache(); queryClient.clear(); setSettingsOpen(false) }} onClose={() => setSettingsOpen(false)} />}
    {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
  </div>
}

function SyncLabel({ state }: { state: 'synced' | 'syncing' | 'offline' | 'reconnect' | 'error' }) { const m = messages[useUiStore((store) => store.locale)]; return <>{({ synced: m.synced, syncing: m.syncing, offline: m.offline, reconnect: m.reconnectRequired, error: m.syncError })[state]}</> }
function Welcome({ onConnect }: { onConnect: () => void }) { const m = messages[useUiStore((store) => store.locale)]; return <main className="welcome"><div className="welcome-card"><span className="welcome-logo"><Check /></span><h1>TaskStride</h1><p className="welcome-lead">{m.welcomeLead}</p><p>{m.welcomePrivacy}</p><button className="primary-button" onClick={onConnect}>{m.connectGoogle} <ArrowUpRight /></button><button className="text-button" onClick={() => toast(m.welcomePrivacy)}>{m.howItWorks}</button></div></main> }

type TaskRowProps = { task: TaskWithList; selected: boolean; showList: boolean; subtasks: GoogleTask[]; onSelectTask: (taskId: string) => void; onToggleTask: (task: TaskWithList) => void; dragHandle?: React.ReactNode }

const TaskRow = memo(function TaskRow({ task, selected, showList, subtasks, onSelectTask, onToggleTask, dragHandle }: TaskRowProps) {
  const locale = useUiStore((store) => store.locale); const m = messages[locale]
  const completedChildren = subtasks.filter((item) => item.status === 'completed').length
  const emailLink = task.links?.find((item) => item.type === 'email' && item.link && /^https?:\/\//i.test(item.link))
  const dueLabel = formatDue(task.due, new Date(), locale === 'hu' ? huLocale : enUS); const localizedDue = dueLabel === 'Today' ? m.today : dueLabel === 'Tomorrow' ? (locale === 'hu' ? 'Holnap' : 'Tomorrow') : dueLabel === 'Yesterday' ? (locale === 'hu' ? 'Tegnap' : 'Yesterday') : dueLabel
  const updatedAt = task.updated ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.updated)) : undefined
  return <article className={`task-row ${selected ? 'selected' : ''} ${task.status === 'completed' ? 'is-complete' : ''}`} onClick={() => onSelectTask(task.id)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onSelectTask(task.id)}>
    {dragHandle}<button className="check" onClick={(event) => { event.stopPropagation(); onToggleTask(task) }} aria-label={`${task.status === 'completed' ? m.markIncomplete : m.complete} ${task.title}`}>{task.status === 'completed' && <Check />}</button>
    <div className="task-copy"><div className="task-title-line"><strong>{task.title}</strong>{emailLink?.link && <a className="task-email-link" href={emailLink.link} target="_blank" rel="noopener noreferrer" title={emailLink.description ?? m.openEmail} aria-label={`${m.openEmail}: ${emailLink.description ?? task.title}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Mail /><span>{emailLink.description?.trim() || 'Gmail'}</span></a>}</div>{task.notes && <p>{task.notes}</p>}<div className="meta">{task.due && <span className={`due ${isOverdue(task.due) ? 'overdue' : dueLabel === 'Today' ? 'today' : ''}`}><CalendarDays />{localizedDue}</span>}{showList && <span>{task.taskListTitle}</span>}{updatedAt && <time dateTime={task.updated} title={task.updated}>{m.updated} {updatedAt}</time>}{subtasks.length > 0 && <span>{completedChildren}/{subtasks.length} {m.subtasks.toLocaleLowerCase(locale)}</span>}{task.assignmentInfo && <span className="source-badge">{task.assignmentInfo.surfaceType === 'DOCUMENT' ? 'Docs' : m.assigned}</span>}</div></div>
    <button className="row-menu" aria-label={m.taskActions}><MoreHorizontal /></button>
  </article>
})

const SortableTaskRow = memo(function SortableTaskRow(props: Omit<TaskRowProps, 'dragHandle'>) { const m = messages[useUiStore((store) => store.locale)]; const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id }); return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .55 : 1 }}><TaskRow {...props} dragHandle={<button className="drag-handle" {...attributes} {...listeners} aria-label={`${m.reorder} ${props.task.title}`}><GripVertical /></button>} /></div> })

function TaskDetails({ task, lists, subtasks, onClose, onToggle, onPatch, onDelete, onMove, onCreateSubtask }: { task: TaskWithList; lists: GoogleTaskList[]; subtasks: Array<GoogleTask & { children: GoogleTask[] }>; onClose: () => void; onToggle: () => void; onPatch: (patch: TaskPatch) => void; onDelete: () => void; onMove: (id: string) => void; onCreateSubtask: (title: string) => void }) {
  const locale = useUiStore((store) => store.locale); const m = messages[locale]
  const [title, setTitle] = useState(task.title); const [notes, setNotes] = useState(task.notes ?? ''); const [subtaskTitle, setSubtaskTitle] = useState('')
  const links = (task.links ?? []).filter((item): item is typeof item & { link: string } => Boolean(item.link && /^https?:\/\//i.test(item.link)))
  return <aside className="details"><div className="detail-toolbar"><span>{m.taskDetails}</span><div>{task.webViewLink && <button aria-label={m.openGoogle} onClick={() => window.open(task.webViewLink, '_blank', 'noopener,noreferrer')}><ArrowUpRight /></button>}<button className="mobile-close" onClick={onClose} aria-label={m.closePanel}><X /></button></div></div><div className="detail-content">
    <div className="detail-title"><button className="check" onClick={onToggle} aria-label={m.toggleCompletion}>{task.status === 'completed' && <Check />}</button><textarea value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => title.trim() && title !== task.title && onPatch({ title: title.trim() })} aria-label={m.taskDetails} rows={2} /></div>
    <div className="field-row"><span className="field-icon"><CalendarDays /></span><label><small>{m.dueDate}</small><input type="date" value={dueToDateKey(task.due) ?? ''} onChange={(event) => onPatch({ due: event.target.value ? dateKeyToGoogleDue(event.target.value) : null })} /></label></div>
    <div className="field-row"><span className="field-icon"><Inbox /></span><label><small>{m.list}</small><select value={task.taskListId} onChange={(event) => onMove(event.target.value)} disabled={Boolean(task.recurrence?.length)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label></div>
    {task.assignmentInfo && <div className="origin-block"><Inbox /><span><small>{m.assignedFrom} {task.assignmentInfo.surfaceType === 'DOCUMENT' ? 'Google Docs' : 'Google Chat'}</small>{task.assignmentInfo.linkToTask && <button onClick={() => window.open(task.assignmentInfo!.linkToTask, '_blank', 'noopener,noreferrer')}>{m.openSource} <ArrowUpRight /></button>}</span></div>}
    {links.length > 0 && <div className="links-block"><small>{m.links}</small>{links.map((item, index) => <a key={`${item.link}-${index}`} href={item.link} target="_blank" rel="noopener noreferrer" title={item.link}>{item.type === 'email' ? <Mail /> : <Link2 />}<span><strong>{item.description?.trim() || item.type?.trim() || m.link}</strong><small>{item.type === 'email' ? 'Gmail' : new URL(item.link).hostname}</small></span><ArrowUpRight /></a>)}</div>}
    <div className="notes-block"><small>{m.notes}</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => notes !== (task.notes ?? '') && onPatch({ notes })} placeholder={m.addNotes} rows={6} /></div>
    <div className="subtasks-block"><div><strong>{m.subtasks}</strong><span>{subtasks.filter((item) => item.status === 'completed').length} {m.of} {subtasks.length}</span></div>{subtasks.map((child) => <div className="subtask" key={child.id}><span className={child.status === 'completed' ? 'done' : ''}>{child.title}</span></div>)}{!task.assignmentInfo && <form onSubmit={(event) => { event.preventDefault(); if (subtaskTitle.trim()) { onCreateSubtask(subtaskTitle.trim()); setSubtaskTitle('') } }}><Plus /><input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder={m.addSubtask} /></form>}</div>
  </div><footer><button className="danger-button" onClick={onDelete}><Trash2 /> {m.deleteTask}</button><span><Cloud /> {task.updated ? `${m.updated} ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(task.updated))}` : m.savedGoogle}</span></footer></aside>
}

function EmptyState({ view, query, onAdd }: { view: SmartView | null; query: string; onAdd: () => void }) { const m = messages[useUiStore((store) => store.locale)]; const text = query ? m.noSearch : view === 'today' ? m.nothingToday : view === 'no-date' ? m.everyHasDate : view === 'completed' ? m.noCompleted : m.noTasks; return <div className="empty-state"><CheckCircle2 /><strong>{text}</strong>{!query && view !== 'completed' && <button onClick={onAdd}>{m.addATask}</button>}</div> }
function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) { const m = messages[useUiStore((store) => store.locale)]; return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label={m.close}><X /></button></header>{children}</section></div> }
function CommandPalette({ onClose, onNavigate, onCreate, onRefresh, onSettings, onTheme, onExport, onShortcuts }: { onClose: () => void; onNavigate: (view: SmartView) => void; onCreate: () => void; onRefresh: () => void; onSettings: () => void; onTheme: () => void; onExport: () => void; onShortcuts: () => void }) { const m = messages[useUiStore((store) => store.locale)]; const [filter, setFilter] = useState(''); const commands = [{ label: m.goToday, icon: Sparkles, run: () => onNavigate('today') }, { label: m.goUpcoming, icon: CalendarDays, run: () => onNavigate('upcoming') }, { label: m.createTask, icon: Plus, run: onCreate }, { label: m.refreshTasks, icon: RefreshCw, run: onRefresh }, { label: m.toggleTheme, icon: Moon, run: onTheme }, { label: m.exportTasks, icon: Download, run: onExport }, { label: m.openSettings, icon: Settings, run: onSettings }, { label: m.keyboardShortcuts, icon: Keyboard, run: onShortcuts }].filter((item) => item.label.toLowerCase().includes(filter.toLowerCase())); return <Modal title={m.commandMenu} onClose={onClose} className="command-modal"><div className="global-search"><Search /><input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={m.commandPlaceholder} /></div><div className="command-list">{commands.map(({ label, icon: Icon, run }) => <button key={label} onClick={() => { run(); if (![m.toggleTheme, m.exportTasks].includes(label)) onClose() }}><Icon /><span>{label}</span><ChevronRight /></button>)}</div></Modal> }
function SettingsPanel({ theme, density, horizon, locale, onTheme, onDensity, onHorizon, onLocale, onRefresh, onExport, onClear, onDisconnect, onClose }: { theme: string; density: string; horizon: number; locale: AppLocale; onTheme: (theme: 'system' | 'light' | 'dark') => void; onDensity: (density: 'comfortable' | 'compact') => void; onHorizon: (horizon: 7 | 14 | 30) => void; onLocale: (locale: AppLocale) => void; onRefresh: () => void; onExport: () => void; onClear: () => void; onDisconnect: () => void; onClose: () => void }) { const m = messages[locale]; return <Modal title={m.settings} onClose={onClose} className="settings-modal"><div className="settings-content"><section><h3>{m.appearance}</h3><label>{m.language}<select value={locale} onChange={(event) => onLocale(event.target.value as AppLocale)}><option value="en">{m.english}</option><option value="hu">{m.hungarian}</option></select></label><label>{m.theme}<select aria-label={m.theme} value={theme} onChange={(event) => onTheme(event.target.value as 'system' | 'light' | 'dark')}><option value="system">{m.system}</option><option value="light">{m.light}</option><option value="dark">{m.dark}</option></select></label><label>{m.density}<select value={density} onChange={(event) => onDensity(event.target.value as 'comfortable' | 'compact')}><option value="comfortable">{m.comfortable}</option><option value="compact">{m.compact}</option></select></label></section><section><h3>{m.behavior}</h3><label>{m.upcomingHorizon}<select value={horizon} onChange={(event) => onHorizon(Number(event.target.value) as 7 | 14 | 30)}><option value="7">7 {m.days}</option><option value="14">14 {m.days}</option><option value="30">30 {m.days}</option></select></label></section><section><h3>{m.data}</h3><button onClick={onRefresh}><RefreshCw /> {m.refreshNow}</button><button onClick={onExport}><Download /> {m.exportTasks}</button><button onClick={onClear}><Trash2 /> {m.clearCache}</button>{!mockMode && <button className="danger-text" onClick={onDisconnect}><CloudOff /> {m.disconnect}</button>}</section><section><h3>{m.about}</h3><p>TaskStride 1.0.0 · MIT License</p><p>{m.privacy}</p></section></div></Modal> }
function Shortcuts({ onClose }: { onClose: () => void }) { const m = messages[useUiStore((store) => store.locale)]; const rows = [['N / Q', m.newTask], ['⌘ / Ctrl + K', m.commandMenu], ['/', m.search], ['Space', m.toggleSelected], ['Enter', m.openSelected], ['Esc', m.closePanel], ['?', m.keyboardShortcuts]]; return <Modal title={m.keyboardShortcuts} onClose={onClose}><div className="shortcut-list">{rows.map(([keys, label]) => <div key={keys}><kbd>{keys}</kbd><span>{label}</span></div>)}</div></Modal> }

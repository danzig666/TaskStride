import { describe, expect, it } from 'vitest'
import { parseImportFile, planImport } from '../lib/importTasks'
import type { GoogleTaskList, TaskWithList } from '../types/googleTasks'

const existingTask = (values: Partial<TaskWithList> & Pick<TaskWithList, 'id' | 'title'>): TaskWithList => ({
  status: 'needsAction', position: values.id, taskListId: 'work', taskListTitle: 'Work', ...values,
})
const lists: GoogleTaskList[] = [{ id: 'work', title: 'Work' }, { id: 'home', title: 'Home' }]

describe('import planning', () => {
  it('rejects anything that is not a TaskStride export', () => {
    expect(parseImportFile(null)).toBeNull()
    expect(parseImportFile({ lists: [] })).toBeNull()
    expect(parseImportFile('{}')).toBeNull()
  })

  it('keeps only usable records and drops unknown fields', () => {
    const file = parseImportFile({ lists: [{ id: 'work', title: 'Work' }, { title: '' }], tasks: [{ title: ' Write brief ', notes: 'x', junk: 1 }, { title: '   ' }, 42] })
    expect(file?.lists).toEqual([{ id: 'work', title: 'Work' }])
    expect(file?.tasks).toEqual([{ id: undefined, title: 'Write brief', notes: 'x', due: undefined, status: undefined, completed: undefined, parent: undefined, position: undefined, deleted: false, hidden: false, taskListId: undefined, taskListTitle: undefined }])
  })

  it('imports only the tasks that are missing', () => {
    const plan = planImport(
      { lists, tasks: [
        { id: 'w1', title: 'Already here by id' },
        { title: 'Already here by content', due: '2026-03-04T00:00:00.000Z', taskListId: 'work' },
        { title: 'Genuinely new', taskListId: 'work' },
      ] },
      { lists, tasks: [
        existingTask({ id: 'w1', title: 'Renamed since the export' }),
        existingTask({ id: 'w2', title: 'already here BY CONTENT', due: '2026-03-04T00:00:00.000Z' }),
      ] },
    )
    expect(plan.entries.map((entry) => entry.title)).toEqual(['Genuinely new'])
    expect(plan.skipped).toBe(2)
    expect(plan.total).toBe(3)
    expect(plan.newListTitles).toEqual([])
  })

  it('treats a differing due date as a different task', () => {
    const plan = planImport(
      { lists, tasks: [{ title: 'Pay invoice', due: '2026-03-05T00:00:00.000Z', taskListId: 'work' }] },
      { lists, tasks: [existingTask({ id: 'w1', title: 'Pay invoice', due: '2026-03-04T00:00:00.000Z' })] },
    )
    expect(plan.entries).toHaveLength(1)
  })

  it('skips deleted, hidden and in-file duplicate records', () => {
    const plan = planImport(
      { lists, tasks: [
        { title: 'Gone', deleted: true, taskListId: 'work' },
        { title: 'Hidden', hidden: true, taskListId: 'work' },
        { title: 'Twice', taskListId: 'work' },
        { title: 'Twice', taskListId: 'work' },
      ] },
      { lists, tasks: [] },
    )
    expect(plan.entries.map((entry) => entry.title)).toEqual(['Twice'])
    expect(plan.skipped).toBe(3)
  })

  it('creates lists that do not exist yet and matches existing ones by title', () => {
    const plan = planImport(
      { lists: [{ id: 'archive', title: 'Archive' }, { id: 'home', title: 'home' }], tasks: [
        { title: 'Archived idea', taskListId: 'archive' },
        { title: 'Water plants', taskListId: 'home' },
      ] },
      { lists, tasks: [] },
    )
    expect(plan.newListTitles).toEqual(['Archive'])
    expect(plan.entries.find((entry) => entry.title === 'Archived idea')).toMatchObject({ listTitle: 'Archive', listId: undefined })
    expect(plan.entries.find((entry) => entry.title === 'Water plants')).toMatchObject({ listTitle: 'Home', listId: 'home' })
  })

  it('emits parents before subtasks and keeps them in one list', () => {
    const plan = planImport(
      { lists, tasks: [
        { id: 'child', title: 'Child', parent: 'parent', position: '2', taskListId: 'work' },
        { id: 'parent', title: 'Parent', position: '1', taskListId: 'work' },
      ] },
      { lists, tasks: [] },
    )
    expect(plan.entries.map((entry) => entry.title)).toEqual(['Parent', 'Child'])
    expect(plan.entries[1]).toMatchObject({ parentSourceId: 'parent', listId: 'work' })
  })

  it('attaches a subtask to the parent that already exists', () => {
    const plan = planImport(
      { lists, tasks: [
        { id: 'w1', title: 'Parent', taskListId: 'work' },
        { id: 'new-child', title: 'New child', parent: 'w1', taskListId: 'work' },
      ] },
      { lists, tasks: [existingTask({ id: 'w1', title: 'Parent' })] },
    )
    expect(plan.entries.map((entry) => entry.title)).toEqual(['New child'])
    expect(plan.entries[0]).toMatchObject({ parentExistingId: 'w1', listId: 'work', parentSourceId: undefined })
  })

  it('imports completed tasks as completed', () => {
    const plan = planImport(
      { lists, tasks: [{ title: 'Done thing', status: 'completed', completed: '2026-02-01T10:00:00.000Z', taskListId: 'work' }] },
      { lists, tasks: [] },
    )
    expect(plan.entries[0]).toMatchObject({ completed: true, completedAt: '2026-02-01T10:00:00.000Z' })
  })

  it('falls back to the first existing list when the export names none', () => {
    const plan = planImport({ lists: [], tasks: [{ title: 'Loose task' }] }, { lists, tasks: [] })
    expect(plan.entries[0]).toMatchObject({ listId: 'work', listTitle: 'Work' })
    expect(plan.newListTitles).toEqual([])
  })

  it('survives a subtask whose parent is missing from the export', () => {
    const plan = planImport({ lists, tasks: [{ id: 'orphan', title: 'Orphan', parent: 'ghost', taskListId: 'work' }] }, { lists, tasks: [] })
    expect(plan.entries[0]).toMatchObject({ title: 'Orphan', parentSourceId: undefined })
    expect(plan.entries[0].parentExistingId).toBeUndefined()
  })
})

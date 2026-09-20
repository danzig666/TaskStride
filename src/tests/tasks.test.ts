import { describe, expect, it } from 'vitest'
import { buildTaskTree, canMoveAcrossLists, canNest, inSmartView, reconcileTasks, searchTasks, sortByPosition } from '../lib/tasks'
import type { GoogleTask, TaskWithList } from '../types/googleTasks'

const task = (values: Partial<GoogleTask> & Pick<GoogleTask, 'id' | 'title'>): GoogleTask => ({ status: 'needsAction', position: values.id, ...values })

describe('task domain logic', () => {
  it('sorts using Google position strings', () => expect(sortByPosition([task({ id: 'b', title: 'B', position: '2' }), task({ id: 'a', title: 'A', position: '1' })]).map((item) => item.id)).toEqual(['a', 'b']))
  it('builds hierarchy from parent relationships', () => { const tree = buildTaskTree([task({ id: 'p', title: 'Parent' }), task({ id: 'c', title: 'Child', parent: 'p' })]); expect(tree).toHaveLength(1); expect(tree[0].children[0].id).toBe('c') })
  it('computes smart-view membership', () => { const today = new Date(2026, 8, 20); expect(inSmartView(task({ id: 't', title: 'Today', due: '2026-09-20T00:00:00Z' }), 'today', 7, today)).toBe(true); expect(inSmartView(task({ id: 'n', title: 'No date' }), 'no-date', 7, today)).toBe(true) })
  it('removes tombstones during incremental reconciliation', () => { const result = reconcileTasks([task({ id: 'a', title: 'Old' }), task({ id: 'b', title: 'Keep' })], [task({ id: 'a', title: 'Deleted', deleted: true })]); expect(result.map((item) => item.id)).toEqual(['b']) })
  it('searches title, notes, list and ignores accents', () => { const item = { ...task({ id: '1', title: 'Réserver le train' }), taskListId: 'p', taskListTitle: 'Personal' } as TaskWithList; expect(searchTasks([item], 'reserver')).toEqual([item]); expect(searchTasks([item], 'personal')).toEqual([item]) })
  it('guards unsupported assigned and repeating moves', () => { const assigned = task({ id: 'a', title: 'Assigned', assignmentInfo: { surfaceType: 'DOCUMENT' } }); expect(canNest(assigned).allowed).toBe(false); expect(canMoveAcrossLists(task({ id: 'r', title: 'Repeat', recurrence: ['x'] })).allowed).toBe(false) })
})

import { describe, expect, it } from 'vitest'
import { batchPanelItems, featurePanelItems } from '~/composables/workspace/useFilterPanel'
import type { Batch, Feature } from '~/types/api'
import { formatClock } from '~/utils/duration'
import { formatDayHeading, formatTime } from '~/utils/format'
import { spaceIconColor, spaceIconName } from '~/utils/spaceIdentity'
import { carriesFiles, nameUploadedFile, transferFiles } from '~/utils/transferFiles'

function transfer(options: { types?: string[], items?: Array<{ kind: string, file: File | null }>, files?: File[] }) {
  return {
    types: options.types ?? [],
    items: (options.items ?? []).map(item => ({ kind: item.kind, getAsFile: () => item.file })),
    files: options.files ?? []
  } as unknown as DataTransfer
}

describe('clipboard and drop files', () => {
  const png = new File(['x'], 'image.png', { type: 'image/png' })

  it('reads files from DataTransfer items first, then from files', () => {
    expect(transferFiles(transfer({ items: [{ kind: 'string', file: null }, { kind: 'file', file: png }] }))).toEqual([png])
    expect(transferFiles(transfer({ files: [png] }))).toEqual([png])
    expect(transferFiles(null)).toEqual([])
  })

  it('accepts only drags that carry files (not dragged task rows)', () => {
    expect(carriesFiles(transfer({ types: ['Files'] }))).toBe(true)
    expect(carriesFiles(transfer({ types: ['application/x-masar-tasks', 'text/plain'] }))).toBe(false)
  })

  it('names pasted screenshots and keeps real file names', () => {
    const named = nameUploadedFile(png, new Date('2026-10-28T09:05:07Z'))
    expect(named.name).toBe('pasted-image-20261028-090507.png')
    expect(named.type).toBe('image/png')
    const report = new File(['x'], 'report.pdf', { type: 'application/pdf' })
    expect(nameUploadedFile(report)).toBe(report)
  })
})

describe('timer and activity formatting', () => {
  it('formats the elapsed timer clock', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(309)).toBe('0:05:09')
    expect(formatClock(3 * 3600 + 61)).toBe('3:01:01')
  })

  it('groups activity by Qatar business day', () => {
    const now = new Date('2026-10-28T10:00:00Z')
    expect(formatDayHeading('2026-10-28T06:00:00Z', now)).toBe('Today')
    // 22:30 UTC on the 27th is already the 28th in Qatar (UTC+3).
    expect(formatDayHeading('2026-10-27T22:30:00Z', now)).toBe('Today')
    expect(formatDayHeading('2026-10-27T08:00:00Z', now)).toBe('Yesterday')
    expect(formatDayHeading('2026-10-20T08:00:00Z', now)).toBe('Tue, 20 Oct 2026')
    expect(formatTime('2026-10-28T11:05:00Z')).toBe('14:05')
  })
})

describe('Space identity', () => {
  it('uses the chosen icon and colour, with stable defaults', () => {
    expect(spaceIconName({ name: 'S-1', icon: 'rocket' })).toBe('rocket')
    expect(spaceIconName({ name: 'S-1', icon: 'not-curated' })).toBe('folder-kanban')
    expect(spaceIconColor({ name: 'S-1', iconColor: 'teal' })).toBe('teal')
    expect(spaceIconColor({ name: 'S-7' })).toBe(spaceIconColor({ name: 'S-7' }))
  })
})

describe('filter panel items', () => {
  it('lists Features after a "without" entry, with progress, and only unfinished Batches', () => {
    const features = [{ name: 'F-1', title: 'Checkout', roadmap: 'Now', progress: { total: 4, percent: 50 } }] as unknown as Feature[]
    expect(featurePanelItems(features).map(item => item.value)).toEqual(['none', 'F-1'])
    expect(featurePanelItems(features)[1]!.percent).toBe(50)
    const batches = [
      { name: 'B-1', batchName: 'Batch 5', status: 'Active', startDate: '2026-10-25' },
      { name: 'B-0', batchName: 'Batch 4', status: 'Finished', startDate: '2026-10-11' }
    ] as unknown as Batch[]
    expect(batchPanelItems(batches).map(item => item.value)).toEqual(['any', 'B-1', 'none'])
  })
})

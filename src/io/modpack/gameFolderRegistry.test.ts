import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeClientJar } from '../../../tests/fixtures/fakeGameFolder'
import { MemoryFileSource } from '../memoryFileSource'
import { GameFolderRegistry } from './gameFolderRegistry'
import type { ModpackStore, StoredModpack } from './modpackRegistry'

class MemoryStore implements ModpackStore<string> {
  readonly items = new Map<string, StoredModpack<string>>()
  async list() {
    return [...this.items.values()]
  }
  async put(item: StoredModpack<string>) {
    this.items.set(item.id, item)
  }
  async remove(id: string) {
    this.items.delete(id)
  }
}

function setup(store: MemoryStore | null) {
  const game = new MemoryFileSource([['versions/1.20.1/1.20.1.jar', fakeClientJar()]])
  let n = 0
  let t = 100
  const registry = new GameFolderRegistry<string>(
    store,
    { open: async (handle, request) => (handle === 'P' && request ? game : null) },
    { newId: () => `g${++n}`, now: () => t++ },
  )
  return { registry, game }
}

describe('GameFolderRegistry', () => {
  it('ゲームのフォルダを保存し、次回はハンドルから開く', async () => {
    const store = new MemoryStore()
    const { registry, game } = setup(store)
    expect(await registry.add('Install', game, 'P')).toEqual({
      kind: 'added',
      entry: { id: 'g1', name: 'Install', addedAt: 100, persistent: true },
    })
    expect(store.items.get('g1')?.handle).toBe('P')
    expect(await registry.list()).toEqual([{ id: 'g1', name: 'Install', addedAt: 100, persistent: true }])
    expect(await registry.open('g1', false)).toEqual({ kind: 'needs-permission' })
    expect(await registry.open('g1', true)).toEqual({ kind: 'opened', source: game })
    expect(await registry.open('none', true)).toEqual({ kind: 'not-registered' })
    await registry.remove('g1')
    expect(await registry.list()).toEqual([])
  })

  it('ハンドルがなければ、ページを開いている間だけ覚える', async () => {
    const { registry, game } = setup(new MemoryStore())
    const result = await registry.add('Install', game, null)
    expect(result).toMatchObject({ kind: 'added', entry: { persistent: false } })
    expect(await registry.open('g1', false)).toEqual({ kind: 'opened', source: game })
    await registry.remove('g1')
    expect(await registry.list()).toEqual([])
  })

  it('ゲームのフォルダでなければ足さない', async () => {
    const store = new MemoryStore()
    const { registry } = setup(store)
    const result = await registry.add('x', new MemoryFileSource([['readme.txt', strToU8('x')]]), 'X')
    expect(result).toEqual({ kind: 'invalid' })
    expect(store.items.size).toBe(0)
  })
})

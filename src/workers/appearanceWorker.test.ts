import { describe, expect, it } from 'vitest'
import { fakeAssetFiles, fakeAssetJar, GEAR_COLOR } from '../../tests/fixtures/fakeAssets'
import { MemoryAssetReader } from '../../tests/fixtures/fakeAppearance'
import { pixelAt } from '../../tests/fixtures/pngFixture'
import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import type { AssetReader } from '../io/assets/assetTypes'
import { MemoryFileSource } from '../io/memoryFileSource'
import { ModpackLoader } from '../io/modpack/modpackLoader'
import type { FromAppearanceWorker, ToAppearanceWorker } from './appearanceProtocol'
import { InlineAppearanceProvider, WorkerAppearanceProvider, type AppearanceWorkerPort } from './appearanceWorkerClient'
import { createAppearanceWorkerHost } from './appearanceWorkerHost'

const state = (id: string, properties: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), properties)

interface FakeWorker extends AppearanceWorkerPort {
  toWorker: ToAppearanceWorker[]
  fromWorker: FromAppearanceWorker[]
  /** 移した buffer（送った側では使えなくなる） */
  transferred: ArrayBuffer[]
  terminated: boolean
  crash(message: string): void
}

/**
 * Worker の代わり。メッセージは structured clone で写し（transfer の buffer は移す）、非同期で届ける。
 */
function fakeWorker(): FakeWorker {
  const listeners: ((e: MessageEvent<FromAppearanceWorker>) => void)[] = []
  const errorListeners: ((e: ErrorEvent) => void)[] = []
  const worker: FakeWorker = {
    toWorker: [],
    fromWorker: [],
    transferred: [],
    terminated: false,
    postMessage(message, transfer) {
      worker.toWorker.push(message)
      for (const t of transfer) if (t instanceof ArrayBuffer) worker.transferred.push(t)
      const copy = structuredClone(message, { transfer })
      setTimeout(() => host.handle(copy), 0)
    },
    addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
      if (type === 'message') listeners.push(fn as (e: MessageEvent<FromAppearanceWorker>) => void)
      else errorListeners.push(fn as (e: ErrorEvent) => void)
    },
    terminate() {
      worker.terminated = true
    },
    crash(message) {
      errorListeners.forEach((fn) => fn({ message } as ErrorEvent))
    },
  }
  const host = createAppearanceWorkerHost((message, transfer) => {
    worker.fromWorker.push(message)
    for (const t of transfer) if (t instanceof ArrayBuffer) worker.transferred.push(t)
    const copy = structuredClone(message, { transfer })
    setTimeout(() => listeners.forEach((fn) => fn({ data: copy } as MessageEvent<FromAppearanceWorker>)), 0)
  })
  return worker
}

describe('見た目の Worker', () => {
  it('画面側の reader でファイルを読み、Worker で作った見た目を受け取る（Worker なしと同じ結果）', async () => {
    const worker = fakeWorker()
    const reader = new MemoryAssetReader(fakeAssetFiles())
    const provider = new WorkerAppearanceProvider(worker, reader)
    const states = [state('test:gear'), state('test:casing', { axis: 'z' }), state('test:broken')]
    const set = await provider.prepare(states)

    const inline = await new InlineAppearanceProvider(new MemoryAssetReader(fakeAssetFiles())).prepare(states)
    expect(set.appearances).toEqual(inline.appearances)
    expect(set.problems).toEqual(inline.problems)
    expect(set.atlas.regions).toEqual(inline.atlas.regions)
    expect([...set.atlas.pixels]).toEqual([...inline.atlas.pixels])
    const r = set.atlas.regions['test:block/gear']!
    expect(pixelAt(set.atlas.pixels, set.atlas.width, Math.round(r.u0 * set.atlas.width) + 1, Math.round(r.v0 * set.atlas.height) + 1)).toEqual([
      ...GEAR_COLOR,
    ])

    // 読むのは画面側。同じ時に頼むものはまとめて1つのメッセージにする
    const reads = worker.fromWorker.filter((m) => m.type === 'read')
    expect(reads.some((m) => m.calls.length > 1)).toBe(true)
    expect(reader.reads).toContain('assets/test/textures/block/gear.png')

    // アトラスの画素と、読んだファイルのバイト列は、写さずに移す
    const result = worker.fromWorker.find((m) => m.type === 'result')!
    expect(result.type === 'result' && worker.transferred.includes(result.set.atlas.pixels.buffer as ArrayBuffer)).toBe(true)
    expect(worker.transferred.length).toBeGreaterThan(1)
  })

  it('画面側で読めなかったファイルは problems に出し、Worker は止まらない。reader の問題も足す', async () => {
    const worker = fakeWorker()
    const reader: AssetReader = {
      problems: ['mods/old.jar: 開けませんでした（壊れています）'],
      readText: async () => null,
      readBytes: async (path) => {
        if (path.endsWith('gear.png')) throw new Error('ディスクのエラー')
        const v = fakeAssetFiles()[path]
        return v === undefined ? null : typeof v === 'string' ? new TextEncoder().encode(v) : v
      },
    }
    const set = await new WorkerAppearanceProvider(worker, reader).prepare([state('test:gear')])
    expect(set.atlas.regions['test:block/gear']).toEqual(set.atlas.missing)
    expect(set.problems).toContain('assets/test/textures/block/gear.png を読めませんでした（ディスクのエラー）')
    expect(set.problems).toContain('mods/old.jar: 開けませんでした（壊れています）')
  })

  it('止めると Worker を終わらせ、待っている prepare はエラーになる', async () => {
    const worker = fakeWorker()
    const provider = new WorkerAppearanceProvider(worker, new MemoryAssetReader(fakeAssetFiles()))
    const pending = provider.prepare([state('test:gear')])
    provider.dispose()
    await expect(pending).rejects.toThrow('止めました')
    expect(worker.terminated).toBe(true)
    await expect(provider.prepare([state('test:gear')])).rejects.toThrow('止めました')
  })

  it('Worker が落ちたら、待っている prepare はエラーになる', async () => {
    const worker = fakeWorker()
    const provider = new WorkerAppearanceProvider(worker, new MemoryAssetReader(fakeAssetFiles()))
    const pending = provider.prepare([state('test:gear')])
    worker.crash('out of memory')
    await expect(pending).rejects.toThrow('out of memory')
  })

  it('本物の Modpack（偽の jar）の資産から、Worker で Create 風のブロックを描く見た目を作る', async () => {
    const pack = await new ModpackLoader(new MemoryFileSource([['mods/test-assets.jar', fakeAssetJar()]])).load()
    const provider = new WorkerAppearanceProvider(fakeWorker(), pack.assets())
    const set = await provider.prepare([state('test:gear'), state('test:casing', { axis: 'y' })])
    expect(set.appearances['test:gear']?.parts).toHaveLength(1)
    expect(set.appearances['test:casing[axis=y]']?.parts[0]!.model.elements[0]!.faces.up?.texture).toBe('test:block/casing_end')
    expect(set.atlas.regions['test:block/gear']).not.toEqual(set.atlas.missing)
    expect(set.problems).toEqual([])
  })
})

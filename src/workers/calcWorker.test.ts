import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { NOOP_PLUGIN_ID, noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import type { CalcModpack, CalcPlugin } from '../calc/calcPlugin'
import { resolved } from '../calc/provenance'
import { PluginRegistry } from '../calc/pluginRegistry'
import type { FromCalcWorker, ToCalcWorker } from './calcProtocol'
import { WorkerCalcBackend, type CalcWorkerPort } from './calcWorkerClient'
import { createCalcWorkerHost } from './calcWorkerHost'

/**
 * Worker の代わり。メッセージは structured clone で写し、非同期で届ける（本物の postMessage と同じ）。
 */
function fakeWorker(registry: PluginRegistry): CalcWorkerPort & { sent: ToCalcWorker[] } {
  const listeners: ((e: MessageEvent<FromCalcWorker>) => void)[] = []
  const host = createCalcWorkerHost(registry, (message) => {
    const copy = structuredClone(message)
    setTimeout(() => listeners.forEach((fn) => fn({ data: copy } as MessageEvent<FromCalcWorker>)), 0)
  })
  const sent: ToCalcWorker[] = []
  return {
    sent,
    postMessage(message) {
      sent.push(message)
      const copy = structuredClone(message)
      setTimeout(() => host.handle(copy), 0)
    },
    addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
      if (type === 'message') listeners.push(fn as (e: MessageEvent<FromCalcWorker>) => void)
    },
  }
}

const bp = blueprintFixture()
  .place([0, 0, 0], 'create:shaft', { axis: 'x' })
  .place([1, 0, 0], 'minecraft:stone')
  .toBlueprint()

describe('計算の Worker', () => {
  it('設計図を写して送り、Worker の中のプラグインの結果を受け取る', async () => {
    const backend = new WorkerCalcBackend(fakeWorker(new PluginRegistry([noopCalcPlugin()])))
    const outcomes = await backend.run({
      blueprint: bp,
      pack: null,
      ports: [{ id: 'p1', pos: [0, 0, 0], face: 'west', pluginId: NOOP_PLUGIN_ID, kind: 'test-source', params: { amount: 1 } }],
    })
    expect(outcomes).toHaveLength(1)
    const o = outcomes[0]
    expect(o.status).toBe('ok')
    if (o.status !== 'ok') return
    expect(o.result.summary[0]).toEqual({ label: 'ブロック数', value: { value: '2', source: 'blueprint' } })
    expect(o.result.assumptions.map((a) => a.message)).toContain('仮の入出力 test-source を使った')
  })

  it('Worker の中から Modpack の設定ファイルを画面側に問い合わせる', async () => {
    const asked: string[] = []
    const pack: CalcModpack = {
      hasNamespace: (ns) => ns === 'create',
      config: async (path) => {
        asked.push(path)
        return '5'
      },
    }
    const worker = fakeWorker(new PluginRegistry([noopCalcPlugin()]))
    const outcomes = await new WorkerCalcBackend(worker).run({ blueprint: bp, pack, ports: [] })
    expect(asked).toEqual(['config/test.txt'])
    expect(outcomes[0].status === 'ok' && outcomes[0].result.summary[1].value).toEqual({ value: '5', source: 'modpack' })
    // 設計図に出てくる namespace のうち、Modpack にあるものだけを送る
    const run = worker.sent.find((m) => m.type === 'run')
    expect(run?.type === 'run' && run.pack).toEqual({ namespaces: ['create'] })
  })

  it('Worker の中から Modpack のフォルダの一覧を画面側に問い合わせる', async () => {
    const asked: string[] = []
    const pack: CalcModpack = {
      hasNamespace: () => true,
      config: async () => null,
      list: async (dir) => {
        asked.push(dir)
        return ['World/']
      },
    }
    const listing: CalcPlugin = {
      ...noopCalcPlugin(),
      run: async (_bp, ctx) => ({
        summary: [{ label: '一覧', value: resolved((await ctx.pack?.list?.('saves/'))?.join() ?? '', 'modpack') }],
        issues: [],
        assumptions: [],
      }),
    }
    const [o] = await new WorkerCalcBackend(fakeWorker(new PluginRegistry([listing]))).run({ blueprint: bp, pack, ports: [] })
    expect(asked).toEqual(['saves/'])
    expect(o.status === 'ok' && o.result.summary[0].value.value).toBe('World/')

    // list を持たない Modpack では空の一覧
    const noList: CalcModpack = { hasNamespace: () => true, config: async () => null }
    const [o2] = await new WorkerCalcBackend(fakeWorker(new PluginRegistry([listing]))).run({ blueprint: bp, pack: noList, ports: [] })
    expect(o2.status === 'ok' && o2.result.summary[0].value.value).toBe('')
  })

  it('設定ファイルを読めなかったら、そのプラグインの error になる', async () => {
    const pack: CalcModpack = {
      hasNamespace: () => false,
      config: async () => {
        throw new Error('読めません')
      },
    }
    const backend = new WorkerCalcBackend(fakeWorker(new PluginRegistry([noopCalcPlugin()])))
    const [o] = await backend.run({ blueprint: bp, pack, ports: [] })
    expect(o.status).toBe('error')
    expect(o.status === 'error' && o.message).toMatch(/読めません/)
  })

  it('Worker の中から Modpack のレシピを画面側に問い合わせる', async () => {
    let asked = 0
    const pack: CalcModpack = {
      hasNamespace: () => true,
      config: async () => null,
      recipeBook: async () => {
        asked++
        return {
          recipes: [{ id: 'create:milling/wheat', type: 'milling', items: ['minecraft:wheat'], tags: [], duration: 150 }],
          scriptsChangeRecipes: true,
        }
      },
    }
    const recipes: CalcPlugin = {
      ...noopCalcPlugin(),
      run: async (_bp, ctx) => {
        const book = await ctx.pack?.recipeBook?.()
        const text = book ? `${book.recipes.map((r) => `${r.id}=${r.duration}`).join()}/${book.scriptsChangeRecipes}` : ''
        return { summary: [{ label: 'レシピ', value: resolved(text, 'modpack') }], issues: [], assumptions: [] }
      },
    }
    const [o] = await new WorkerCalcBackend(fakeWorker(new PluginRegistry([recipes]))).run({ blueprint: bp, pack, ports: [] })
    expect(asked).toBe(1)
    expect(o.status === 'ok' && o.result.summary[0].value.value).toBe('create:milling/wheat=150/true')

    // recipeBook を持たない Modpack では空のレシピ
    const noRecipes: CalcModpack = { hasNamespace: () => true, config: async () => null }
    const [o2] = await new WorkerCalcBackend(fakeWorker(new PluginRegistry([recipes]))).run({ blueprint: bp, pack: noRecipes, ports: [] })
    expect(o2.status === 'ok' && o2.result.summary[0].value.value).toBe('/false')
  })

  it('レシピを読めなかったら、そのプラグインの error になる', async () => {
    const pack: CalcModpack = {
      hasNamespace: () => true,
      config: async () => null,
      recipeBook: async () => {
        throw new Error('レシピを読めません')
      },
    }
    const recipes: CalcPlugin = {
      ...noopCalcPlugin(),
      run: async (_bp, ctx) => {
        await ctx.pack?.recipeBook?.()
        return { summary: [], issues: [], assumptions: [] }
      },
    }
    const [o] = await new WorkerCalcBackend(fakeWorker(new PluginRegistry([recipes]))).run({ blueprint: bp, pack, ports: [] })
    expect(o.status === 'error' && o.message).toMatch(/レシピを読めません/)
  })
})

import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { NOOP_PLUGIN_ID, noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import type { CalcModpack } from '../calc/calcPlugin'
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
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScriptRunInput, ScriptRunOutput } from '../io/modpack/kubejsScripts/scriptTypes'
import { createWorkerScriptRunner, type ScriptWorker } from './kubejsScriptsClient'
import { BLOCKED_WORKER_GLOBALS, hardenWorkerScope } from './kubejsScriptsHarden'
import type { ScriptRunRequest, ScriptRunResponse } from './kubejsScriptsProtocol'

describe('hardenWorkerScope', () => {
  it('ネットワーク・保存・コードを作る名前を、大域とそのプロトタイプから消す。関数の constructor も消す', () => {
    const proto = { fetch: () => 'real', caches: {}, keep: 1 }
    const scope = Object.create(proto) as Record<string, unknown>
    scope.XMLHttpRequest = class {}
    scope.WebSocket = class {}
    scope.importScripts = () => undefined
    scope.postMessage = () => undefined
    Object.defineProperty(scope, 'indexedDB', { value: {}, configurable: false, writable: true })
    const fnProto = { constructor: () => 'Function' }

    hardenWorkerScope(scope, [fnProto])

    for (const name of ['fetch', 'caches', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB']) expect(scope[name]).toBeUndefined()
    expect(proto.keep).toBe(1)
    expect(typeof scope.postMessage).toBe('function')
    expect(fnProto.constructor).toBeUndefined()
    expect(BLOCKED_WORKER_GLOBALS).toEqual(expect.arrayContaining(['fetch', 'eval', 'Function', 'importScripts']))
  })
})

const input: ScriptRunInput = { files: [{ path: 'a.js', text: '' }], recipes: [], itemTags: {}, modIds: [] }

/** 作り物の Worker。reply を呼ぶまで答えない */
function fakeWorker(reply: (w: ScriptWorker, req: ScriptRunRequest) => void) {
  const state = { terminated: 0, requests: [] as ScriptRunRequest[] }
  const worker: ScriptWorker = {
    onmessage: null,
    onerror: null,
    postMessage(req) {
      state.requests.push(req)
      reply(worker, req)
    },
    terminate() {
      state.terminated++
    },
  }
  return { worker, state }
}

const answer = (w: ScriptWorker, res: ScriptRunResponse) => w.onmessage?.({ data: res } as MessageEvent<ScriptRunResponse>)

describe('createWorkerScriptRunner', () => {
  afterEach(() => vi.useRealTimers())

  it('Worker の結果を返し、Worker を止める', async () => {
    const output: ScriptRunOutput = {
      recipes: [],
      itemTags: {},
      summary: { files: 1, added: 0, removed: 0, replaced: 0, unsupported: [], errors: [], failed: null },
    }
    const { worker, state } = fakeWorker((w) => queueMicrotask(() => answer(w, { ok: true, output })))
    const run = createWorkerScriptRunner({ createWorker: () => worker })!
    expect(await run(input)).toBe(output)
    expect(state.requests).toEqual([{ input }])
    expect(state.terminated).toBe(1)
  })

  it('時間の上限を超えたら Worker を止め、スクリプトの結果を使わない', async () => {
    vi.useFakeTimers()
    const { worker, state } = fakeWorker(() => undefined)
    const run = createWorkerScriptRunner({ createWorker: () => worker, timeLimitMs: 1000 })!
    const pending = run({ ...input, recipes: [{ id: 'x:y', type: 'milling', items: [], tags: [], duration: 1, results: [] }] })
    await vi.advanceTimersByTimeAsync(1000)
    const out = await pending
    expect(out.summary.failed).toBe('1 秒で終わらなかったので打ち切った')
    expect(out.recipes.map((r) => r.id)).toEqual(['x:y'])
    expect(state.terminated).toBe(1)
  })

  it('Worker が失敗を返した・止まったときも、スクリプトの結果を使わずに続ける', async () => {
    const failing = fakeWorker((w) => queueMicrotask(() => answer(w, { ok: false, message: '壊れた' })))
    expect((await createWorkerScriptRunner({ createWorker: () => failing.worker })!(input)).summary.failed).toBe('動かせなかった（壊れた）')
    const crashing = fakeWorker((w) => queueMicrotask(() => w.onerror?.({ message: 'oops' } as ErrorEvent)))
    expect((await createWorkerScriptRunner({ createWorker: () => crashing.worker })!(input)).summary.failed).toBe('動かす処理が止まった（oops）')
  })
})

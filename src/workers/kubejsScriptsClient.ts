// KubeJS のスクリプトを Worker で動かす ScriptRunner を作る（docs/design.md「KubeJS のスクリプトを動かす」）。
// 1回動かすごとに Worker を1つ作り、終わったら止める。時間の上限を超えたら止めて、スクリプトの結果は使わない。

import { unchangedOutput, type ScriptRunner } from '../io/modpack/kubejsScripts/scriptTypes'
import type { ScriptRunRequest, ScriptRunResponse } from './kubejsScriptsProtocol'

/** スクリプト全体を動かす時間の上限 */
export const SCRIPT_TIME_LIMIT_MS = 20_000

/** Worker の、ここで使う部分だけ。テストでは作り物を渡す */
export interface ScriptWorker {
  postMessage(message: ScriptRunRequest): void
  onmessage: ((event: MessageEvent<ScriptRunResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  terminate(): void
}

export interface ScriptRunnerOptions {
  readonly timeLimitMs?: number
  /** Worker を作る。省略すると kubejsScripts.worker.ts */
  readonly createWorker?: () => ScriptWorker
}

/** Worker で動かす ScriptRunner。Worker が使えなければ null（スクリプトは動かさない） */
export function createWorkerScriptRunner(options: ScriptRunnerOptions = {}): ScriptRunner | null {
  const create =
    options.createWorker ??
    (typeof Worker === 'undefined'
      ? null
      : () => new Worker(new URL('./kubejsScripts.worker.ts', import.meta.url), { type: 'module' }) as unknown as ScriptWorker)
  if (!create) return null
  const limit = options.timeLimitMs ?? SCRIPT_TIME_LIMIT_MS
  return (input) =>
    new Promise((resolve) => {
      const worker = create()
      let done = false
      const finish = (result: Parameters<typeof resolve>[0]) => {
        if (done) return
        done = true
        clearTimeout(timer)
        worker.terminate()
        resolve(result)
      }
      const timer = setTimeout(() => finish(unchangedOutput(input, `${limit / 1000} 秒で終わらなかったので打ち切った`)), limit)
      worker.onmessage = (event) => {
        const res = event.data
        finish(res.ok ? res.output : unchangedOutput(input, `動かせなかった（${res.message}）`))
      }
      worker.onerror = (event) => finish(unchangedOutput(input, `動かす処理が止まった（${event.message}）`))
      worker.postMessage({ input })
    })
}

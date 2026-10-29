// KubeJS のスクリプトを動かす Worker（docs/design.md「KubeJS のスクリプトを動かす」）。
// 動かす前に自分の大域を削る（kubejsScriptsHarden.ts）。結果を返す postMessage だけは先に取っておく。

import { runKubeJsScripts } from '../io/modpack/kubejsScripts/runScripts'
import { hardenWorkerScope, realFunctionPrototypes } from './kubejsScriptsHarden'
import type { ScriptRunRequest, ScriptRunResponse } from './kubejsScriptsProtocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ScriptRunRequest>) => void) | null
  postMessage(message: ScriptRunResponse): void
}

const scope = self as unknown as WorkerScope
const post = scope.postMessage.bind(scope)

scope.onmessage = (event) => {
  scope.onmessage = null
  try {
    hardenWorkerScope(self, realFunctionPrototypes())
    post({ ok: true, output: runKubeJsScripts(event.data.input) })
  } catch (e) {
    post({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

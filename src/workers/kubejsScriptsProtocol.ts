// KubeJS のスクリプトを動かす Worker とのやりとり。1つの Worker で1回だけ動かす。

import type { ScriptRunInput, ScriptRunOutput } from '../io/modpack/kubejsScripts/scriptTypes'

export interface ScriptRunRequest {
  readonly input: ScriptRunInput
}

export type ScriptRunResponse = { readonly ok: true; readonly output: ScriptRunOutput } | { readonly ok: false; readonly message: string }

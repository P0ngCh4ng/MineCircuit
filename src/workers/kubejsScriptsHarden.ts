// KubeJS のスクリプトを動かす Worker の大域を削る（docs/design.md「KubeJS のスクリプトを動かす」）。
// スクリプトは sval の中で、削った大域だけを見て動く（io/modpack/kubejsScripts/runScripts.ts）。
// ここは、それでも処理系から外に抜けられたときのための2つ目の壁。ネットワーク・保存の関数と、文字列からコードを作る道を消す。

/** Worker の大域から消す名前 */
export const BLOCKED_WORKER_GLOBALS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'Worker',
  'SharedWorker',
  'navigator',
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
]

/** 名前を、scope とそのプロトタイプのすべてから消す。消せなければ undefined で上書きする */
function removeEverywhere(scope: object, name: string): void {
  for (let o: object | null = scope; o; o = Object.getPrototypeOf(o) as object | null) {
    if (!Object.hasOwn(o, name)) continue
    try {
      Reflect.deleteProperty(o, name)
    } catch {
      // 消せないものは下で上書きする
    }
    if (Object.hasOwn(o, name)) {
      try {
        Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false })
      } catch {
        // 上書きもできなければ残る（その名前は使えないものとして扱う）
      }
    }
  }
}

/**
 * 大域を削る。functionPrototypes は `constructor` を消す関数のプロトタイプ（`(() => 1).constructor` から `Function` に届かないように）。
 * テストではその場の物を壊さないように、作り物を渡す
 */
export function hardenWorkerScope(scope: object, functionPrototypes: readonly object[]): void {
  for (const name of BLOCKED_WORKER_GLOBALS) removeEverywhere(scope, name)
  for (const proto of functionPrototypes) {
    Object.defineProperty(proto, 'constructor', { value: undefined, writable: false, configurable: false })
  }
}

/** この実行環境の関数のプロトタイプ（普通・async・generator・async generator） */
export function realFunctionPrototypes(): object[] {
  return [
    Function.prototype,
    Object.getPrototypeOf(async function asyncFn() {}) as object,
    Object.getPrototypeOf(function* generatorFn() {}) as object,
    Object.getPrototypeOf(async function* asyncGeneratorFn() {}) as object,
  ]
}

// KubeJS のスクリプトを、JS で書いた JS の処理系（sval）で動かす（docs/design.md「KubeJS のスクリプトを動かす」）。
// sval の sandBox は、ホストの大域（fetch など）を写してくるので、安全のための仕切りにはならない。
// ここで大域を組み込みの一部だけに削り、大域の元（プロトタイプ）も知らない名前の受け皿に替えてから、作り物の KubeJS を足す。
// アプリでは Worker の中（workers/kubejsScripts.worker.ts）だけで呼ぶ。Worker は動かす前に自分の大域も削る。

import Sval from 'sval'
import { FakeKubeJs, NOOP } from './fakeKubeJs'
import { isSvalInternalName } from './svalNames'
import type { ScriptRunInput, ScriptRunOutput } from './scriptTypes'

/** スクリプトに見せる JavaScript の組み込み。`Function`・`eval`・`Proxy`・`Reflect` とホストの物（fetch など）は入れない */
const ALLOWED_BUILTINS = new Set([
  'Object',
  'Array',
  'Number',
  'Boolean',
  'String',
  'Symbol',
  'BigInt',
  'Date',
  'RegExp',
  'JSON',
  'Math',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'parseFloat',
  'parseInt',
  'isFinite',
  'isNaN',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Infinity',
  'NaN',
  'undefined',
])

/**
 * ホストの機能の名前。スクリプトが使っても、知らない名前の受け皿（下）に入れず、ReferenceError のままにする。
 * workers/kubejsScriptsHarden.ts の BLOCKED_WORKER_GLOBALS と同じ考え（io からは workers を読めないので並べ直す）
 */
const HOST_NAMES = new Set([
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
  'location',
  'eval',
  'Function',
  'Proxy',
  'Reflect',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'postMessage',
  'close',
  'process',
  'require',
  'module',
])

/** 知らない名前の受け皿が答える名前（ホストの機能と sval の隠れた名前を除く） */
function isUnknownGlobal(key: string | symbol): boolean {
  return typeof key === 'string' && !HOST_NAMES.has(key) && !isSvalInternalName(key)
}

/** sval の中の、大域の変数を探す部分（公開されていないが、大域を削るのに使う） */
interface SvalScope {
  find(name: string): { get(): unknown } | null
}

/** スクリプトの大域を削った sval を作る */
function createInterpreter(globals: Record<string, unknown>, unknownGlobal: (name: string) => unknown): Sval {
  const interpreter = new Sval({ ecmaVer: 'latest', sourceType: 'script', sandBox: true })
  const scope = (interpreter as unknown as { scope: SvalScope }).scope
  const g = scope.find('globalThis')?.get()
  if (typeof g !== 'object' || g === null) throw new Error('スクリプトの大域を用意できません')
  const target = g as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(target)) {
    if (!ALLOWED_BUILTINS.has(key)) delete target[key]
  }
  // プロトタイプはホストの大域を隠し持つので、知らない名前の受け皿に替える。
  // 受け皿は、ホストの機能の名前を除き、どの名前にも何もしない値を返す（NativeEvents など、ほかの Mod が足す大域でファイルが止まらないように）
  const fallback = new Proxy(Object.create(null) as Record<string, unknown>, {
    has: (_t, key) => isUnknownGlobal(key),
    get: (_t, key) => (isUnknownGlobal(key) ? unknownGlobal(key as string) : undefined),
    // 宣言しないで代入した大域（`x = 1`）は、受け皿ではなくスクリプトの大域に置く
    set: (_t, key, value, receiver: object) =>
      isUnknownGlobal(key) && Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }),
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
    getPrototypeOf: () => null,
  })
  Object.setPrototypeOf(target, fallback)
  // Object.assign は受け皿の set を通るので、直に置く
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  }
  return interpreter
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** スクリプトを動かしてレシピとタグを集める（docs/create-throughput.md「KubeJS のスクリプトのレシピ」） */
export function runKubeJsScripts(input: ScriptRunInput): ScriptRunOutput {
  const fake = new FakeKubeJs(input)
  const interpreter = createInterpreter(fake.globals(), (name) => {
    fake.note(`大域の ${name}`)
    return NOOP
  })
  for (const file of input.files) {
    fake.setCurrentPath(file.path)
    try {
      interpreter.run(file.text)
    } catch (e) {
      fake.errors.push({ path: file.path, message: message(e) })
    }
  }
  fake.fireEvents()
  return {
    recipes: [...fake.recipes.values()],
    itemTags: fake.itemTags,
    summary: {
      files: input.files.length,
      added: fake.added,
      removed: fake.removed,
      replaced: fake.replacedIds.size,
      unsupported: fake.unsupportedCalls(),
      errors: fake.errors,
      failed: null,
    },
  }
}

/** Worker を使わずに動かす ScriptRunner。テスト用（アプリでは Worker の実装を使う） */
export const inlineScriptRunner = async (input: ScriptRunInput): Promise<ScriptRunOutput> => runKubeJsScripts(input)

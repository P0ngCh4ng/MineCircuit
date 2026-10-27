// 計算の Worker の中身。Worker の外でもテストできるように、送り先（post）を受け取る形にしている。

import { fromSnapshot } from '../calc/blueprintSnapshot'
import type { CalcModpack } from '../calc/calcPlugin'
import type { RecipeBook } from '../io/modpack/recipes'
import { runPlugins, type PluginRegistry } from '../calc/pluginRegistry'
import type { FromCalcWorker, PackInfo, ToCalcWorker } from './calcProtocol'

export interface CalcWorkerHost {
  handle(message: ToCalcWorker): void
}

export function createCalcWorkerHost(registry: PluginRegistry, post: (message: FromCalcWorker) => void): CalcWorkerHost {
  let nextCallId = 1
  const pendingCalls = new Map<number, { resolve: (text: string | null) => void; reject: (e: Error) => void }>()
  const pendingLists = new Map<number, { resolve: (entries: string[]) => void; reject: (e: Error) => void }>()
  const pendingRecipes = new Map<number, { resolve: (book: RecipeBook) => void; reject: (e: Error) => void }>()

  /** Worker の中の Modpack の代理。設定ファイルは画面側に問い合わせる */
  function packProxy(info: PackInfo, requestId: number): CalcModpack {
    const namespaces = new Set(info.namespaces)
    return {
      // 設計図に出てくる namespace についてだけ答える。それ以外は false
      hasNamespace: (ns) => namespaces.has(ns),
      config: (path) =>
        new Promise<string | null>((resolve, reject) => {
          const callId = nextCallId++
          pendingCalls.set(callId, { resolve, reject })
          post({ type: 'config', requestId, callId, path })
        }),
      list: (path) =>
        new Promise<string[]>((resolve, reject) => {
          const callId = nextCallId++
          pendingLists.set(callId, { resolve, reject })
          post({ type: 'list', requestId, callId, path })
        }),
      recipeBook: () =>
        new Promise<RecipeBook>((resolve, reject) => {
          const callId = nextCallId++
          pendingRecipes.set(callId, { resolve, reject })
          post({ type: 'recipes', requestId, callId })
        }),
    }
  }

  // 計算は1つずつ順に行う
  let queue: Promise<void> = Promise.resolve()

  async function run(message: Extract<ToCalcWorker, { type: 'run' }>): Promise<void> {
    try {
      const bp = fromSnapshot(message.blueprint)
      const pack = message.pack ? packProxy(message.pack, message.requestId) : null
      const outcomes = await runPlugins(registry, bp, pack, message.ports)
      post({ type: 'result', requestId: message.requestId, outcomes })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      post({ type: 'failed', requestId: message.requestId, message: detail })
    }
  }

  return {
    handle(message) {
      switch (message.type) {
        case 'run':
          queue = queue.then(() => run(message))
          break
        case 'config-reply': {
          const call = pendingCalls.get(message.callId)
          if (!call) return
          pendingCalls.delete(message.callId)
          if (message.error !== undefined) call.reject(new Error(message.error))
          else call.resolve(message.text)
          break
        }
        case 'list-reply': {
          const call = pendingLists.get(message.callId)
          if (!call) return
          pendingLists.delete(message.callId)
          if (message.error !== undefined) call.reject(new Error(message.error))
          else call.resolve([...message.entries])
          break
        }
        case 'recipes-reply': {
          const call = pendingRecipes.get(message.callId)
          if (!call) return
          pendingRecipes.delete(message.callId)
          if (message.error !== undefined) call.reject(new Error(message.error))
          else call.resolve(message.book)
          break
        }
      }
    },
  }
}

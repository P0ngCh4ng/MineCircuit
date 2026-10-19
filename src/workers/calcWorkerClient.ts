// 画面側から計算の Worker を使う。CalcBackend の形にして CalcScheduler に渡す。

import { toSnapshot } from '../calc/blueprintSnapshot'
import type { CalcModpack } from '../calc/calcPlugin'
import type { CalcBackend, CalcRequest } from '../calc/calcScheduler'
import type { PluginOutcome } from '../calc/pluginRegistry'
import type { FromCalcWorker, PackInfo, ToCalcWorker } from './calcProtocol'

/** Worker の、ここで使う部分だけ。テストでは Worker の代わりを渡す */
export interface CalcWorkerPort {
  postMessage(message: ToCalcWorker): void
  addEventListener(type: 'message', listener: (e: MessageEvent<FromCalcWorker>) => void): void
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void
  terminate?(): void
}

export class WorkerCalcBackend implements CalcBackend {
  private nextRequestId = 1
  private readonly pending = new Map<
    number,
    { resolve: (o: PluginOutcome[]) => void; reject: (e: Error) => void; pack: CalcModpack | null }
  >()

  constructor(private readonly port: CalcWorkerPort) {
    port.addEventListener('message', (e: MessageEvent<FromCalcWorker>) => this.receive(e.data))
    port.addEventListener('error', (e: ErrorEvent) => {
      const error = new Error(e.message || 'Worker が止まりました')
      for (const p of this.pending.values()) p.reject(error)
      this.pending.clear()
    })
  }

  run(request: CalcRequest): Promise<PluginOutcome[]> {
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, pack: request.pack })
      this.port.postMessage({
        type: 'run',
        requestId,
        blueprint: toSnapshot(request.blueprint),
        ports: request.ports.map((p) => ({ ...p, pos: [p.pos[0], p.pos[1], p.pos[2]], params: { ...p.params } })),
        pack: request.pack ? packInfo(request) : null,
      })
    })
  }

  dispose(): void {
    this.port.terminate?.()
    const error = new Error('計算を止めました')
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }

  private receive(message: FromCalcWorker): void {
    switch (message.type) {
      case 'result':
      case 'failed': {
        const p = this.pending.get(message.requestId)
        if (!p) return
        this.pending.delete(message.requestId)
        if (message.type === 'result') p.resolve(message.outcomes)
        else p.reject(new Error(message.message))
        break
      }
      case 'config':
        void this.answerConfig(message.requestId, message.callId, message.path)
        break
    }
  }

  private async answerConfig(requestId: number, callId: number, path: string): Promise<void> {
    const pack = this.pending.get(requestId)?.pack ?? null
    try {
      const text = pack ? await pack.config(path) : null
      this.port.postMessage({ type: 'config-reply', callId, text })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.port.postMessage({ type: 'config-reply', callId, text: null, error })
    }
  }
}

function packInfo(request: CalcRequest): PackInfo {
  const pack = request.pack
  const namespaces = pack ? [...request.blueprint.namespaces].filter((ns) => pack.hasNamespace(ns)) : []
  return { namespaces }
}

/** 計算の Worker を作る。Worker が使えない環境（テストなど）では null */
export function createCalcWorkerBackend(): WorkerCalcBackend | null {
  if (typeof Worker === 'undefined') return null
  const worker = new Worker(new URL('./calcWorker.ts', import.meta.url), { type: 'module' })
  return new WorkerCalcBackend(worker)
}

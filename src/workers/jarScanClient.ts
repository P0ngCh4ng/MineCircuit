// jar を Worker で開く JarScanner を作る。Worker が使えなければ null（呼ぶ側がその場で開く）。

import type { JarContent, JarSummary } from '../io/modpack/jarScanner'
import { extractedZipTransfer } from '../io/modpack/partialZip'
import type { JarScanner } from '../io/modpack/modpackLoader'
import type { JarScanRequest, JarScanResponse } from './jarScanProtocol'

export interface WorkerJarScanner {
  readonly scan: JarScanner
  /** Worker を止める。待っている読み込みはエラーになる */
  dispose(): void
}

export function createWorkerJarScanner(): WorkerJarScanner | null {
  if (typeof Worker === 'undefined') return null
  const worker = new Worker(new URL('./jarScan.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { resolve: (s: JarSummary) => void; reject: (e: Error) => void }>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<JarScanResponse>) => {
    const res = event.data
    const p = pending.get(res.id)
    if (!p) return
    pending.delete(res.id)
    if (res.ok) p.resolve(res.summary)
    else p.reject(new Error(res.message))
  }
  worker.onerror = (event) => {
    const error = new Error(`jar を読む処理が止まりました（${event.message}）`)
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  return {
    scan(jar, content) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        const request: JarScanRequest = { id, jar, content }
        // バイト列は Worker へ移す（コピーしない）
        worker.postMessage(request, jarContentTransfer(content))
      })
    },
    dispose() {
      worker.terminate()
      const error = new Error('jar を読む処理を止めました')
      for (const p of pending.values()) p.reject(error)
      pending.clear()
    },
  }
}

/** Worker へ移すバッファ */
export function jarContentTransfer(content: JarContent): ArrayBuffer[] {
  if (content.kind === 'entries') return extractedZipTransfer(content.zip)
  return content.bytes.buffer instanceof ArrayBuffer ? [content.bytes.buffer] : []
}

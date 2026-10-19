// jar を開いて読む Worker。zip の展開と JSON の解釈で画面が止まらないよう、ここで行う。

import { scanJar } from '../io/modpack/jarScanner'
import type { JarScanRequest, JarScanResponse } from './jarScanProtocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<JarScanRequest>) => void) | null
  postMessage(message: JarScanResponse): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const { id, jar, bytes } = event.data
  try {
    scope.postMessage({ id, ok: true, summary: scanJar(jar, bytes) })
  } catch (e) {
    scope.postMessage({ id, ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

// 見た目の Web Worker の入口（設計のルール 7：重い処理は Worker で行う）。
// モデルの解決・PNG の展開・アトラス作りをここで行う。ファイルは画面側に読んでもらう（appearanceProtocol.ts）。
// 画面側は appearanceWorkerClient.ts の createAppearanceProvider() で使う。

import type { FromAppearanceWorker, ToAppearanceWorker } from './appearanceProtocol'
import { createAppearanceWorkerHost } from './appearanceWorkerHost'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToAppearanceWorker>) => void) | null
  postMessage(message: FromAppearanceWorker, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const host = createAppearanceWorkerHost((message, transfer) => scope.postMessage(message, transfer))

scope.onmessage = (event) => host.handle(event.data)

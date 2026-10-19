// 計算の Web Worker の入口（設計のルール 7：重い処理は Worker で行う）。
// 画面側は calcWorkerClient.ts の createCalcWorkerBackend() で使う。

import { createBuiltinRegistry } from '../calc/builtinPlugins'
import type { FromCalcWorker, ToCalcWorker } from './calcProtocol'
import { createCalcWorkerHost } from './calcWorkerHost'

const host = createCalcWorkerHost(createBuiltinRegistry(), (message: FromCalcWorker) => self.postMessage(message))

self.addEventListener('message', (e: MessageEvent<ToCalcWorker>) => host.handle(e.data))

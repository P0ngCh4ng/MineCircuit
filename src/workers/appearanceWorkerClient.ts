// 画面側から見た目の Worker を使う。AppearanceProvider の形にして appearanceStore に渡す。
// 資産のファイルは画面側の AssetReader（Modpack.assets()）で読み、Worker の 'read' に答える。
// デスクトップ版（Tauri）のファイルの API は Worker から呼べないので、読むのはこちら側に置く。
// jar の項目の展開（inflate）もこちらで行うが、1つのファイルは小さい（JSON や 16×16 の PNG）ので画面は止まらない。

import type { AppearanceSet } from '../domain/blockModel'
import type { BlockState } from '../domain/blockState'
import { AssetAppearanceProvider, CachedAppearanceProvider, uniqueProblems } from '../io/assets/assetAppearanceProvider'
import type { AppearanceProvider, AssetReader } from '../io/assets/assetTypes'
import type { FromAppearanceWorker, ToAppearanceWorker } from './appearanceProtocol'

/** Worker の、ここで使う部分だけ。テストでは Worker の代わりを渡す */
export interface AppearanceWorkerPort {
  postMessage(message: ToAppearanceWorker, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent<FromAppearanceWorker>) => void): void
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void
  terminate?(): void
}

/** 使い終わったら止められる AppearanceProvider */
export interface DisposableAppearanceProvider extends AppearanceProvider {
  /** Worker を止める。待っている prepare はエラーになる */
  dispose(): void
}

export class WorkerAppearanceProvider implements DisposableAppearanceProvider {
  private nextRequestId = 1
  private readonly pending = new Map<number, { resolve: (s: AppearanceSet) => void; reject: (e: Error) => void }>()
  private disposed = false

  constructor(
    private readonly port: AppearanceWorkerPort,
    private readonly reader: AssetReader,
  ) {
    port.addEventListener('message', (e: MessageEvent<FromAppearanceWorker>) => this.receive(e.data))
    port.addEventListener('error', (e: ErrorEvent) => this.failAll(new Error(e.message || '見た目を用意する処理が止まりました')))
  }

  prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    if (this.disposed) return Promise.reject(new Error('見た目を用意する処理を止めました'))
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.port.postMessage(
        {
          type: 'prepare',
          requestId,
          states: states.map((s) => ({ id: s.id.toString(), properties: { ...s.properties } })),
        },
        [],
      )
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.port.terminate?.()
    this.failAll(new Error('見た目を用意する処理を止めました'))
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }

  private receive(message: FromAppearanceWorker): void {
    switch (message.type) {
      case 'result':
      case 'failed': {
        const p = this.pending.get(message.requestId)
        if (!p) return
        this.pending.delete(message.requestId)
        if (message.type === 'failed') {
          p.reject(new Error(message.message))
          return
        }
        // 読めなかった jar やファイルは画面側の reader が知っている
        const set = message.set
        p.resolve({ ...set, problems: uniqueProblems(set.problems, this.reader.problems ?? []) })
        break
      }
      case 'read':
        // 同じ時に読み始めると、ModpackAssetReader が同じ jar の項目をまとめて読む
        for (const call of message.calls) void this.answerRead(call.callId, call.path)
        break
    }
  }

  private async answerRead(callId: number, path: string): Promise<void> {
    let reply: ToAppearanceWorker
    let transfer: Transferable[] = []
    try {
      const read = await this.reader.readBytes(path)
      // 写してから移す（reader が同じバイト列を覚えていても、使えなくならないように。1つのファイルは小さい）
      const bytes = read ? new Uint8Array(read) : null
      reply = { type: 'read-reply', callId, bytes }
      if (bytes) transfer = [bytes.buffer]
    } catch (e) {
      reply = { type: 'read-reply', callId, bytes: null, error: e instanceof Error ? e.message : String(e) }
    }
    if (!this.disposed) this.port.postMessage(reply, transfer)
  }
}

/** Worker を使わずに同じスレッドで用意する provider（Worker が使えない環境、テスト） */
export class InlineAppearanceProvider implements DisposableAppearanceProvider {
  private readonly inner: AssetAppearanceProvider

  constructor(reader: AssetReader) {
    this.inner = new AssetAppearanceProvider(reader)
  }

  prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    return this.inner.prepare(states)
  }

  dispose(): void {}
}

/** 覚えておく層（CachedAppearanceProvider）をかぶせる */
class CachedDisposable implements DisposableAppearanceProvider {
  private readonly cached: CachedAppearanceProvider

  constructor(private readonly inner: DisposableAppearanceProvider) {
    this.cached = new CachedAppearanceProvider(inner)
  }

  prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    return this.cached.prepare(states)
  }

  dispose(): void {
    this.inner.dispose()
  }
}

/**
 * Modpack の資産から見た目を用意する provider を作る（Modpack 1つにつき1つ）。
 * Worker が使えれば Worker で、使えなければ同じスレッドで用意する。
 * 用意した見た目は覚えておき、知らないブロック状態が来たときだけ作り直す
 */
export function createAppearanceProvider(reader: AssetReader): DisposableAppearanceProvider {
  let backend: DisposableAppearanceProvider
  if (typeof Worker === 'undefined') {
    backend = new InlineAppearanceProvider(reader)
  } else {
    const worker = new Worker(new URL('./appearance.worker.ts', import.meta.url), { type: 'module' })
    backend = new WorkerAppearanceProvider(worker, reader)
  }
  return new CachedDisposable(backend)
}

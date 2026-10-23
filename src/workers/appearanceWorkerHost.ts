// 見た目の Worker の中身。Worker の外でもテストできるように、送り先（post）を受け取る形にしている。
// Worker 1つが Modpack 1つ分を受け持つ（Modpack が変わったら画面側が Worker ごと作り直す）。

import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import { AssetAppearanceProvider } from '../io/assets/assetAppearanceProvider'
import type { AssetReader } from '../io/assets/assetTypes'
import type { TextureAtlasOptions } from '../io/assets/textureAtlas'
import type { FromAppearanceWorker, ToAppearanceWorker } from './appearanceProtocol'

export type AppearancePost = (message: FromAppearanceWorker, transfer: Transferable[]) => void

export interface AppearanceWorkerHost {
  handle(message: ToAppearanceWorker): void
}

const decoder = new TextDecoder('utf-8')

/** 画面側へ問い合わせて読む AssetReader。読めなかったものは problems に書いて null を返す */
class RemoteAssetReader implements AssetReader {
  readonly problems: string[] = []
  private nextCallId = 1
  private readonly pending = new Map<number, { path: string; resolve: (b: Uint8Array | null) => void }>()
  private queue: { callId: number; path: string }[] = []

  constructor(private readonly post: AppearancePost) {}

  readBytes(path: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const callId = this.nextCallId++
      this.pending.set(callId, { path, resolve })
      this.queue.push({ callId, path })
      if (this.queue.length === 1) queueMicrotask(() => this.flush())
    })
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path)
    return bytes === null ? null : decoder.decode(bytes)
  }

  reply(message: Extract<ToAppearanceWorker, { type: 'read-reply' }>): void {
    const call = this.pending.get(message.callId)
    if (!call) return
    this.pending.delete(message.callId)
    if (message.error !== undefined) {
      const problem = `${call.path} を読めませんでした（${message.error}）`
      if (!this.problems.includes(problem)) this.problems.push(problem)
      call.resolve(null)
    } else {
      call.resolve(message.bytes)
    }
  }

  private flush(): void {
    const calls = this.queue
    this.queue = []
    this.post({ type: 'read', calls }, [])
  }
}

export function createAppearanceWorkerHost(post: AppearancePost, options: TextureAtlasOptions = {}): AppearanceWorkerHost {
  const reader = new RemoteAssetReader(post)
  const provider = new AssetAppearanceProvider(reader, options)

  async function prepare(message: Extract<ToAppearanceWorker, { type: 'prepare' }>): Promise<void> {
    try {
      const states = message.states.map((s) => new BlockState(ResourceLocation.parse(s.id), s.properties))
      const set = await provider.prepare(states)
      post({ type: 'result', requestId: message.requestId, set }, [set.atlas.pixels.buffer as ArrayBuffer])
    } catch (e) {
      post({ type: 'failed', requestId: message.requestId, message: e instanceof Error ? e.message : String(e) }, [])
    }
  }

  return {
    handle(message) {
      switch (message.type) {
        case 'prepare':
          void prepare(message)
          break
        case 'read-reply':
          reader.reply(message)
          break
      }
    },
  }
}

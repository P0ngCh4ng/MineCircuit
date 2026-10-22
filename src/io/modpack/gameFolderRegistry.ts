// 利用者が選んだ「ゲームのフォルダ」（Minecraft 本体の jar と資産の索引があるランチャーのフォルダ）の一覧
// （docs/design.md「Minecraft 本体の資産」）。
// 本体の jar は Modpack のフォルダの外にあることが多い（CurseForge の Install、Prism のランチャーのフォルダなど）ので、
// 一度選んでもらい、Modpack の登録と同じ方法（ブラウザ版はフォルダのハンドル、デスクトップ版はパス）で保存する。
// 1つのフォルダを、同じランチャーのすべての Modpack で使う。

import type { FileSource } from '../fileSource'
import type { ModpackHandleOpener, ModpackRegistryOptions, ModpackStore, OpenResult } from './modpackRegistry'
import { looksLikeGameFolder } from './vanillaAssets'

/** 選んだゲームのフォルダ1つ分 */
export interface GameFolderEntry {
  readonly id: string
  /** フォルダの名前 */
  readonly name: string
  readonly addedAt: number
  /** 次回も読めるか。false なら、ページを閉じると消える */
  readonly persistent: boolean
}

export type AddGameFolderResult =
  | { kind: 'added'; entry: GameFolderEntry }
  /** versions/・libraries/・assets/ も jar もない */
  | { kind: 'invalid' }

export class GameFolderRegistry<H> {
  private readonly store: ModpackStore<H> | null
  private readonly opener: ModpackHandleOpener<H>
  private readonly newId: () => string
  private readonly now: () => number
  private readonly session = new Map<string, { entry: GameFolderEntry; source: FileSource }>()

  /** store が null なら、ページを開いている間だけ覚える */
  constructor(store: ModpackStore<H> | null, opener: ModpackHandleOpener<H>, options: ModpackRegistryOptions = {}) {
    this.store = store
    this.opener = opener
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => Date.now())
  }

  /** 選んだフォルダの一覧（選んだ順） */
  async list(): Promise<GameFolderEntry[]> {
    const stored = this.store ? await this.store.list() : []
    const entries: GameFolderEntry[] = [
      ...stored.map((s) => ({ id: s.id, name: s.name, addedAt: s.addedAt, persistent: true })),
      ...[...this.session.values()].map((s) => s.entry),
    ]
    return entries.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
  }

  /** フォルダを足す。ゲームのフォルダらしくなければ足さない。handle と保存先があれば保存する */
  async add(name: string, source: FileSource, handle: H | null): Promise<AddGameFolderResult> {
    if (!(await looksLikeGameFolder(source))) return { kind: 'invalid' }
    const id = this.newId()
    const addedAt = this.now()
    if (handle !== null && this.store) {
      await this.store.put({ id, name, addedAt, handle })
      return { kind: 'added', entry: { id, name, addedAt, persistent: true } }
    }
    const entry: GameFolderEntry = { id, name, addedAt, persistent: false }
    this.session.set(id, { entry, source })
    return { kind: 'added', entry }
  }

  /** 一覧から外す。フォルダの中身には触らない */
  async remove(id: string): Promise<void> {
    if (this.session.delete(id)) return
    await this.store?.remove(id)
  }

  /** フォルダを開く。足したばかりのものは、足したときの source を返す */
  async open(id: string, requestPermission: boolean): Promise<OpenResult> {
    const inSession = this.session.get(id)
    if (inSession) return { kind: 'opened', source: inSession.source }
    const stored = this.store ? (await this.store.list()).find((s) => s.id === id) : undefined
    if (!stored) return { kind: 'not-registered' }
    const source = await this.opener.open(stored.handle, requestPermission)
    return source ? { kind: 'opened', source } : { kind: 'needs-permission' }
  }
}

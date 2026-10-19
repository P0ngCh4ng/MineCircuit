// 登録した Modpack のフォルダの一覧。
// フォルダのハンドル（H）を保存できるブラウザ（Chrome / Edge）では保存し、次回も同じフォルダを読む。
// 保存できないとき（Firefox / Safari）は、ページを開いている間だけ覚える。
// ハンドルの型を型引数にして、テストでは本物のハンドルなしで動かせるようにしている。

import type { FileSource } from '../fileSource'
import { checkModpackFolder, type ModpackFolderCheck } from './modpackFolder'

/** 登録した Modpack 1つ分。画面の一覧に出す情報 */
export interface ModpackEntry {
  readonly id: string
  /** フォルダの名前（CurseForge ならプロファイル名） */
  readonly name: string
  /** 登録した時刻（ミリ秒） */
  readonly addedAt: number
  /** 次回も読めるか。false なら、ページを閉じると登録が消える */
  readonly persistent: boolean
}

/** 保存する1件分 */
export interface StoredModpack<H> {
  readonly id: string
  readonly name: string
  readonly addedAt: number
  readonly handle: H
}

/** 登録の保存先。ブラウザでは IndexedDB（indexedDbModpackStore.ts） */
export interface ModpackStore<H> {
  list(): Promise<StoredModpack<H>[]>
  put(item: StoredModpack<H>): Promise<void>
  remove(id: string): Promise<void>
}

/** 保存したハンドルからフォルダを開く方法 */
export interface ModpackHandleOpener<H> {
  /**
   * 読む許可を確かめて FileSource を返す。許可がなければ null。
   * requestPermission が true なら、利用者に許可を求めてよい。
   */
  open(handle: H, requestPermission: boolean): Promise<FileSource | null>
}

export type RegisterResult =
  | { kind: 'registered'; entry: ModpackEntry; source: FileSource; jarCount: number }
  | { kind: 'invalid'; check: Exclude<ModpackFolderCheck, { kind: 'ok' }> }

export type OpenResult =
  | { kind: 'opened'; source: FileSource }
  /** 前回の許可が切れている。ボタンなど利用者の操作の中で、requestPermission を true にして開き直す */
  | { kind: 'needs-permission' }
  | { kind: 'not-registered' }

export interface ModpackRegistryOptions {
  newId?: () => string
  now?: () => number
}

interface SessionModpack {
  entry: ModpackEntry
  source: FileSource
}

export class ModpackRegistry<H> {
  private readonly store: ModpackStore<H> | null
  private readonly opener: ModpackHandleOpener<H>
  private readonly newId: () => string
  private readonly now: () => number
  private readonly session = new Map<string, SessionModpack>()

  /** store が null なら、どの登録もページを開いている間だけになる */
  constructor(store: ModpackStore<H> | null, opener: ModpackHandleOpener<H>, options: ModpackRegistryOptions = {}) {
    this.store = store
    this.opener = opener
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => Date.now())
  }

  /** 登録した Modpack の一覧（登録した順） */
  async list(): Promise<ModpackEntry[]> {
    const stored = this.store ? await this.store.list() : []
    const entries: ModpackEntry[] = [
      ...stored.map((s) => ({ id: s.id, name: s.name, addedAt: s.addedAt, persistent: true })),
      ...[...this.session.values()].map((s) => s.entry),
    ]
    return entries.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
  }

  /**
   * フォルダを登録する。`mods/` がなければ登録しない。
   * handle を渡し、保存先があれば保存する（次回も読める）。それ以外はページを開いている間だけ。
   */
  async register(name: string, source: FileSource, handle: H | null): Promise<RegisterResult> {
    const check = await checkModpackFolder(source)
    if (check.kind !== 'ok') return { kind: 'invalid', check }

    const id = this.newId()
    const addedAt = this.now()
    if (handle !== null && this.store) {
      await this.store.put({ id, name, addedAt, handle })
      return { kind: 'registered', entry: { id, name, addedAt, persistent: true }, source, jarCount: check.jarCount }
    }
    const entry: ModpackEntry = { id, name, addedAt, persistent: false }
    this.session.set(id, { entry, source })
    return { kind: 'registered', entry, source, jarCount: check.jarCount }
  }

  /** 登録を外す。フォルダの中身には触らない */
  async remove(id: string): Promise<void> {
    if (this.session.delete(id)) return
    await this.store?.remove(id)
  }

  /** 登録した Modpack のフォルダを開く */
  async open(id: string, requestPermission: boolean): Promise<OpenResult> {
    const inSession = this.session.get(id)
    if (inSession) return { kind: 'opened', source: inSession.source }
    const stored = this.store ? (await this.store.list()).find((s) => s.id === id) : undefined
    if (!stored) return { kind: 'not-registered' }
    const source = await this.opener.open(stored.handle, requestPermission)
    return source ? { kind: 'opened', source } : { kind: 'needs-permission' }
  }
}

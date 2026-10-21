// 登録した Modpack を IndexedDB に保存する（ModpackStore の実装）。
// 保存するのは、フォルダを開き直すための値（H。ブラウザ版はフォルダのハンドル、デスクトップ版はフォルダのパス）と名前だけ。
// ファイルの中身は保存しない。外部にも送らない。

import type { ModpackStore, StoredModpack } from './modpackRegistry'

/** ブラウザ版の保存先の名前 */
export const BROWSER_MODPACK_DB = 'minecircuit-modpacks'
const DB_VERSION = 1
const STORE_NAME = 'modpacks'

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 登録した Modpack を IndexedDB に保存する。H は structured clone で保存できる値にする
 * （FileSystemDirectoryHandle や文字列）。dbName で、ハンドルの種類ごとに保存先を分ける
 */
export class IndexedDbModpackStore<H> implements ModpackStore<H> {
  private db: Promise<IDBDatabase> | null = null
  private readonly dbName: string

  constructor(dbName: string = BROWSER_MODPACK_DB) {
    this.dbName = dbName
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.db
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    const tx = db.transaction(STORE_NAME, mode)
    const result = requestToPromise(run(tx.objectStore(STORE_NAME)))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return result
  }

  async list(): Promise<StoredModpack<H>[]> {
    return this.transaction('readonly', (s) => s.getAll() as IDBRequest<StoredModpack<H>[]>)
  }

  async put(item: StoredModpack<H>): Promise<void> {
    await this.transaction('readwrite', (s) => s.put(item))
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (s) => s.delete(id))
  }
}

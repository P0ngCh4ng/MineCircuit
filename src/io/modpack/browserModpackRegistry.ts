// ブラウザで使う ModpackRegistry を作る。
// フォルダのハンドルは IndexedDB に保存する（ハンドルは IndexedDB にそのまま入れられる）。
// 保存するのはハンドルと名前だけで、ファイルの中身は保存しない。外部にも送らない。

import { BrowserFileSource, ensureReadPermission, supportsDirectoryPicker } from '../browserFileSource'
import { ModpackRegistry, type ModpackStore, type StoredModpack } from './modpackRegistry'

const DB_NAME = 'minecircuit-modpacks'
const DB_VERSION = 1
const STORE_NAME = 'modpacks'

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 登録した Modpack のフォルダのハンドルを IndexedDB に保存する */
export class IndexedDbModpackStore implements ModpackStore<FileSystemDirectoryHandle> {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
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

  async list(): Promise<StoredModpack<FileSystemDirectoryHandle>[]> {
    return this.transaction('readonly', (s) => s.getAll() as IDBRequest<StoredModpack<FileSystemDirectoryHandle>[]>)
  }

  async put(item: StoredModpack<FileSystemDirectoryHandle>): Promise<void> {
    await this.transaction('readwrite', (s) => s.put(item))
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (s) => s.delete(id))
  }
}

/** ブラウザ用の登録一覧。ハンドルを保存できるのは、フォルダを選ぶ画面と IndexedDB の両方があるときだけ */
export function createBrowserModpackRegistry(): ModpackRegistry<FileSystemDirectoryHandle> {
  const canPersist = supportsDirectoryPicker() && typeof indexedDB !== 'undefined'
  return new ModpackRegistry(canPersist ? new IndexedDbModpackStore() : null, {
    async open(handle, requestPermission) {
      return (await ensureReadPermission(handle, requestPermission)) ? new BrowserFileSource(handle) : null
    },
  })
}

// jar ごとの読んだ結果を IndexedDB に保存する（2回目からの読み込みを速くする）。
// 保存するのは Mod の情報・表示名・ブロック状態の定義だけで、jar そのものは保存しない。外部にも送らない。

import type { JarSummary } from './jarScanner'
import type { JarCache } from './modpackLoader'

const DB_NAME = 'minecircuit-jar-cache'
const DB_VERSION = 1
const STORE_NAME = 'jars'

interface StoredJar {
  readonly key: string
  readonly summary: JarSummary
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * 鍵（`v1|<jar>|<大きさ>|<更新時刻など>`）から、同じ jar の古い結果を見つけるための前半（`v1|<jar>|`）を取り出す
 */
export function jarKeyPrefix(key: string): string {
  const last = key.lastIndexOf('|')
  const second = key.lastIndexOf('|', last - 1)
  return second < 0 ? key : key.slice(0, second + 1)
}

export class IndexedDbJarCache implements JarCache {
  private db: Promise<IDBDatabase> | null = null

  /** IndexedDB が使えるか（Worker の中でも使える） */
  static supported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.db
  }

  async get(key: string): Promise<JarSummary | null> {
    const db = await this.open()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const found = (await requestToPromise(tx.objectStore(STORE_NAME).get(key))) as StoredJar | undefined
    return found?.summary ?? null
  }

  /** 保存する。同じ名前の jar の古い結果（更新前の jar）は消す */
  async put(key: string, summary: JarSummary): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const prefix = jarKeyPrefix(key)
    store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))
    const item: StoredJar = { key, summary }
    store.put(item)
    await transactionDone(tx)
  }
}

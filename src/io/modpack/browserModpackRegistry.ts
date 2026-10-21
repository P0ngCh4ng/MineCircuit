// ブラウザで使う ModpackRegistry を作る。
// フォルダのハンドルは IndexedDB に保存する（ハンドルは IndexedDB にそのまま入れられる）。
// 保存するのはハンドルと名前だけで、ファイルの中身は保存しない。外部にも送らない。

import { BrowserFileSource, ensureReadPermission, supportsDirectoryPicker } from '../browserFileSource'
import { IndexedDbModpackStore } from './indexedDbModpackStore'
import { ModpackRegistry } from './modpackRegistry'

/** ブラウザ用の登録一覧。ハンドルを保存できるのは、フォルダを選ぶ画面と IndexedDB の両方があるときだけ */
export function createBrowserModpackRegistry(): ModpackRegistry<FileSystemDirectoryHandle> {
  const canPersist = supportsDirectoryPicker() && typeof indexedDB !== 'undefined'
  return new ModpackRegistry(canPersist ? new IndexedDbModpackStore<FileSystemDirectoryHandle>() : null, {
    async open(handle, requestPermission) {
      return (await ensureReadPermission(handle, requestPermission)) ? new BrowserFileSource(handle) : null
    },
  })
}

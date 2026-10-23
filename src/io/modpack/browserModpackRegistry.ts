// ブラウザで使う ModpackRegistry を作る。
// フォルダのハンドルは IndexedDB に保存する（ハンドルは IndexedDB にそのまま入れられる）。
// 保存するのはハンドルと名前だけで、ファイルの中身は保存しない。外部にも送らない。

import { BrowserFileSource, ensureReadPermission, supportsDirectoryPicker } from '../browserFileSource'
import { GameFolderRegistry } from './gameFolderRegistry'
import { IndexedDbModpackStore } from './indexedDbModpackStore'
import { ModpackRegistry, type ModpackHandleOpener } from './modpackRegistry'

/** ブラウザ版のゲームのフォルダ（Minecraft 本体の jar があるフォルダ）の保存先の名前 */
export const BROWSER_GAME_FOLDER_DB = 'minecircuit-game-folders'

const browserOpener: ModpackHandleOpener<FileSystemDirectoryHandle> = {
  async open(handle, requestPermission) {
    return (await ensureReadPermission(handle, requestPermission)) ? new BrowserFileSource(handle) : null
  },
}

function canPersist(): boolean {
  return supportsDirectoryPicker() && typeof indexedDB !== 'undefined'
}

/** ブラウザ用の登録一覧。ハンドルを保存できるのは、フォルダを選ぶ画面と IndexedDB の両方があるときだけ */
export function createBrowserModpackRegistry(): ModpackRegistry<FileSystemDirectoryHandle> {
  return new ModpackRegistry(canPersist() ? new IndexedDbModpackStore<FileSystemDirectoryHandle>() : null, browserOpener)
}

/** ブラウザ用のゲームのフォルダの一覧。Modpack の登録と同じく、ハンドルを IndexedDB に保存する */
export function createBrowserGameFolderRegistry(): GameFolderRegistry<FileSystemDirectoryHandle> {
  return new GameFolderRegistry(
    canPersist() ? new IndexedDbModpackStore<FileSystemDirectoryHandle>(BROWSER_GAME_FOLDER_DB) : null,
    browserOpener,
  )
}

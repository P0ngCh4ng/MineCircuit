// デスクトップ版（Tauri）の Modpack の登録（docs/design.md「デスクトップ版（Tauri）」）。
// ModpackRegistry のハンドルをフォルダのパス（string）にして、IndexedDB に保存する。
// フォルダを読む許可の範囲は、ダイアログで選んだときに Tauri が足し、persisted-scope が次回も残す。
// そのため次回は、利用者に何も聞かずに読める。範囲が消えていたら、同じフォルダを選び直してもらう。

import { open } from '@tauri-apps/plugin-dialog'
import { FileNotFoundError, type FileSource } from '../fileSource'
import { IndexedDbModpackStore } from '../modpack/indexedDbModpackStore'
import { GameFolderRegistry } from '../modpack/gameFolderRegistry'
import { ModpackRegistry, type ModpackHandleOpener, type ModpackStore } from '../modpack/modpackRegistry'
import { baseName, TauriFileSource, TauriForbiddenError } from './tauriFileSource'

/** デスクトップ版の保存先の名前。ブラウザ版（ハンドルを保存する）と分ける */
export const DESKTOP_MODPACK_DB = 'minecircuit-modpacks-desktop'

/** デスクトップ版のゲームのフォルダ（Minecraft 本体の jar があるフォルダ）の保存先の名前 */
export const DESKTOP_GAME_FOLDER_DB = 'minecircuit-game-folders-desktop'

const MODPACK_PICK_TITLE = 'Modpack のフォルダを選ぶ'
const GAME_FOLDER_PICK_TITLE = 'Minecraft 本体のフォルダを選ぶ'

/** 選んだ Modpack のフォルダ */
export interface PickedTauriFolder {
  /** フォルダの名前（CurseForge ならプロファイル名） */
  readonly name: string
  /** フォルダの絶対パス。登録の保存に使う */
  readonly path: string
  readonly source: TauriFileSource
}

/**
 * Modpack のフォルダを選ぶ画面を出す。取り消したら null。
 * recursive: true で、選んだフォルダの中まで読めるようにする（persisted-scope が次回も残す）
 */
export async function pickTauriFolder(
  defaultPath?: string,
  title: string = MODPACK_PICK_TITLE,
): Promise<PickedTauriFolder | null> {
  const path = await open({
    title,
    directory: true,
    multiple: false,
    recursive: true,
    defaultPath,
  })
  if (path === null) return null
  return { name: baseName(path), path, source: new TauriFileSource(path) }
}

/** 同じフォルダか。区切りと末尾の区切り、大文字小文字（Windows）の違いは無視する */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/[/]$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** 保存したパスからフォルダを開く。範囲が消えていたら、title の画面で同じフォルダを選び直してもらう */
function tauriOpener(title: string): ModpackHandleOpener<string> {
  return {
    async open(path, requestPermission): Promise<FileSource | null> {
      const source = new TauriFileSource(path)
      try {
        // 読めるか確かめる（範囲の外なら TauriForbiddenError）
        await source.list('')
        return source
      } catch (e) {
        if (e instanceof FileNotFoundError) throw new FileNotFoundError(path)
        if (!(e instanceof TauriForbiddenError)) throw e
      }
      if (!requestPermission) return null
      // 範囲が消えていた。同じフォルダを選び直してもらい、範囲を足し直す
      const picked = await pickTauriFolder(path, title)
      return picked && samePath(picked.path, path) ? picked.source : null
    },
  }
}

/** 保存したパスから Modpack のフォルダを開く */
export const tauriHandleOpener: ModpackHandleOpener<string> = tauriOpener(MODPACK_PICK_TITLE)

/** Minecraft 本体のフォルダ（ゲームのフォルダ）を選ぶ画面を出す。取り消したら null */
export function pickTauriGameFolder(): Promise<PickedTauriFolder | null> {
  return pickTauriFolder(undefined, GAME_FOLDER_PICK_TITLE)
}

/** デスクトップ版のゲームのフォルダの一覧。store を省略すると IndexedDB に保存する */
export function createTauriGameFolderRegistry(store?: ModpackStore<string>): GameFolderRegistry<string> {
  return new GameFolderRegistry(
    store ?? new IndexedDbModpackStore<string>(DESKTOP_GAME_FOLDER_DB),
    tauriOpener(GAME_FOLDER_PICK_TITLE),
  )
}

/** デスクトップ版の登録一覧。store を省略すると IndexedDB に保存する */
export function createTauriModpackRegistry(store?: ModpackStore<string>): ModpackRegistry<string> {
  return new ModpackRegistry(store ?? new IndexedDbModpackStore<string>(DESKTOP_MODPACK_DB), tauriHandleOpener)
}

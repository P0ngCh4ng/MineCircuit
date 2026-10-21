// ブラウザ版とデスクトップ版（Tauri）で、ファイルの読み書きの実装を選ぶ（docs/design.md「デスクトップ版（Tauri）」）。
// どちらで動いているかで実装を選ぶのは、ここ（view/platform/）だけ。画面の部品はここの関数を使う。
// デスクトップ版の実装（io/tauri/）は動的 import で読み、ブラウザでは読み込まない。

import { BrowserFileSink } from '../../io/browserFileSink'
import type { FileSink } from '../../io/fileSink'
import type { FileSource } from '../../io/fileSource'
import type { ModpackRegistry } from '../../io/modpack/modpackRegistry'
import { isDesktop } from './platform'

type DesktopModules = {
  sink: typeof import('../../io/tauri/tauriFileSink')
  registry: typeof import('../../io/tauri/tauriModpackRegistry')
  blueprint: typeof import('../../io/tauri/tauriBlueprintFiles')
}

let desktopModules: Promise<DesktopModules> | null = null

/** デスクトップ版の実装を読み込む。最初の1回だけ読む */
function loadDesktop(): Promise<DesktopModules> {
  desktopModules ??= Promise.all([
    import('../../io/tauri/tauriFileSink'),
    import('../../io/tauri/tauriModpackRegistry'),
    import('../../io/tauri/tauriBlueprintFiles'),
  ]).then(([sink, registry, blueprint]) => ({ sink, registry, blueprint }))
  return desktopModules
}

/**
 * 書き出しの保存先。ブラウザ版は BrowserFileSink（保存先を選ぶ画面か、ダウンロード）、
 * デスクトップ版は TauriFileSink（保存先を選ぶ画面で選んだパスに書く）。
 * ブラウザ版では、クリックの中で save を呼べるよう、すぐに作って返す
 */
export function createBlueprintSink(): FileSink {
  if (!isDesktop()) return new BrowserFileSink()
  return {
    async save(suggestedName, data) {
      const { sink } = await loadDesktop()
      return new sink.TauriFileSink().save(suggestedName, data)
    },
  }
}

/** 選んだ Modpack のフォルダ。handle は登録の保存に使う（デスクトップ版はフォルダのパス） */
export interface PickedDesktopFolder {
  readonly name: string
  readonly source: FileSource
  readonly handle: string
}

/** デスクトップ版の Modpack のフォルダの登録と選び方 */
export interface DesktopModpackFolders {
  readonly registry: ModpackRegistry<string>
  /** フォルダを選ぶ画面を出す。取り消したら null */
  pickFolder(): Promise<PickedDesktopFolder | null>
}

/** デスクトップ版の Modpack のフォルダの登録と選び方を読み込む。ブラウザ版では呼ばない */
export async function loadDesktopModpackFolders(): Promise<DesktopModpackFolders> {
  const { registry } = await loadDesktop()
  return {
    registry: registry.createTauriModpackRegistry(),
    async pickFolder() {
      const picked = await registry.pickTauriFolder()
      return picked ? { name: picked.name, source: picked.source, handle: picked.path } : null
    },
  }
}

/** 開く設計図のファイル。ブラウザの File のうち、開くのに使う部分と同じ形 */
export interface PickedBlueprintFile {
  readonly name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

/** デスクトップ版で、設計図のファイルを選ぶ画面を出す。取り消したら null。ブラウザ版では呼ばない */
export async function pickDesktopBlueprintFile(extensions: readonly string[]): Promise<PickedBlueprintFile | null> {
  const { blueprint } = await loadDesktop()
  return blueprint.pickTauriBlueprintFile(extensions)
}

/** 画面の注意書きに出す、ファイルの扱い */
export function fileHandlingNotice(): string {
  return isDesktop()
    ? 'ファイルはこの PC の中だけで読み書きし、外部に送信しません。'
    : 'ファイルはブラウザ内だけで読み込み、外部に送信しません。'
}

// デスクトップ版（Tauri）で、設計図のファイルを選ぶ画面を出して読む。
// 選んだファイルは dialog プラグインが読む許可の範囲に足すので、そのまま読める。

import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { baseName, toFileError } from './tauriFileSource'

/** 選んだ設計図のファイル。ブラウザの File のうち、開くのに使う部分と同じ形 */
export interface PickedTauriFile {
  readonly name: string
  /** ファイルの絶対パス */
  readonly path: string
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * 設計図のファイルを選ぶ画面を出す。取り消したら null。
 * extensions は `.nbt` の形（点あり）でも `nbt` でもよい
 */
export async function pickTauriBlueprintFile(extensions: readonly string[]): Promise<PickedTauriFile | null> {
  const path = await open({
    title: '設計図を開く',
    multiple: false,
    directory: false,
    filters: [{ name: '設計図', extensions: extensions.map((e) => e.replace(/^\./, '')) }],
  })
  if (path === null) return null
  const name = baseName(path)
  return {
    name,
    path,
    async arrayBuffer() {
      try {
        const bytes = await readFile(path)
        return bytes.slice().buffer
      } catch (e) {
        throw toFileError(e, name)
      }
    },
  }
}

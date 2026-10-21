// デスクトップ版（Tauri）で保存する FileSink。
// 保存先を選ぶ画面（dialog プラグインの save）を出し、利用者が選んだパスにだけ書く。
// fs の範囲は読み書きで分かれていないので（登録した Modpack のフォルダにも書けてしまう）、
// 書き込みは必ずこの画面で選んだパスに限る（docs/design.md「デスクトップ版（Tauri）」）。

import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import type { FileSink, SaveResult } from '../fileSink'

/** 保存先を選ぶ画面に出すファイルの種類 */
export interface TauriFileFilter {
  /** 「構造物 NBT」 */
  readonly name: string
  /** 拡張子（点なし。`nbt`） */
  readonly extensions: readonly string[]
}

/** 構造物 NBT（.nbt） */
export const NBT_FILTER: TauriFileFilter = { name: '構造物 NBT', extensions: ['nbt'] }

/** Tauri のエラーは文字列のことが多いので、Error にそろえる */
function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

export class TauriFileSink implements FileSink {
  private readonly filters: readonly TauriFileFilter[]

  constructor(options: { filters?: readonly TauriFileFilter[] } = {}) {
    this.filters = options.filters ?? [NBT_FILTER]
  }

  async save(suggestedName: string, data: Uint8Array): Promise<SaveResult> {
    let path: string | null
    try {
      path = await save({
        title: '保存先を選ぶ',
        defaultPath: suggestedName,
        filters: this.filters.map((f) => ({ name: f.name, extensions: [...f.extensions] })),
      })
    } catch (e) {
      throw toError(e)
    }
    if (path === null) return 'cancelled'
    try {
      // 書くのは、いま画面で選んだパスだけ
      await writeFile(path, data)
    } catch (e) {
      throw new Error(`保存できませんでした（${toError(e).message}）。別の場所を選んで、もう一度保存してください。`, {
        cause: e,
      })
    }
    return 'saved'
  }
}

import type { FileSink, SaveResult } from './fileSink'

/**
 * 保存したファイルをメモリに持つ FileSink。テストで、何がどの名前で保存されたかを確かめるのに使う。
 * cancel を true にすると、保存先を選ぶ画面を閉じたときと同じく何も保存せずに 'cancelled' を返す。
 */
export class MemoryFileSink implements FileSink {
  /** 保存したファイル。名前 → 中身（写したもの） */
  readonly files = new Map<string, Uint8Array>()
  cancel = false

  async save(suggestedName: string, data: Uint8Array): Promise<SaveResult> {
    if (this.cancel) return 'cancelled'
    this.files.set(suggestedName, data.slice())
    return 'saved'
  }
}

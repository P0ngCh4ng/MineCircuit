// ファイルの保存先をここに閉じ込める（docs/design.md「io：FileSource」の FileSink）。
// ブラウザでは保存先を選ぶ画面（browserFileSink.ts）、Tauri 版ではファイルに直接書く実装に差し替える。
// 書き出す側はこの型だけを使う。

/** 保存の結果。利用者が保存先を選ぶ画面を閉じたら 'cancelled' */
export type SaveResult = 'saved' | 'cancelled'

/** 保存先 */
export interface FileSink {
  /** data を保存する。suggestedName は保存先を選ぶ画面に最初に出す名前 */
  save(suggestedName: string, data: Uint8Array): Promise<SaveResult>
}

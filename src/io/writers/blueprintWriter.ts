import type { Blueprint, BlueprintFormat } from '../../domain/blueprint'

/**
 * 設計図の形式ごとの書き出し。読み込み（BlueprintReader）の逆。最初は .nbt（NbtBlueprintWriter）だけ。
 * gzip の圧縮がブラウザでは非同期（CompressionStream）なので、write は Promise を返す。
 */
export interface BlueprintWriter {
  readonly format: BlueprintFormat
  /** ファイルの拡張子（`.nbt`） */
  readonly extension: string
  /** 設計図をファイルの中身（gzip 済み）にする。書けないときは BlueprintWriteError を投げる */
  write(bp: Blueprint): Promise<Uint8Array>
}

/** 書き出せなかったときの例外。message は画面にそのまま出せる日本語 */
export class BlueprintWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlueprintWriteError'
  }
}

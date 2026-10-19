import type { Blueprint } from '../../domain/blueprint'

/**
 * 設計図の形式ごとの読み込み。最初は .nbt（NbtBlueprintReader）だけ。
 * gzip の展開がブラウザでは非同期（DecompressionStream）なので、read は Promise を返す。
 */
export interface BlueprintReader {
  /** ファイル名（拡張子）から、この形式で読めそうなら true */
  canRead(fileName: string): boolean
  /** ファイルの中身を読む。形式が違うときは BlueprintReadError を投げる */
  read(name: string, data: ArrayBuffer | Uint8Array): Promise<Blueprint>
}

/** 設計図として読めなかったときの例外。message は画面にそのまま出せる日本語 */
export class BlueprintReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlueprintReadError'
  }
}

/** ArrayBuffer と Uint8Array のどちらでも Uint8Array にする（写さない） */
export function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

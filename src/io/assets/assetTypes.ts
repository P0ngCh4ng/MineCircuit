// jar やリソースパックの中の資産（assets/ 以下のファイル）を読む約束。
// モデルの解決（io/assets/modelResolver）とテクスチャの読み込み（io/assets/textureAtlas）は、
// この AssetReader だけを使う。jar をどう読むか（io/assets/modpackAssetReader）とは切り離して、
// メモリ上の偽の資産でテストできるようにする。

import type { BlockState } from '../../domain/blockState'
import type { AppearanceSet } from '../../domain/blockModel'

/**
 * 資産のファイルを読む。パスは "assets/<namespace>/..." の形（例: "assets/create/models/block/shaft.json"）。
 * 同じパスが複数の jar・リソースパックにあれば、優先度の高いものを返す（docs/design.md「jar の外の翻訳」と同じ順）。
 * ないときは null。
 */
export interface AssetReader {
  readText(path: string): Promise<string | null>
  readBytes(path: string): Promise<Uint8Array | null>
}

/** 設計図に出てくるブロック状態の見た目を用意する。画面はこれを通して AppearanceSet を受け取る */
export interface AppearanceProvider {
  prepare(states: readonly BlockState[]): Promise<AppearanceSet>
}

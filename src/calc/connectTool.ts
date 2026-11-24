// つなぐツールの形（#266。docs/design.md「Mod ごとのものを足す口」）。
// 2つのブロックを順にクリックして、その間を埋めるツール（Create のベルトなど）。
// Mod の規則（どこから始められるか、つなげるか、何を置くか）と文言は計算プラグインが持ち、
// クリックの受け取り・見本・書き込みは画面の共通のツール（view/tools/connectTool.ts）が持つ。

import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { Vec3 } from '../domain/vec3'
import type { CellValue } from '../domain/blockVolume'

/** つなぐときに画面から渡す値 */
export interface ConnectOptions {
  /** その位置のブロックの、最後の計算の回転数（符号付き）。分からなければ null */
  readonly speedAt?: (pos: Vec3) => number | null
}

/** 1本目から2本目までに置くもの。並びは始めから終わり */
export interface ConnectPlan {
  readonly cells: readonly { readonly pos: Vec3; readonly after: CellValue }[]
}

/** 状態表示の文言と、編集の操作の名前 */
export interface ConnectToolMessages {
  /** 選べないブロックをクリックしたとき（「1本目のシャフトをクリックしてください」） */
  readonly pickStart: string
  /** 1本目の選択をやめたとき */
  readonly cancelled: string
  /** 1本目を選んだとき */
  first(pos: Vec3): string
  /** つないだとき。count は置いたマスの数 */
  done(count: number): string
  /** 編集の操作の名前（元に戻すボタンに出る）。count は置くマスの数 */
  command(count: number): string
}

export interface ConnectToolDef {
  /** ツールの id（'belt'）。内蔵のツールやほかのプラグインのものと重ねない */
  readonly id: string
  /** 画面に出す名前（「ベルト」） */
  readonly label: string
  /** 切り替えのキー（大文字）。なければ null。内蔵のツールのキーと重なれば使わない */
  readonly key: string | null
  /** ボタンの説明 */
  readonly description: string
  /** ボタンの絵（SVG の path。viewBox 0 0 20 20） */
  readonly icon: readonly string[]
  readonly messages: ConnectToolMessages
  /** 1本目・2本目に選べるブロックか */
  canStart(state: BlockState | null): boolean
  /** first から second までに置くもの。同じブロックなら null（やめる）、つなげなければ理由。設計図は読むだけ */
  plan(bp: Blueprint, first: Vec3, second: Vec3, options: ConnectOptions): ConnectPlan | string | null
}

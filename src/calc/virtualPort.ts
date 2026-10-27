// 仮の入出力（docs/design.md「仮の入出力（VirtualPort）」）。
// 設計図の端のブロックの面に、利用者が仮の動力源や負荷を付ける。設計図（.nbt）には書かず、
// アプリ独自のファイル（.mcircuit.json）に保存する予定。

import type { Direction } from '../domain/direction'
import type { Vec3 } from '../domain/vec3'

/** 仮の入出力1つ分。値の出どころは 'virtual' */
export interface VirtualPort {
  readonly id: string
  /** 接続するブロックの位置（設計図全体の座標） */
  readonly pos: Vec3
  /** どの面から入るか */
  readonly face: Direction
  /** 'create-stress' など。宛先のプラグインの id */
  readonly pluginId: string
  /** 'rotation-source' など。種類はプラグインが portKinds で定義する */
  readonly kind: string
  /** { rpm: 256, capacity: 4096 } など */
  readonly params: Readonly<Record<string, number>>
  /** { item: 'minecraft:wheat' } など。アイテムを選ぶ種類だけ（#127）。まだ選んでいない欄は入れない */
  readonly items?: Readonly<Record<string, string>>
  /** 「外の水車列」などのメモ */
  readonly label?: string
}

/** 仮の入出力の数値1つ分の定義。画面の入力欄に使う */
export interface PortParamDef {
  /** params のキー（'rpm'） */
  readonly key: string
  /** 画面の名前（「回転数」） */
  readonly label: string
  /** 単位（'RPM'、'SU'） */
  readonly unit?: string
  /** 入力欄の初期値 */
  readonly defaultValue: number
  readonly min?: number
  readonly max?: number
  /** 省略できるか。省略できる値が params にないときはプラグインが扱いを決める */
  readonly optional?: boolean
}

/** 仮の入出力のアイテムの欄1つ分の定義（#127） */
export interface PortItemParamDef {
  /** items のキー（'item'） */
  readonly key: string
  /** 画面の名前（「アイテム」） */
  readonly label: string
}

/** プラグインが受け付ける仮の入出力の種類 */
export interface PortKindDef {
  /** VirtualPort.kind の値（'rotation-source'） */
  readonly kind: string
  /** 画面の名前（「回転の供給」） */
  readonly label: string
  readonly params: readonly PortParamDef[]
  /** アイテムを選ぶ欄。なければ省略 */
  readonly itemParams?: readonly PortItemParamDef[]
  /** 画面に添える説明 */
  readonly description?: string
}

/** pluginId 宛ての仮の入出力だけを取り出す */
export function portsFor(ports: readonly VirtualPort[], pluginId: string): VirtualPort[] {
  return ports.filter((p) => p.pluginId === pluginId)
}

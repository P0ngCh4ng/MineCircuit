// 計算プラグインの形（docs/design.md「calc：計算プラグイン」）。
// Mod ごとの計算（Create の応力など）を同じ形で足す。プラグインは Web Worker の中で動くので、
// 結果（CalcResult）は structured clone で送れる素のデータだけで作る（クラスや関数を入れない）。

import type { Blueprint } from '../domain/blueprint'
import type { Vec3 } from '../domain/vec3'
import type { PortKindDef, VirtualPort } from './virtualPort'
import type { Resolved } from './provenance'

/**
 * calc が Modpack に求めること。io/modpack の Modpack（#24）はこの形を満たす。
 * Worker の中では、画面側の Modpack に問い合わせる代理（workers/calcWorker）がこの形で渡る。
 */
export interface CalcModpack {
  /** jar の assets/<namespace>/ があれば true */
  hasNamespace(ns: string): boolean
  /** Modpack のフォルダからの相対パスで設定ファイルを読む。なければ null */
  config(path: string): Promise<string | null>
  /**
   * Modpack のフォルダの中の項目の名前（名前順。フォルダは末尾に `/`。`saves/` など）。
   * フォルダがなければ空の配列。ワールドごとの設定（saves/<ワールド>/serverconfig/）を探すのに使う。
   * 持たない実装もあるので省略できる。
   */
  list?(dir: string): Promise<string[]>
}

/** プラグインの run に渡すもの */
export interface CalcContext {
  /** なければ内蔵の初期値で計算する */
  readonly pack: CalcModpack | null
  /** このプラグイン宛ての仮の入出力 */
  readonly ports: readonly VirtualPort[]
}

/** 合計など、結果の上に出す値1つ分（「使用 2,048 SU / 供給 4,096 SU」） */
export interface CalcSummaryItem {
  readonly label: string
  readonly value: Resolved<string>
}

/** 問題1つ分。pos は 3D 表示で強調する位置 */
export interface CalcIssue {
  readonly pos: Vec3
  readonly message: string
}

/** 何を仮定して計算したか。位置がない仮定（「設定ファイルがないので内蔵の初期値を使った」など）もある */
export interface CalcAssumption {
  readonly pos?: Vec3
  readonly message: string
}

/** ブロック1つ分の値。プローブ（ツール）で見る。docs/design.md にはない追加の項目 */
export interface CalcProbe {
  readonly pos: Vec3
  readonly values: readonly CalcSummaryItem[]
  /**
   * つながったブロックのまとまり（Create なら回転のネットワーク）の番号。
   * 同じプラグインで同じ番号のブロックは、画面でまとめて強調する（ネットのハイライト）。なければ省略
   */
  readonly network?: number
}

export interface CalcResult {
  readonly summary: readonly CalcSummaryItem[]
  readonly issues: readonly CalcIssue[]
  readonly assumptions: readonly CalcAssumption[]
  /** ブロックごとの値（回転数・応力など）。プローブで使う。なければ省略 */
  readonly probes?: readonly CalcProbe[]
}

export interface CalcPlugin {
  /** 'create-stress' */
  readonly id: string
  /** 画面に出す名前（「Create の応力」） */
  readonly label: string
  /** 受け付ける仮の入出力の種類。画面の入力欄に使う */
  readonly portKinds: readonly PortKindDef[]
  /** この設計図を計算できるか（関係するブロックがあるか） */
  supports(bp: Blueprint, pack: CalcModpack | null): boolean
  /** 計算する。設計図は読むだけで、書き換えない（設計のルール 6） */
  run(bp: Blueprint, ctx: CalcContext): Promise<CalcResult>
}

/** 空の結果 */
export function emptyResult(): CalcResult {
  return { summary: [], issues: [], assumptions: [] }
}

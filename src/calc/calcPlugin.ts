// 計算プラグインの形（docs/design.md「calc：計算プラグイン」）。
// Mod ごとの計算（Create の応力など）を同じ形で足す。プラグインは Web Worker の中で動くので、
// 結果（CalcResult）は structured clone で送れる素のデータだけで作る（クラスや関数を入れない）。

import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { Direction } from '../domain/direction'
import type { Vec3 } from '../domain/vec3'
import type { RecipeBook } from '../io/modpack/recipes'
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
  /**
   * Create の処理のレシピ（jar と kubejs/data/。docs/create-throughput.md「レシピ」）。
   * 処理時間の計算に使う。持たない実装もあるので省略できる（省略なら、レシピは分からないものとして計算する）
   */
  recipeBook?(): Promise<RecipeBook>
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

/** 速さの段階。境目はプラグインが決める（Create は設定の中速・高速） */
export type SpeedLevel = 'stopped' | 'slow' | 'medium' | 'fast'

/** 回るブロック1つ分の回転。表示部分の「回転」の色分けに使う（docs/ui.md「回転の表示」） */
export interface CalcRotation {
  readonly pos: Vec3
  readonly axis: 'x' | 'y' | 'z'
  /** 符号付きの回転数。正は軸の正の向きから見て反時計回り（Create と同じ）。過負荷なら止まる前の値 */
  readonly rpm: number
  readonly level: SpeedLevel
  /** 過負荷で止まっている */
  readonly overloaded: boolean
}

export interface CalcResult {
  readonly summary: readonly CalcSummaryItem[]
  readonly issues: readonly CalcIssue[]
  readonly assumptions: readonly CalcAssumption[]
  /** ブロックごとの値（回転数・応力など）。プローブで使う。なければ省略 */
  readonly probes?: readonly CalcProbe[]
  /** 回るブロックごとの回転。表示部分の色分けで使う。なければ省略 */
  readonly rotations?: readonly CalcRotation[]
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
  /**
   * 置くときの向き（任意。docs/ui.md「編集」）。pos に state を置くとき、隣とつながる向きに合わせた状態を返す。
   * 変えないなら null。from は優先する隣の向き（3D でクリックした面の側）。設計図は読むだけ
   */
  orientForPlacement?(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState | null
  /**
   * その場所に置けるか（任意。#121）。ゲームで置けない（置いても外れて落ちる）なら理由、置けるなら null。
   * 設計図は読むだけ
   */
  placementProblem?(bp: Blueprint, pos: Vec3, state: BlockState): string | null
  /**
   * 置き方の補助（任意。#123）。3D で面をクリックしたとき、クリックしたブロックと当たった点から、置く位置と状態を返す。
   * 使わないなら null（ふつうに面の隣に置く）。設計図は読むだけ
   */
  placementHelper?(
    bp: Blueprint,
    hit: { readonly pos: Vec3; readonly face: Direction; readonly point: Vec3 },
    state: BlockState,
  ): { pos: Vec3; state: BlockState } | null
}

/** 空の結果 */
export function emptyResult(): CalcResult {
  return { summary: [], issues: [], assumptions: [] }
}

import type { BlockState } from './blockState'
import type { RawNbt } from './nbt'
import type { Vec3 } from './vec3'

/** エンティティ（額縁、防具立てなど）の生データ。中身は解釈しない */
export type RawEntity = RawNbt

/** 1マス分の中身。空きは state = null */
export interface CellValue {
  readonly state: BlockState | null
  readonly blockEntity: RawNbt | null
}

/** 空きのマス */
export const EMPTY_CELL: CellValue = Object.freeze({ state: null, blockEntity: null })

/** cells の中で空きを表す値 */
export const EMPTY_INDEX = -1

/** BlockVolume を作るときの材料。読み込み（io/readers）やテスト用のヘルパーが使う */
export interface BlockVolumeInit {
  /** リージョン名。.nbt なら "main" */
  name: string
  /** 設計図全体の中での位置。省略すると [0, 0, 0] */
  offset?: Vec3
  size: Vec3
  palette?: readonly BlockState[]
  /**
   * 位置ごとのパレット番号。空きは -1。並びは cellIndex() の順。
   * 省略するとすべて空き。渡した配列はそのまま使う（写さない）。
   */
  cells?: Int32Array
  /** セル番号（cellIndex() の値）→ ブロックエンティティの生データ */
  blockEntities?: ReadonlyMap<number, RawNbt>
  entities?: readonly RawEntity[]
  /** 解釈していない一番上の階層の項目 */
  extra?: RawNbt
  /**
   * `palettes` 形式（パレットのリスト）の .nbt で、先頭より後ろのパレット。
   * 各パレットは palette と同じ並びの状態の生データ（Name・Properties の Compound）。
   * 使うのは先頭（palette）だけで、これは書き出しで元に戻すためだけに持つ。
   */
  alternatePalettes?: readonly (readonly RawNbt[])[]
}

/**
 * 大きさ size の中で (x, y, z) のセル番号を返す。範囲外は -1。
 * 並びは x が一番内側、次に z、一番外側が y。1つの段（同じ y）が続けて並ぶ。
 */
export function cellIndex(size: Vec3, x: number, y: number, z: number): number {
  const [sx, sy, sz] = size
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return -1
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return -1
  return (y * sz + z) * sx + x
}

/**
 * 1つのリージョンのブロック配置。読み込んだものを全部持つ。
 * 座標はリージョンの中のもの（0 始まり）。設計図全体の座標は Blueprint で扱う。
 *
 * 書き換える関数は setCell と stateIndex だけ。呼んでよいのは edit 層の操作だけ
 * （CLAUDE.md の設計のルール 6）。画面や計算プラグインは読む関数だけを使う。
 */
export class BlockVolume {
  readonly name: string
  readonly offset: Vec3
  readonly size: Vec3
  readonly entities: readonly RawEntity[]
  readonly extra: RawNbt
  /** `palettes` 形式の .nbt で、先頭より後ろのパレット（生データ）。ふつうは空 */
  readonly alternatePalettes: readonly (readonly RawNbt[])[]

  private readonly paletteList: BlockState[]
  /** BlockState.key → パレット番号。同じ状態が2つあるときは先のもの */
  private readonly paletteLookup = new Map<string, number>()
  /** 位置ごとのパレット番号。空きは -1 */
  private readonly cells: Int32Array
  /** セル番号 → ブロックエンティティの生データ */
  private readonly blockEntities: Map<number, RawNbt>

  constructor(init: BlockVolumeInit) {
    const size = init.size
    if (!size.every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error(`リージョン "${init.name}" の大きさ [${size.join(', ')}] が正しくありません。0 以上の整数を指定してください。`)
    }
    const count = size[0] * size[1] * size[2]
    this.name = init.name
    this.offset = init.offset ?? [0, 0, 0]
    this.size = size
    this.entities = init.entities ?? []
    this.extra = init.extra ?? { type: 'compound', value: new Map() }
    this.alternatePalettes = init.alternatePalettes ?? []

    this.paletteList = [...(init.palette ?? [])]
    this.paletteList.forEach((state, i) => {
      if (!this.paletteLookup.has(state.key)) this.paletteLookup.set(state.key, i)
    })

    if (init.cells) {
      if (init.cells.length !== count) {
        throw new Error(`リージョン "${init.name}" のセルの数 ${init.cells.length} が大きさと合いません（${count} 個のはずです）。`)
      }
      for (const index of init.cells) {
        if (index !== EMPTY_INDEX && (index < 0 || index >= this.paletteList.length)) {
          throw new Error(`リージョン "${init.name}" にパレットにない番号 ${index} があります。`)
        }
      }
      this.cells = init.cells
    } else {
      this.cells = new Int32Array(count).fill(EMPTY_INDEX)
    }

    this.blockEntities = new Map(init.blockEntities ?? [])
    for (const index of this.blockEntities.keys()) {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new Error(`リージョン "${init.name}" のブロックエンティティの位置 ${index} が範囲の外です。`)
      }
    }
  }

  /** 設計図に出てくるブロック状態の一覧。使われていない状態が残ることがある */
  get palette(): readonly BlockState[] {
    return this.paletteList
  }

  /** (x, y, z) が範囲の中なら true */
  contains(x: number, y: number, z: number): boolean {
    return cellIndex(this.size, x, y, z) >= 0
  }

  /** (x, y, z) のブロック状態。空きと範囲外は null */
  get(x: number, y: number, z: number): BlockState | null {
    const i = cellIndex(this.size, x, y, z)
    if (i < 0) return null
    const p = this.cells[i]
    return p === EMPTY_INDEX ? null : this.paletteList[p]
  }

  /** (x, y, z) のブロックエンティティの生データ。ないときと範囲外は null */
  blockEntityAt(x: number, y: number, z: number): RawNbt | null {
    const i = cellIndex(this.size, x, y, z)
    if (i < 0) return null
    return this.blockEntities.get(i) ?? null
  }

  /** (x, y, z) の中身（状態と生データ）。範囲外は null */
  cellAt(x: number, y: number, z: number): CellValue | null {
    const i = cellIndex(this.size, x, y, z)
    if (i < 0) return null
    const p = this.cells[i]
    if (p === EMPTY_INDEX) return EMPTY_CELL
    return { state: this.paletteList[p], blockEntity: this.blockEntities.get(i) ?? null }
  }

  /**
   * 空きでないマスを順に渡す。並びは cellIndex() の順（段ごと）。
   * 集計や書き出しで使う。fn の中で書き換えないこと。
   */
  forEachBlock(fn: (x: number, y: number, z: number, state: BlockState, blockEntity: RawNbt | null) => void): void {
    const [sx, sy, sz] = this.size
    let i = 0
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++, i++) {
          const p = this.cells[i]
          if (p !== EMPTY_INDEX) fn(x, y, z, this.paletteList[p], this.blockEntities.get(i) ?? null)
        }
      }
    }
  }

  /**
   * (x, y, z) を cell に書き換える。範囲外はエラー。
   * 編集用。呼んでよいのは edit 層の操作だけ。
   * state が null なら空きにし、生データも消す。
   */
  setCell(x: number, y: number, z: number, cell: CellValue): void {
    const i = cellIndex(this.size, x, y, z)
    if (i < 0) {
      throw new Error(`位置 [${x}, ${y}, ${z}] はリージョン "${this.name}" の範囲の外です。`)
    }
    if (cell.state === null) {
      this.cells[i] = EMPTY_INDEX
      this.blockEntities.delete(i)
      return
    }
    this.cells[i] = this.stateIndex(cell.state)
    if (cell.blockEntity) this.blockEntities.set(i, cell.blockEntity)
    else this.blockEntities.delete(i)
  }

  /**
   * state のパレット番号。パレットになければ末尾に足す。
   * 編集用。呼んでよいのは edit 層の操作だけ。
   */
  stateIndex(state: BlockState): number {
    const found = this.paletteLookup.get(state.key)
    if (found !== undefined) return found
    const index = this.paletteList.length
    this.paletteList.push(state)
    this.paletteLookup.set(state.key, index)
    return index
  }
}

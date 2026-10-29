// 2D表示（LayerView2D）のマス目の計算。docs/ui.md「2D表示と計測」。
// canvas にも Vue にも依存しない計算だけを置き、テストできるようにする。

import { appearanceKey, hasBlockEntityAppearance } from '../../io/assets/blockEntityAppearance'
import type { Blueprint } from '../../domain/blueprint'
import type { BlockState } from '../../domain/blockState'
import type { Vec3 } from '../../domain/vec3'
import { AIR_IDS } from '../../io/readers/nbtBlueprintReader'
import type { GridLayout2D } from '../tools/picker'

/** マス目のまわりの余白（px）。上と左は目盛りの数字の分を空ける。左は表示部分のツールバーとも重ならないようにする */
export interface GridPadding2D {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export const DEFAULT_GRID_PADDING: GridPadding2D = Object.freeze({ left: 96, top: 56, right: 24, bottom: 24 })

/** 1マスの最小の大きさ（px）。これより小さくはしない（はみ出した分は、2D表示を動かして見る。#155） */
export const MIN_CELL_SIZE = 1
/** 1マスの最大の大きさ（px）。小さい設計図が大きくなりすぎないようにする */
export const MAX_CELL_SIZE = 64
/** 略称を出す最小のマスの大きさ（px） */
export const LABEL_MIN_CELL_SIZE = 26

/**
 * 表示の大きさ（width × height）に、設計図の段（幅 x × 奥行き z）が入るようにマス目を置く。
 * マス目は余白の内側の真ん中に置く。
 */
export function layoutGrid2D(width: number, height: number, size: Vec3, pad: GridPadding2D = DEFAULT_GRID_PADDING): GridLayout2D {
  const [w, , d] = size
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = Math.max(0, height - pad.top - pad.bottom)
  const fit = w > 0 && d > 0 ? Math.floor(Math.min(innerW / w, innerH / d)) : MIN_CELL_SIZE
  const cellSize = Math.min(MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, fit))
  const originX = pad.left + Math.max(0, Math.floor((innerW - cellSize * w) / 2))
  const originY = pad.top + Math.max(0, Math.floor((innerH - cellSize * d) / 2))
  return { originX, originY, cellSize }
}

/** 目盛りの数字を何マスおきに出すか。数字どうしが重ならないようにする */
export function axisLabelStep(cellSize: number, minSpacing = 22): number {
  if (cellSize >= minSpacing) return 1
  const raw = Math.ceil(minSpacing / cellSize)
  // 1, 2, 5, 10, 20, 50 … のきりのよい数にそろえる
  for (let base = 1; ; base *= 10) {
    for (const m of [1, 2, 5]) {
      if (m * base >= raw) return m * base
    }
  }
}

/**
 * ブロックの ID の略称（2文字）。"create:mechanical_press" → "MP"、"minecraft:stone" → "ST"。
 * namespace は使わない。
 */
export function blockAbbreviation(id: string): string {
  const colon = id.indexOf(':')
  const path = colon >= 0 ? id.slice(colon + 1) : id
  const words = path.split(/[_/]/).filter((s) => s.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** 2D表示に描く1マス */
export interface LayerCell2D {
  readonly x: number
  readonly z: number
  readonly state: BlockState
  /** ブロックの ID（"create:shaft"） */
  readonly id: string
  /** 見た目の鍵（appearanceKey）。生データで見た目が変わるブロックのときだけ state.key と違う */
  readonly appearanceKey: string
}

/** 空気（空気の ID のブロック）なら true。.nbt の読み込みでは空気は空になるが、念のため */
export function isAirState(state: BlockState): boolean {
  return AIR_IDS.has(state.id.toString())
}

/** 段 y にあるブロック（空気を除く）。範囲の外の段なら空 */
export function layerCells(blueprint: Blueprint, y: number): LayerCell2D[] {
  const cells: LayerCell2D[] = []
  if (y < 0 || y >= blueprint.size[1]) return cells
  blueprint.forEachInLayer(y, (pos, state) => {
    if (isAirState(state)) return
    const key = hasBlockEntityAppearance(state) ? appearanceKey(state, blueprint.blockEntityAt(pos)) : state.key
    cells.push({ x: pos[0], z: pos[2], state, id: state.id.toString(), appearanceKey: key })
  })
  return cells
}


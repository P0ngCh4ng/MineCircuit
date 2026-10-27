import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, oppositeDirection, type Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import { placeBlock } from '../../edit/editCommand'
import { isInside, outOfRangeMessage, type EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool } from './tool'

export const NO_BRUSH_MESSAGE = '置くブロックがありません。左パネルで選ぶか、スポイト（I）で表示中のブロックから取ってください。'
export const OCCUPIED_MESSAGE = 'そこにはすでにブロックがあります。置き換えるときは Shift+クリックします。'

/** 置く先のマスと、置き換えるかどうか */
export interface PlaceCell {
  readonly pos: Vec3
  readonly replace: boolean
}

/**
 * マウスの下のもの（PickTarget）から、置く先を決める。docs/ui.md「編集」。
 * - 空きマス（3D の今の段の床、2D の空きマス）：そのマス
 * - 3D で当たったブロック：当たった面の隣。Shift なら当たったブロックを置き換え
 * - 面のないブロック（2D の埋まったマス）：そのマスを置き換え
 */
export function placeCell(target: PickTarget, mods: PickModifiers): PlaceCell {
  if (target.empty) return { pos: target.pos, replace: false }
  if (target.face === undefined || mods.shift) return { pos: target.pos, replace: true }
  const d = directionVector(target.face)
  const p = target.pos
  return { pos: [p[0] + d[0], p[1] + d[1], p[2] + d[2]], replace: false }
}

/** 置く先から見て、優先する隣の向き。3D で面をクリックしたときは、クリックしたブロックの側 */
function fromOf(target: PickTarget, cell: PlaceCell): Direction | null {
  return !cell.replace && target.face !== undefined ? oppositeDirection(target.face) : null
}

/** 置くツール（B）。クリックした所に置くブロックを置く。範囲の外には置かせず、理由を出す */
export class PlaceTool implements Tool {
  readonly id = 'place' as const

  constructor(private readonly ctx: EditToolContext) {}

  onHover(target: PickTarget | null): void {
    const bp = this.ctx.blueprint()
    const brush = this.ctx.brush()
    const plan = target && bp && brush ? this.plan(bp, target, brush, { shift: false }) : null
    // 見本は、空いているマスにだけ出す。設置の規則で置けないなら赤くする（#121）
    if (!bp || !plan || !isInside(bp, plan.pos) || (!plan.replace && bp.get(plan.pos) !== null)) {
      this.ctx.setGhost(null)
      return
    }
    this.ctx.setGhost(plan.pos, this.ctx.placementProblem(bp, plan.pos, plan.state) !== null)
  }

  /**
   * 置く位置と状態を決める。3D で面をクリックしたときは置き方の補助（#123）を先に聞き、
   * なければ面の隣に置いて、隣とつながる向きに合わせる（#119）。Alt なら補助も向き合わせも使わない
   */
  private plan(bp: Blueprint, target: PickTarget, brush: BlockState, mods: PickModifiers): PlaceCell & { state: BlockState } {
    if (!mods.alt && !mods.shift && target.face !== undefined && target.point !== undefined && !target.empty) {
      const helped = this.ctx.placementHelper(bp, { pos: target.pos, face: target.face, point: target.point }, brush)
      if (helped) return { pos: helped.pos, replace: false, state: helped.state }
    }
    const cell = placeCell(target, mods)
    const state = mods.alt ? brush : this.ctx.orient(bp, cell.pos, brush, fromOf(target, cell))
    return { ...cell, state }
  }

  onClick(target: PickTarget, mods: PickModifiers): void {
    const bp = this.ctx.blueprint()
    if (!bp) return
    const state = this.ctx.brush()
    if (!state) {
      this.ctx.notify(NO_BRUSH_MESSAGE)
      return
    }
    const { pos, replace, state: placed } = this.plan(bp, target, state, mods)
    if (!isInside(bp, pos)) {
      this.ctx.notify(outOfRangeMessage(bp))
      return
    }
    if (!replace && bp.get(pos) !== null) {
      this.ctx.notify(OCCUPIED_MESSAGE)
      return
    }
    this.ctx.notify(null)
    // ゲームで置けない所には置かない（#121）
    const problem = this.ctx.placementProblem(bp, pos, placed)
    if (problem) {
      this.ctx.notify(problem)
      return
    }
    // 同じブロックがすでにあるときは変化なし（null）なので、何もしない
    if (this.ctx.apply(placeBlock(bp, pos, placed, replace))) this.ctx.revealLayer(pos[1])
  }

  deactivate(): void {
    this.ctx.setGhost(null)
  }
}


import { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, oppositeDirection, type Direction } from '../../domain/direction'
import { boxFromCorners } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { placeGrowing, regionToGrow } from '../../edit/blueprintResize'
import { placeBlock, placeBlocks } from '../../edit/editCommand'
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
 * - 当たったブロック：Shift なら置き換え（2D と 3D で同じ。#164）
 * - 3D で当たったブロック：当たった面の隣
 * - 面のないブロック（2D の埋まったマス）：そのマス（埋まっているので置かずに知らせる）
 */
export function placeCell(target: PickTarget, mods: PickModifiers): PlaceCell {
  if (target.empty) return { pos: target.pos, replace: false }
  if (mods.shift) return { pos: target.pos, replace: true }
  if (target.face === undefined) return { pos: target.pos, replace: false }
  const d = directionVector(target.face)
  const p = target.pos
  return { pos: [p[0] + d[0], p[1] + d[1], p[2] + d[2]], replace: false }
}

/** 一直線に置いたとき、置けなかったマスの知らせ（#161） */
export function lineSkippedMessage(skipped: number): string {
  return `埋まっているマス・範囲の外・置けないマスの ${skipped} 個は飛ばしました。`
}
export const LINE_NOTHING_MESSAGE = '線の上に置けるマスがありません。空いているマスを通るように引いてください。'

/** 一直線の軸 */
export type LineAxis = 'x' | 'y' | 'z'

/**
 * 始点から終点へ引いた一直線のマス（#161）。始点からの差が一番大きい軸に沿って、始点から終点の位置まで。
 * 差が同じなら x、z、y の順に選ぶ。始点と終点が同じなら始点だけ（軸は null）
 */
export function lineCells(start: Vec3, end: Vec3): { cells: Vec3[]; axis: LineAxis | null } {
  const d = [end[0] - start[0], end[1] - start[1], end[2] - start[2]] as const
  let axis: 0 | 1 | 2 = 0
  for (const i of [2, 1] as const) if (Math.abs(d[i]) > Math.abs(d[axis])) axis = i
  const len = Math.abs(d[axis])
  if (len === 0) return { cells: [[...start]], axis: null }
  const step = Math.sign(d[axis])
  const cells: Vec3[] = []
  for (let i = 0; i <= len; i++) {
    const p: [number, number, number] = [start[0], start[1], start[2]]
    p[axis] += step * i
    cells.push(p)
  }
  return { cells, axis: (['x', 'y', 'z'] as const)[axis] }
}

/** axis のプロパティを持つブロック（シャフトなど）なら、軸を線の向きにそろえる（#161）。持たなければそのまま */
export function alignAxis(state: BlockState, axis: LineAxis | null): BlockState {
  if (axis === null || state.properties['axis'] === undefined || state.properties['axis'] === axis) return state
  return new BlockState(state.id, { ...state.properties, axis })
}

/** 置く先から見て、優先する隣の向き。3D で面をクリックしたときは、クリックしたブロックの側 */
function fromOf(target: PickTarget, cell: PlaceCell): Direction | null {
  return !cell.replace && target.face !== undefined ? oppositeDirection(target.face) : null
}

/** 知らせをつなぐ。なければ null */
function joinMessages(messages: readonly (string | null)[]): string | null {
  const list = messages.filter((m): m is string => !!m)
  return list.length > 0 ? list.join('。') : null
}

/** pos に置けるか。枠の中か、枠のすぐ外（置くと広げる。#191） */
function placeable(bp: Blueprint, pos: Vec3): boolean {
  return isInside(bp, pos) || regionToGrow(bp, pos) >= 0
}

/** 置くツール（B）。クリックした所に置くブロックを置く。枠のすぐ外なら枠を広げて置き（#191）、それより外は理由を出す */
export class PlaceTool implements Tool {
  readonly id = 'place' as const
  /** ドラッグで一直線に置くときの始点と、最後に指していた終点（#161） */
  private line: { start: Vec3; end: Vec3 } | null = null

  constructor(private readonly ctx: EditToolContext) {}

  onHover(target: PickTarget | null): void {
    const bp = this.ctx.blueprint()
    const brush = this.ctx.brush()
    const plan = target && bp && brush ? this.plan(bp, target, brush, { shift: false }) : null
    // 見本は、空いているマスにだけ出す。設置の規則で置けないなら赤くする（#121）
    if (!bp || !plan || !placeable(bp, plan.pos) || (!plan.replace && bp.get(plan.pos) !== null)) {
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
    if (!placeable(bp, pos)) {
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
    // 枠のすぐ外なら、枠を広げて置く（#191）
    if (!isInside(bp, pos)) {
      const warnings = this.placeOutside(bp, [pos], placed)
      if (warnings) this.ctx.notify(joinMessages([...warnings, this.ctx.stateProblem(placed)]))
      return
    }
    // 同じブロックがすでにあるときは変化なし（null）なので、何もしない
    if (!this.ctx.apply(placeBlock(bp, pos, placed, replace))) return
    this.ctx.revealLayer(pos[1])
    // 置けるが、状態が足りずに計算から外れるときは知らせる（#149）
    const missing = this.ctx.stateProblem(placed)
    if (missing) this.ctx.notify(missing)
  }

  /**
   * ドラッグで一直線に置く（#161）。押した所の置く先が始点。置くブロックがなければ知らせて受け取らない
   */
  dragStart(target: PickTarget): boolean {
    const bp = this.ctx.blueprint()
    if (!bp) return false
    if (!this.ctx.brush()) {
      this.ctx.notify(NO_BRUSH_MESSAGE)
      return false
    }
    const start = placeCell(target, { shift: false }).pos
    if (!placeable(bp, start)) return false
    this.line = { start, end: start }
    this.ctx.setGhost(null)
    this.showLine()
    return true
  }

  dragMove(target: PickTarget | null): void {
    if (!this.line || !target) return
    this.line.end = placeCell(target, { shift: false }).pos
    this.showLine()
  }

  dragEnd(target: PickTarget | null): void {
    if (target) this.dragMove(target)
    const plan = this.planLine()
    this.line = null
    this.ctx.setLinePreview(null)
    const bp = this.ctx.blueprint()
    if (!plan || !bp) return
    if (plan.place.length === 0) {
      this.ctx.notify(LINE_NOTHING_MESSAGE)
      return
    }
    // 1回の編集の操作として置く。元に戻すと全部消える。枠の外へ出るなら、線が入るように枠を広げる（#191）
    let warnings: readonly string[] = []
    if (plan.place.some((pos) => !isInside(bp, pos))) {
      const placed = this.placeOutside(bp, plan.place, plan.state)
      if (!placed) return
      warnings = placed
    } else {
      if (!this.ctx.apply(placeBlocks(bp, plan.place, plan.state))) return
      const first = plan.place[0]
      if (first) this.ctx.revealLayer(first[1])
    }
    this.ctx.notify(joinMessages([...warnings, plan.skipped > 0 ? lineSkippedMessage(plan.skipped) : this.ctx.stateProblem(plan.state)]))
  }

  dragCancel(): void {
    this.line = null
    this.ctx.setLinePreview(null)
  }

  /**
   * 枠の外を含むマスに置く（#191）。始めのマスのリージョンを広げる。広げられなければ理由を出して false。
   * 置いたら、置いた段を見えるようにし、知らせ（座標がずれたなど）を返す。置けなければ null
   */
  private placeOutside(bp: Blueprint, cells: readonly Vec3[], state: BlockState): readonly string[] | null {
    const region = regionToGrow(bp, cells[0]!)
    const plan = region < 0 ? null : placeGrowing(bp, region, cells.map((pos) => ({ pos, state })))
    if (plan === null || typeof plan === 'string') {
      this.ctx.notify(plan ?? outOfRangeMessage(bp))
      return null
    }
    if (!this.ctx.apply(plan.command)) return null
    this.ctx.revealLayer(cells[0]![1] + plan.shift[1])
    return plan.warnings
  }

  /** 今の線で置くマス（空いていて、枠の中かすぐ外へつながる所で、置ける所）と状態、飛ばすマスの数 */
  private planLine(): { place: Vec3[]; state: BlockState; skipped: number; cells: Vec3[] } | null {
    const bp = this.ctx.blueprint()
    const brush = this.ctx.brush()
    if (!this.line || !bp || !brush) return null
    const { cells, axis } = lineCells(this.line.start, this.line.end)
    const state = alignAxis(brush, axis)
    const place = cells.filter((pos) => bp.get(pos) === null && this.ctx.placementProblem(bp, pos, state) === null)
    return { place, state, skipped: cells.length - place.length, cells }
  }

  private showLine(): void {
    const plan = this.planLine()
    const first = plan?.cells[0]
    const last = plan?.cells[plan.cells.length - 1]
    if (!plan || !first || !last) {
      this.ctx.setLinePreview(null)
      return
    }
    this.ctx.setLinePreview({ cells: plan.place.map((pos) => ({ pos, state: plan.state })), box: boxFromCorners(first, last) })
  }

  deactivate(): void {
    this.dragCancel()
    this.ctx.setGhost(null)
  }
}


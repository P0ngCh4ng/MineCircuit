// 液体の広がりと流れの向き（Minecraft 本体の FlowingFluid）。Mod によらない。
// 規則は docs/create-stress.md「水車の水の流れ」の ST-FLUID-SPREAD・ST-FLUID-FLOW。
import type { Blueprint } from '../domain/blueprint'
import { HORIZONTAL_DIRECTIONS, directionVector, oppositeDirection, type Direction } from '../domain/direction'
import { addVec3, type Vec3 } from '../domain/vec3'

export type FluidKind = 'water' | 'lava'

/** 1マスの液体。amount は 1〜8（水源と落ちる液体は 8） */
export interface FluidCell {
  readonly kind: FluidKind
  readonly amount: number
  readonly source: boolean
  readonly falling: boolean
}

/** 広げる計算の上限（マスを調べ直す回数の合計）。超えたら、そこまでの状態を使う */
const MAX_TICKS = 2_000_000

const DOWN: Vec3 = [0, -1, 0]
const UP: Vec3 = [0, 1, 0]

function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

function dropOff(kind: FluidKind): number {
  return kind === 'water' ? 1 : 2
}

function slopeFindDistance(kind: FluidKind): number {
  return kind === 'water' ? 4 : 2
}

function sameCell(a: FluidCell | null, b: FluidCell | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.amount === b.amount && a.source === b.source && a.falling === b.falling
}

function flowing(kind: FluidKind, amount: number, falling: boolean): FluidCell {
  return { kind, amount, source: false, falling }
}

function sourceCell(kind: FluidKind): FluidCell {
  return { kind, amount: 8, source: true, falling: false }
}

/** 液体のブロック（level の付いた水・溶岩）の液体。level がなければ水源 */
function fluidBlockCell(kind: FluidKind, level: string | undefined): FluidCell {
  const n = level === undefined ? 0 : Number(level)
  if (!Number.isInteger(n) || n <= 0) return sourceCell(kind)
  return n >= 8 ? flowing(kind, 8, true) : flowing(kind, 8 - n, false)
}

type CellKind =
  /** 液体を入れられる（空気か、液体のブロック） */
  | 'open'
  /** 液体を通さない固いブロック。水浸しなら水源を持つ */
  | 'solid'
  /** 泡の柱。水源で、液体は入れられない */
  | 'bubble'

/**
 * 設計図の水・溶岩を、Minecraft の決まりで落ち着くまで広げた結果（ST-FLUID-SPREAD）。
 * 液体を入れられるのは空気と液体のブロックだけ。ほかのブロックは固いとみなす。
 * 設計図の外は、横と上は空気（液体は出ていくが数えない）、一番下の段の下は地面。
 */
export class FluidField {
  /** 変わる液体（設計図の中の、空気か液体のブロックのマス） */
  private readonly cells = new Map<string, FluidCell>()
  /** 変わらない水源（水浸しのブロック・泡の柱） */
  private readonly fixed = new Map<string, FluidCell>()
  /** 設計図にあったときの液体 */
  private readonly original = new Map<string, FluidCell>()
  /** 設計図にあった液体の位置 */
  private readonly starts: Vec3[] = []
  private readonly done: boolean

  constructor(
    private readonly bp: Blueprint,
    maxTicks = MAX_TICKS,
  ) {
    for (const region of bp.regions) {
      region.forEachBlock((x, y, z, state) => {
        const pos = addVec3([x, y, z], region.offset)
        if (bp.locate(pos)?.region !== region) return
        const k = key(pos)
        const id = state.id.toString()
        let cell: FluidCell | null = null
        if (id === 'minecraft:water' || id === 'minecraft:lava') {
          cell = fluidBlockCell(id === 'minecraft:water' ? 'water' : 'lava', state.properties.level)
          this.cells.set(k, cell)
        } else if (id === 'minecraft:bubble_column' || state.properties.waterlogged === 'true') {
          cell = sourceCell('water')
          this.fixed.set(k, cell)
        }
        if (cell) {
          this.original.set(k, cell)
          this.starts.push(pos)
        }
      })
    }
    this.done = this.spreadAll(maxTicks)
  }

  /** 落ち着くまで広げられたか。上限で止めたときは false */
  get settled(): boolean {
    return this.done
  }

  /** pos の液体。なければ null */
  at(pos: Vec3): FluidCell | null {
    const k = key(pos)
    return this.cells.get(k) ?? this.fixed.get(k) ?? null
  }

  /** pos の液体が、設計図にあったものと違う（広げる計算で決めた）か */
  simulated(pos: Vec3): boolean {
    const now = this.at(pos)
    return now !== null && !sameCell(now, this.original.get(key(pos)) ?? null)
  }

  /** pos の液体の流れの向き（ST-FLUID-FLOW）。長さ 1 か 0 */
  flow(pos: Vec3): Vec3 {
    const cell = this.at(pos)
    if (!cell) return [0, 0, 0]
    const own = cell.amount / 9
    let x = 0
    let z = 0
    for (const dir of HORIZONTAL_DIRECTIONS) {
      const step = directionVector(dir)
      const n = addVec3(pos, step)
      const nf = this.at(n)
      if (nf && nf.kind !== cell.kind) continue
      let diff = 0
      if (nf) {
        diff = own - nf.amount / 9
      } else if (this.cellKind(n) !== 'solid') {
        const below = this.at(addVec3(n, DOWN))
        if (below && below.kind === cell.kind) diff = own - (below.amount / 9 - 8 / 9)
      }
      x += step[0] * diff
      z += step[2] * diff
    }
    let v: Vec3 = [x, 0, z]
    if (cell.falling) {
      const wall = HORIZONTAL_DIRECTIONS.some((dir) => {
        const n = addVec3(pos, directionVector(dir))
        return this.solidFace(n, cell.kind) || this.solidFace(addVec3(n, UP), cell.kind)
      })
      if (wall) {
        const u = normalize(v)
        v = [u[0], u[1] - 6, u[2]]
      }
    }
    return normalize(v)
  }

  private cellKind(pos: Vec3): CellKind {
    if (pos[1] < 0) return 'solid'
    const state = this.bp.get(pos)
    if (!state) return 'open'
    const id = state.id.toString()
    if (id === 'minecraft:water' || id === 'minecraft:lava') return 'open'
    if (id === 'minecraft:bubble_column') return 'bubble'
    return 'solid'
  }

  private inside(pos: Vec3): boolean {
    return this.bp.locate(pos) !== null
  }

  /** 横から液体を受け止める面か（isSolidFace）。同じ液体を持つマスは受け止めない */
  private solidFace(pos: Vec3, kind: FluidKind): boolean {
    return this.cellKind(pos) === 'solid' && this.at(pos)?.kind !== kind
  }

  private canHold(pos: Vec3): boolean {
    return this.cellKind(pos) === 'open'
  }

  private isSource(pos: Vec3, kind: FluidKind): boolean {
    const f = this.at(pos)
    return f !== null && f.kind === kind && f.source
  }

  /** 同じ液体の水源でなく、液体を入れられる（canPassThrough） */
  private canPassThrough(pos: Vec3, kind: FluidKind): boolean {
    return !this.isSource(pos, kind) && this.canHold(pos)
  }

  /** pos の下が、同じ液体か、液体を入れられる所（isWaterHole） */
  private isHole(pos: Vec3, kind: FluidKind): boolean {
    const below = addVec3(pos, DOWN)
    return this.at(below)?.kind === kind || this.canHold(below)
  }

  /** 空いていて、液体を入れられる（canSpreadTo） */
  private canSpreadTo(pos: Vec3): boolean {
    return this.at(pos) === null && this.canHold(pos)
  }

  /** pos に入るはずの液体（getNewLiquid） */
  private newLiquid(pos: Vec3, kind: FluidKind): FluidCell | null {
    let most = 0
    let sources = 0
    for (const dir of HORIZONTAL_DIRECTIONS) {
      const f = this.at(addVec3(pos, directionVector(dir)))
      if (!f || f.kind !== kind) continue
      if (f.source) sources++
      most = Math.max(most, f.amount)
    }
    if (kind === 'water' && sources >= 2) {
      const below = addVec3(pos, DOWN)
      if (this.cellKind(below) === 'solid' || this.isSource(below, kind)) return sourceCell(kind)
    }
    if (this.at(addVec3(pos, UP))?.kind === kind) return flowing(kind, 8, true)
    const amount = most - dropOff(kind)
    return amount <= 0 ? null : flowing(kind, amount, false)
  }

  private sourceNeighbors(pos: Vec3, kind: FluidKind): number {
    return HORIZONTAL_DIRECTIONS.filter((dir) => this.isSource(addVec3(pos, directionVector(dir)), kind)).length
  }

  /** 下へ落ちられる所までの近さ（getSlopeDistance）。なければ 1000 */
  private slopeDistance(pos: Vec3, distance: number, from: Direction, kind: FluidKind): number {
    let best = 1000
    for (const dir of HORIZONTAL_DIRECTIONS) {
      if (dir === from) continue
      const next = addVec3(pos, directionVector(dir))
      if (!this.canPassThrough(next, kind)) continue
      if (this.isHole(next, kind)) return distance
      if (distance < slopeFindDistance(kind)) {
        best = Math.min(best, this.slopeDistance(next, distance + 1, oppositeDirection(dir), kind))
      }
    }
    return best
  }

  /** 横に広がる向きと、そこに入る液体（getSpread） */
  private spreadTargets(pos: Vec3, kind: FluidKind): [Vec3, FluidCell | null][] {
    let best = 1000
    let result: [Vec3, FluidCell | null][] = []
    for (const dir of HORIZONTAL_DIRECTIONS) {
      const next = addVec3(pos, directionVector(dir))
      if (!this.canPassThrough(next, kind)) continue
      const distance = this.isHole(next, kind) ? 0 : this.slopeDistance(next, 1, oppositeDirection(dir), kind)
      if (distance < best) result = []
      if (distance <= best) {
        result.push([next, this.newLiquid(next, kind)])
        best = distance
      }
    }
    return result
  }

  /** 広げる。変わったマスを返す */
  private spread(pos: Vec3, cell: FluidCell, changed: Vec3[]): void {
    const below = addVec3(pos, DOWN)
    if (this.canSpreadTo(below)) {
      // 真上（pos）に液体があるので、下に入るのは必ず落ちる液体
      this.put(below, flowing(cell.kind, 8, true), changed)
      if (this.sourceNeighbors(pos, cell.kind) >= 3) this.spreadToSides(pos, cell, changed)
    } else if (cell.source || !this.isHole(pos, cell.kind)) {
      this.spreadToSides(pos, cell, changed)
    }
  }

  private spreadToSides(pos: Vec3, cell: FluidCell, changed: Vec3[]): void {
    const amount = cell.falling ? 7 : cell.amount - dropOff(cell.kind)
    if (amount <= 0) return
    for (const [next, liquid] of this.spreadTargets(pos, cell.kind)) {
      if (liquid && this.canSpreadTo(next)) this.put(next, liquid, changed)
    }
  }

  /** 液体を置く。設計図の外は数えない */
  private put(pos: Vec3, cell: FluidCell, changed: Vec3[]): void {
    if (!this.inside(pos)) return
    this.cells.set(key(pos), cell)
    changed.push(pos)
  }

  /** 1マスを調べ直す（FlowingFluid.tick） */
  private tick(pos: Vec3, changed: Vec3[]): void {
    const k = key(pos)
    let cell = this.at(pos)
    /* v8 ignore next -- 調べ直す順番に入れるのは液体のあるマスだけで、液体が消えるのは自分のマスを調べ直すときだけ */
    if (!cell) return
    // 水源（水浸しのブロック・泡の柱を含む）は変わらず、広がるだけ
    if (!cell.source) {
      const next = this.newLiquid(pos, cell.kind)
      if (!sameCell(next, cell)) {
        if (next) this.cells.set(k, next)
        else this.cells.delete(k)
        changed.push(pos)
        cell = next
      }
    }
    if (cell) this.spread(pos, cell, changed)
  }

  /** 落ち着くまで調べ直す。変わったマスの近く（横に5・上下に2）だけをもう一度調べる */
  private spreadAll(limit: number): boolean {
    const queue: Vec3[] = []
    const queued = new Set<string>()
    const enqueue = (p: Vec3): void => {
      const k = key(p)
      if (queued.has(k) || this.at(p) === null) return
      queued.add(k)
      queue.push(p)
    }
    for (const p of this.starts) enqueue(p)
    let ticks = 0
    for (let i = 0; i < queue.length; i++) {
      if (ticks++ >= limit) return false
      const pos = queue[i]
      queued.delete(key(pos))
      const changed: Vec3[] = []
      this.tick(pos, changed)
      for (const c of changed) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            for (let dz = -5 + Math.abs(dx); dz <= 5 - Math.abs(dx); dz++) enqueue([c[0] + dx, c[1] + dy, c[2] + dz])
          }
        }
      }
    }
    return true
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len < 1e-4 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len]
}

// 設計図の大きさを変える操作（docs/design.md「設計図の大きさを変える（#191）」）。Blueprint は変えず、操作（EditCommand）だけを返す。
// 6方向に広げる・縮める、余白を詰める、置くツールで枠の外へ置くときに広げる、の3つ。
// どれも最小の角が 0 からずれたら全体の座標をずらし、選択範囲と仮の入出力も一緒にずらす（relocation）。

import type { BlockState } from '../domain/blockState'
import { translation } from '../domain/blockTransform'
import type { Blueprint } from '../domain/blueprint'
import { EMPTY_CELL, type BlockVolume, type CellValue } from '../domain/blockVolume'
import { boxContains, forEachInBox, type Box } from '../domain/box'
import { addVec3, subVec3, type Vec3 } from '../domain/vec3'
import type { CellChange, EditCommand, EntityChange, RegionResize } from './editCommand'
import { boxesOverlap, entityBlockPos, MAX_BLUEPRINT_SIDE, moveEntity, regionBox, sameVec3, shiftMessage } from './regionTransform'

/** 6方向に足すマス数。min は負の向き（x−・y−・z−）、max は正の向き（x+・y+・z+）。マイナスで縮める */
export interface RegionGrow {
  readonly min: Vec3
  readonly max: Vec3
}

/** 断る理由（そのまま画面に出す） */
export const RESIZE_MESSAGES = {
  tooSmall: '各辺は 1 以上にしてください',
  tooLarge: `各辺は ${MAX_BLUEPRINT_SIDE} 以下にしてください`,
  overlapsRegion: '変えるとほかのリージョンに重なります。ほかのリージョンと離れる大きさにしてください',
  placeTooLarge: `設計図が各辺 ${MAX_BLUEPRINT_SIDE} を超えるので、ここには置けません`,
  placeOverlaps: 'ここに置くとほかのリージョンに重なるので置けません',
  noRegion: 'リージョンがありません',
} as const

/** 大きさを変える操作と、その中身の数 */
export interface ResizePlan {
  readonly command: EditCommand
  /** 変えたあとの、変えたリージョンの大きさ */
  readonly sizes: ReadonlyMap<number, Vec3>
  /** 縮めて消えるブロックの数 */
  readonly removedBlocks: number
  /** 縮めて消えるエンティティの数 */
  readonly removedEntities: number
  /** 設計図全体の座標のずれ */
  readonly shift: Vec3
  /** 状態表示に出す知らせ（座標がずれたとき） */
  readonly warnings: readonly string[]
}

function boxSize(box: Box): Vec3 {
  return [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1]
}

function sameBox(a: Box, b: Box): boolean {
  return sameVec3(a.min, b.min) && sameVec3(a.max, b.max)
}

/**
 * リージョンを next（今の座標の箱）に変える操作を作る。next にないリージョンはそのまま。
 * 縮めて外に出るブロックは cleared、外に出るエンティティは除く。変わらなければ null、変えられなければ断る理由
 */
function reshape(
  bp: Blueprint,
  next: ReadonlyMap<number, Box>,
  label: (removed: number) => string,
  messages: { readonly tooLarge: string; readonly overlaps: string },
): ResizePlan | string | null {
  const after = bp.regions.map((r, i) => next.get(i) ?? regionBox(r))
  for (const [i, box] of next) {
    const size = boxSize(box)
    if (size.some((n) => n < 1)) return RESIZE_MESSAGES.tooSmall
    if (size.some((n) => n > MAX_BLUEPRINT_SIDE)) return messages.tooLarge
    if (after.some((other, j) => j !== i && boxesOverlap(other, box))) return messages.overlaps
  }
  // 全体のずれ。最小の角を 0 にそろえる（縮めたときは負の向きにずれることもある）
  const shift: Vec3 = [0, 1, 2].map((a) => 0 - Math.min(...after.map((b) => b.min[a]!)) || 0) as unknown as Vec3

  const resize: RegionResize[] = []
  const cleared: CellChange[] = []
  const entities: EntityChange[] = []
  const sizes = new Map<number, Vec3>()
  let removedEntities = 0
  bp.regions.forEach((region, i) => {
    const before = regionBox(region)
    const box = after[i]!
    const afterOffset = addVec3(box.min, shift)
    if (sameVec3(region.offset, afterOffset) && sameBox(before, box)) return
    resize.push({
      region: i,
      before: { offset: region.offset, size: region.size },
      after: { offset: afterOffset, size: boxSize(box) },
      shift,
    })
    if (next.has(i)) sizes.set(i, boxSize(box))
    // 箱の外に出るマスのブロック（変える前の座標）
    forEachInBox(before, (pos) => {
      if (boxContains(box, pos)) return
      const cell = cellIn(region, pos)
      if (cell.state !== null) cleared.push({ pos, before: cell, after: EMPTY_CELL })
    })
    // エンティティ（リージョンの中の座標で持つ）。箱の外のものは除き、残りは中身のずれの分だけ動かす
    const contentShift = subVec3(addVec3(region.offset, shift), afterOffset)
    let changed = false
    const kept = region.entities.flatMap((e) => {
      const local = entityBlockPos(e)
      if (local !== null && !boxContains(box, addVec3(local, region.offset))) {
        changed = true
        removedEntities++
        return []
      }
      if (sameVec3(contentShift, [0, 0, 0])) return [e]
      changed = true
      return [moveEntity(e, contentShift)]
    })
    if (changed) entities.push({ region: i, before: region.entities, after: kept })
  })
  if (resize.length === 0) return null

  const moved = !sameVec3(shift, [0, 0, 0])
  const target = after[[...next.keys()][0] ?? 0]!
  const command: EditCommand = {
    label: label(cleared.length),
    changes: [],
    ...(cleared.length > 0 ? { cleared } : {}),
    resize,
    ...(entities.length > 0 ? { entities } : {}),
    ...(moved
      ? {
          relocation: {
            source: null,
            target: { min: addVec3(target.min, shift), max: addVec3(target.max, shift) },
            transform: translation([0, 0, 0]),
            shift,
            keepSelection: true,
          },
        }
      : {}),
  }
  return { command, sizes, removedBlocks: cleared.length, removedEntities, shift, warnings: moved ? [shiftMessage(shift)] : [] }
}

function cellIn(region: BlockVolume, pos: Vec3): CellValue {
  const o = region.offset
  return region.cellAt(pos[0] - o[0], pos[1] - o[1], pos[2] - o[2]) ?? EMPTY_CELL
}

const RESIZE_LIMITS = { tooLarge: RESIZE_MESSAGES.tooLarge, overlaps: RESIZE_MESSAGES.overlapsRegion }

/** リージョン regionIndex を、6方向に grow だけ広げる（マイナスで縮める）。変わらなければ null、変えられなければ断る理由 */
export function resizeRegion(bp: Blueprint, regionIndex: number, grow: RegionGrow): ResizePlan | string | null {
  const region = bp.regions[regionIndex]
  if (!region) return RESIZE_MESSAGES.noRegion
  const box = regionBox(region)
  const next: Box = { min: subVec3(box.min, grow.min), max: addVec3(box.max, grow.max) }
  return reshape(bp, new Map([[regionIndex, next]]), (removed) => (removed > 0 ? `大きさを変える（${removed} 個消す）` : '大きさを変える'), RESIZE_LIMITS)
}

/** リージョンの中の、ブロックとエンティティが入る一番小さい箱（今の座標）。何もなければ最小の角の 1×1×1 */
function contentBox(region: BlockVolume): Box {
  const o = region.offset
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const add = (x: number, y: number, z: number): void => {
    const p = [x, y, z]
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, p[a]!)
      max[a] = Math.max(max[a]!, p[a]!)
    }
  }
  region.forEachBlock((x, y, z) => add(x, y, z))
  for (const e of region.entities) {
    const p = entityBlockPos(e)
    // リージョンの外にはみ出したエンティティは、箱を広げない
    if (p && p.every((v, a) => v >= 0 && v < region.size[a]!)) add(p[0], p[1], p[2])
  }
  if (min[0] === Infinity) return { min: o, max: o }
  return { min: addVec3(o, min as unknown as Vec3), max: addVec3(o, max as unknown as Vec3) }
}

/** 各リージョンを、ブロックとエンティティが入る一番小さい箱に縮める（余白を詰める）。詰める所がなければ null */
export function trimRegions(bp: Blueprint): ResizePlan | null {
  const next = new Map(bp.regions.map((r, i) => [i, contentBox(r)] as const))
  const plan = reshape(bp, next, () => '余白を詰める', RESIZE_LIMITS)
  // 縮めるだけなので、断ることはない
  return typeof plan === 'string' ? null : plan
}

/**
 * 置くツールで枠の外へ置く操作（#191）。cells が入るように、リージョン regionIndex を広げてから置く。
 * cells の pos は今の座標。枠の外のマスは空きなので、置き換えは考えない
 */
export function placeGrowing(
  bp: Blueprint,
  regionIndex: number,
  cells: readonly { readonly pos: Vec3; readonly state: BlockState }[],
): ResizePlan | string | null {
  const region = bp.regions[regionIndex]
  if (!region || cells.length === 0) return region ? null : RESIZE_MESSAGES.noRegion
  const box = regionBox(region)
  const min = [...box.min]
  const max = [...box.max]
  for (const { pos } of cells) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, pos[a]!)
      max[a] = Math.max(max[a]!, pos[a]!)
    }
  }
  const grown: Box = { min: min as unknown as Vec3, max: max as unknown as Vec3 }
  const name = cells[0]!.state.id.path
  const plan = reshape(bp, new Map([[regionIndex, grown]]), () => (cells.length > 1 ? `${name} を置く（${cells.length} 個）` : `${name} を置く`), {
    tooLarge: RESIZE_MESSAGES.placeTooLarge,
    overlaps: RESIZE_MESSAGES.placeOverlaps,
  })
  if (plan === null || typeof plan === 'string') return plan
  const changes: CellChange[] = cells.map(({ pos, state }) => {
    const loc = bp.locate(pos)
    const before = loc ? (loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2]) ?? EMPTY_CELL) : EMPTY_CELL
    return { pos: addVec3(pos, plan.shift), before, after: { state, blockEntity: null } }
  })
  return { ...plan, command: { ...plan.command, changes } }
}

/**
 * pos（今の座標）を入れるリージョン。pos を含むリージョン、なければ pos から1マス以内に枠があるリージョンのうち最初のもの。
 * どれもなければ -1
 */
export function regionToGrow(bp: Blueprint, pos: Vec3): number {
  const within = (margin: number) =>
    bp.regions.findIndex((r) => {
      const box = regionBox(r)
      return [0, 1, 2].every((a) => pos[a]! >= box.min[a]! - margin && pos[a]! <= box.max[a]! + margin)
    })
  const inside = within(0)
  return inside >= 0 ? inside : within(1)
}

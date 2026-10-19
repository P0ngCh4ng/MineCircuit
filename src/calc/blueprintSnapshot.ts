// 設計図を Web Worker へ送るための写し。
// Blueprint / BlockVolume / BlockState はクラスなので、postMessage（structured clone）で送るとメソッドが消える。
// 素のデータ（文字列・配列・Map・型付き配列）に直して送り、Worker の中で組み立て直す。
// 生データ（RawNbt）は Map と bigint と型付き配列でできているので、そのまま送れる。

import { BlockState } from '../domain/blockState'
import { Blueprint, type BlueprintFormat, type BlueprintMeta } from '../domain/blueprint'
import { BlockVolume, type RawEntity } from '../domain/blockVolume'
import type { RawNbt } from '../domain/nbt'
import { ResourceLocation } from '../domain/resourceLocation'
import type { Vec3 } from '../domain/vec3'

export interface BlockStateSnapshot {
  readonly id: string
  readonly properties: Readonly<Record<string, string>>
}

export interface BlockVolumeSnapshot {
  readonly name: string
  readonly offset: Vec3
  readonly size: Vec3
  readonly palette: readonly BlockStateSnapshot[]
  readonly cells: Int32Array
  readonly blockEntities: ReadonlyMap<number, RawNbt>
  readonly entities: readonly RawEntity[]
  readonly extra: RawNbt
}

export interface BlueprintSnapshot {
  readonly name: string
  readonly format: BlueprintFormat
  readonly dataVersion: number
  readonly regions: readonly BlockVolumeSnapshot[]
  readonly meta: BlueprintMeta
}

/**
 * 設計図の写しを作る。セルの配列は写すので、送ったあとに編集しても写しは変わらない。
 * 生データは写さずに同じものを指す（postMessage で写される）。
 */
export function toSnapshot(bp: Blueprint): BlueprintSnapshot {
  return {
    name: bp.name,
    format: bp.format,
    dataVersion: bp.dataVersion,
    meta: { ...bp.meta },
    regions: bp.regions.map((r) => volumeSnapshot(r)),
  }
}

/** 写しから設計図を組み立て直す */
export function fromSnapshot(s: BlueprintSnapshot): Blueprint {
  const regions = s.regions.map(
    (r) =>
      new BlockVolume({
        name: r.name,
        offset: r.offset,
        size: r.size,
        palette: r.palette.map((p) => new BlockState(ResourceLocation.parse(p.id), p.properties)),
        cells: r.cells,
        blockEntities: r.blockEntities,
        entities: r.entities,
        extra: r.extra,
      }),
  )
  return new Blueprint(s.name, s.format, s.dataVersion, regions, s.meta)
}

function volumeSnapshot(r: BlockVolume): BlockVolumeSnapshot {
  const [sx, sy, sz] = r.size
  const cells = new Int32Array(sx * sy * sz).fill(-1)
  const blockEntities = new Map<number, RawNbt>()
  // パレットはそのまま写し、番号を変えない
  const index = new Map<BlockState, number>()
  r.palette.forEach((state, i) => {
    if (!index.has(state)) index.set(state, i)
  })
  let i = 0
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++, i++) {
        const cell = r.cellAt(x, y, z)
        if (!cell?.state) continue
        cells[i] = index.get(cell.state) ?? r.palette.findIndex((p) => p.key === cell.state?.key)
        if (cell.blockEntity) blockEntities.set(i, cell.blockEntity)
      }
    }
  }
  return {
    name: r.name,
    offset: [r.offset[0], r.offset[1], r.offset[2]],
    size: [sx, sy, sz],
    palette: r.palette.map((p) => ({ id: p.id.toString(), properties: { ...p.properties } })),
    cells,
    blockEntities,
    entities: r.entities,
    extra: r.extra,
  }
}

import type { BlockState } from './blockState'
import type { BlockVolume } from './blockVolume'
import { directionVector, type Direction } from './direction'
import type { RawNbt } from './nbt'
import { addVec3, subVec3, type Vec3 } from './vec3'

/** 設計図ファイルの形式 */
export type BlueprintFormat = 'nbt' | 'schem' | 'litematic'

/** 作者・説明など。ない形式は空 */
export interface BlueprintMeta {
  author?: string
  description?: string
  createdAt?: Date
}

/** 設計図全体の座標が、どのリージョンのどの位置にあたるか */
export interface RegionLocation {
  region: BlockVolume
  /** リージョンの中の座標 */
  local: Vec3
}

/**
 * 設計図ファイル1つ分。ファイルの情報と中身を持つ。
 * 座標は設計図全体のもので、y が上下（段）。各リージョンは offset の位置に置かれる。
 * offset は 0 以上にそろえておく（読み込みで正規化する）。
 * リージョンが重なる位置では、配列で先にあるリージョンを優先する。
 */
export class Blueprint {
  constructor(
    /** ファイル名 */
    readonly name: string,
    readonly format: BlueprintFormat,
    /** Minecraft のバージョン判定に使う。2975 = 1.18.2 */
    readonly dataVersion: number,
    /** .nbt と .schem は1つ、.litematic は複数ありうる */
    readonly regions: readonly BlockVolume[],
    readonly meta: BlueprintMeta = {},
  ) {}

  /** 全リージョンを合わせた大きさ。原点 [0, 0, 0] から一番遠い角まで */
  get size(): Vec3 {
    const max = [0, 0, 0]
    for (const r of this.regions) {
      for (let a = 0; a < 3; a++) max[a] = Math.max(max[a], r.offset[a] + r.size[a])
    }
    return [max[0], max[1], max[2]]
  }

  /** 置かれているブロックの namespace の一覧。足りない Mod の検出に使う */
  get namespaces(): Set<string> {
    const result = new Set<string>()
    for (const r of this.regions) {
      // パレットに残っているだけで使われていない状態は数えない
      const used = new Set<BlockState>()
      r.forEachBlock((_x, _y, _z, state) => used.add(state))
      for (const state of used) result.add(state.id.namespace)
    }
    return result
  }

  /**
   * 設計図全体の座標 pos が、どのリージョンのどの位置にあたるか。どのリージョンにもなければ null。
   * edit 層が setCell を呼ぶときに使う。
   */
  locate(pos: Vec3): RegionLocation | null {
    for (const region of this.regions) {
      const local = subVec3(pos, region.offset)
      if (region.contains(local[0], local[1], local[2])) return { region, local }
    }
    return null
  }

  /** pos のブロック状態。空きと範囲外は null */
  get(pos: Vec3): BlockState | null {
    const loc = this.locate(pos)
    return loc ? loc.region.get(loc.local[0], loc.local[1], loc.local[2]) : null
  }

  /** pos のブロックエンティティの生データ。ないときと範囲外は null */
  blockEntityAt(pos: Vec3): RawNbt | null {
    const loc = this.locate(pos)
    return loc ? loc.region.blockEntityAt(loc.local[0], loc.local[1], loc.local[2]) : null
  }

  /** pos から dir の向きに1つ隣のブロック状態。空きと範囲外は null */
  neighbor(pos: Vec3, dir: Direction): BlockState | null {
    return this.get(addVec3(pos, directionVector(dir)))
  }

  /**
   * 段 y（0 始まり）にある、空きでないブロックを順に渡す。pos は設計図全体の座標。
   * 並びはリージョンの順、その中で z、x の順。重なる位置は先のリージョンだけを渡す。
   */
  forEachInLayer(y: number, fn: (pos: Vec3, state: BlockState) => void): void {
    this.regions.forEach((region, ri) => {
      const ly = y - region.offset[1]
      if (ly < 0 || ly >= region.size[1]) return
      for (let lz = 0; lz < region.size[2]; lz++) {
        for (let lx = 0; lx < region.size[0]; lx++) {
          const state = region.get(lx, ly, lz)
          if (!state) continue
          const pos = addVec3([lx, ly, lz], region.offset)
          if (ri > 0 && this.locate(pos)?.region !== region) continue
          fn(pos, state)
        }
      }
    })
  }
}

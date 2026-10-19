import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { RawNbt } from '../../domain/nbt'
import { nbtEquals } from '../nbt/nbtEquals'
import { isAir } from '../readers/nbtBlueprintReader'

/** 違いを書き出す数の上限。これより多いときは件数だけ足す */
const MAX_REPORTED = 5

/**
 * 書き出す前の設計図（expected）と、書き出したファイルを読み直した設計図（actual）を比べ、
 * 違うところを日本語の文で返す。同じなら空の配列。
 *
 * 比べるもの: DataVersion、リージョンの数・名前・大きさ、全マスの状態と生データ、
 * エンティティ、知らない項目（extra）、palettes 形式の別のパレットの数。
 * パレットの並びと、使われていない状態は比べない（書き出しで作り直すため）。
 * 空気は置かれていないものとして比べる（読み込みが空気を空きにするため）。
 */
export function compareBlueprints(expected: Blueprint, actual: Blueprint): string[] {
  const diffs: string[] = []
  if (expected.dataVersion !== actual.dataVersion) {
    diffs.push(`DataVersion が ${expected.dataVersion} から ${actual.dataVersion} に変わりました。`)
  }
  if (expected.regions.length !== actual.regions.length) {
    diffs.push(`リージョンの数が ${expected.regions.length} から ${actual.regions.length} に変わりました。`)
    return diffs
  }

  expected.regions.forEach((before, r) => {
    const after = actual.regions[r]
    const label = expected.regions.length > 1 ? `リージョン "${before.name}" の` : ''
    if (before.size.some((n, a) => n !== after.size[a])) {
      diffs.push(`${label}大きさが [${before.size.join(', ')}] から [${after.size.join(', ')}] に変わりました。`)
      return
    }

    const cellDiffs: string[] = []
    const [sx, sy, sz] = before.size
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const a = before.cellAt(x, y, z)
          const b = after.cellAt(x, y, z)
          const stateA = solid(a?.state ?? null)
          const stateB = solid(b?.state ?? null)
          const where = `${label}[${x}, ${y}, ${z}]`
          if (stateA?.key !== stateB?.key) {
            cellDiffs.push(`${where} のブロックが ${stateA?.key ?? '空き'} から ${stateB?.key ?? '空き'} に変わりました。`)
          } else if (stateA && !sameRaw(a?.blockEntity ?? null, b?.blockEntity ?? null)) {
            cellDiffs.push(`${where} の生データ（nbt）が変わりました。`)
          }
        }
      }
    }
    pushLimited(diffs, cellDiffs, `${label}ブロック`)

    if (before.entities.length !== after.entities.length) {
      diffs.push(`${label}エンティティの数が ${before.entities.length} から ${after.entities.length} に変わりました。`)
    } else {
      const changed = before.entities.filter((e, i) => !nbtEquals(e, after.entities[i])).length
      if (changed > 0) diffs.push(`${label}エンティティ ${changed} 個の中身が変わりました。`)
    }

    for (const key of new Set([...before.extra.value.keys(), ...after.extra.value.keys()])) {
      const va = before.extra.value.get(key)
      const vb = after.extra.value.get(key)
      if (va === undefined) diffs.push(`${label}知らない項目 ${key} が増えました。`)
      else if (vb === undefined) diffs.push(`${label}知らない項目 ${key} がなくなりました。`)
      else if (!nbtEquals(va, vb)) diffs.push(`${label}知らない項目 ${key} の中身が変わりました。`)
    }

    if (before.alternatePalettes.length !== after.alternatePalettes.length) {
      diffs.push(
        `${label}palettes の別のパレットの数が ${before.alternatePalettes.length} から ${after.alternatePalettes.length} に変わりました。`,
      )
    }
  })
  return diffs
}

function solid(state: BlockState | null): BlockState | null {
  return state && !isAir(state) ? state : null
}

function sameRaw(a: RawNbt | null, b: RawNbt | null): boolean {
  if (a === null || b === null) return a === b
  return nbtEquals(a, b)
}

function pushLimited(out: string[], items: readonly string[], what: string): void {
  out.push(...items.slice(0, MAX_REPORTED))
  if (items.length > MAX_REPORTED) out.push(`ほかにも${what}の違いが ${items.length - MAX_REPORTED} 個あります。`)
}

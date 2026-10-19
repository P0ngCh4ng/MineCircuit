// 新規の設計図（空の .nbt）を作る。docs/design.md「BlueprintWriter」。
// 新規の設計図は読み込んだファイルを持たないので、DataVersion は利用者が選んだ Minecraft のバージョンから決める。

import { BlockVolume } from './blockVolume'
import { Blueprint } from './blueprint'
import type { Vec3 } from './vec3'

/** 1辺の大きさの上限。大きすぎると表示と編集が重くなるため */
export const NEW_BLUEPRINT_MAX_SIDE = 256

/** 新規の設計図の材料 */
export interface NewBlueprintSpec {
  /** 名前。拡張子はなくてよい（"水車" → "水車.nbt"） */
  name: string
  /** 幅 × 高さ × 奥行き */
  size: Vec3
  /** 対象の Minecraft の DataVersion。0 以下は不可 */
  dataVersion: number
}

const AXIS_LABELS = ['幅', '高さ', '奥行き'] as const

/** 名前の前後の空白と .nbt を取り、ファイル名に使えない文字を _ にする */
export function normalizeBlueprintName(name: string): string {
  return name
    .trim()
    .replace(/\.nbt$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
}

/** spec の間違いを、画面に出せる日本語の文で返す。間違いがなければ空 */
export function validateNewBlueprint(spec: NewBlueprintSpec): string[] {
  const errors: string[] = []
  if (normalizeBlueprintName(spec.name) === '') errors.push('名前を入れてください。')
  spec.size.forEach((n, i) => {
    if (!Number.isInteger(n) || n < 1 || n > NEW_BLUEPRINT_MAX_SIDE) {
      errors.push(`${AXIS_LABELS[i]}は 1 から ${NEW_BLUEPRINT_MAX_SIDE} までの整数にしてください。`)
    }
  })
  if (!Number.isInteger(spec.dataVersion) || spec.dataVersion <= 0) {
    errors.push('Minecraft のバージョンを選んでください。')
  }
  return errors
}

/**
 * 空の設計図を作る。.nbt と同じく、リージョン "main" を1つ持つ。
 * spec が正しくなければ、validateNewBlueprint の文を並べた Error を投げる。
 */
export function createEmptyBlueprint(spec: NewBlueprintSpec): Blueprint {
  const errors = validateNewBlueprint(spec)
  if (errors.length > 0) throw new Error(errors.join(''))
  const region = new BlockVolume({ name: 'main', size: [spec.size[0], spec.size[1], spec.size[2]] })
  return new Blueprint(`${normalizeBlueprintName(spec.name)}.nbt`, 'nbt', spec.dataVersion, [region], {
    createdAt: new Date(),
  })
}

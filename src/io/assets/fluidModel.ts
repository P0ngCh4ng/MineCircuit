// 液体の見た目（docs/design.md「モデルの解決」の「液体」）。
// 水・溶岩・Mod の液体（Create の蜂蜜など）のモデルは、形がなく `particle` に `…_still` のテクスチャがあるだけで、
// ゲームでは液体の描画のコードが描く。ここでは still のテクスチャを貼った、高さのある箱にする。
// - 高さは level で決める（Minecraft と同じ）。0（湧き出る元）は 8/9、1〜7 は (8 - level)/9、8 以上（落ちる液体）は 1 ブロック
// - 隣の様子（上に同じ液体があれば 1 ブロックの高さ、流れる向き）は見ない
// - 水のテクスチャは灰色なので、決まった水の色（平原の青）を掛ける。バイオームの色は扱わない

import type { ModelElement, ModelFace, ResolvedModel, TextureId } from '../../domain/blockModel'
import { DIRECTIONS, type Direction } from '../../domain/direction'
import { tintedTextureId } from './textureAtlas'

/** 水に掛ける色（平原の水の色） */
export const WATER_COLOR = 0x3f76e4

/** 色を掛ける液体のテクスチャ → 色 */
const FLUID_TINTS: Readonly<Record<TextureId, number>> = {
  'minecraft:block/water_still': WATER_COLOR,
}

/** 液体のモデルの particle か（テクスチャのパスが `_still` で終わる） */
export function isFluidTexture(texture: TextureId): boolean {
  return /_still$/.test(texture)
}

/** 液体の高さ（0〜16）。level がなければ湧き出る元とみなす */
export function fluidHeight(level: string | undefined): number {
  const n = level === undefined ? 0 : Number(level)
  if (!Number.isInteger(n) || n <= 0) return (8 / 9) * 16
  if (n >= 8) return 16
  return ((8 - n) / 9) * 16
}

/** 液体の見た目のモデル。particle は液体の still のテクスチャ */
export function fluidModel(id: string, particle: TextureId, level: string | undefined): ResolvedModel {
  const height = fluidHeight(level)
  const texture = FLUID_TINTS[particle] !== undefined ? tintedTextureId(particle, FLUID_TINTS[particle]) : particle
  const face = (dir: Direction): ModelFace => ({
    texture,
    // 横の面は、高さの分だけテクスチャの下から使う
    uv: dir === 'up' || dir === 'down' ? [0, 0, 16, 16] : [0, 16 - height, 16, 16],
    rotation: 0,
    // 上の面は、1 ブロックの高さのときだけ上のブロックで隠す
    cullface: dir === 'up' && height < 16 ? null : dir,
    tintIndex: null,
  })
  const faces: Partial<Record<Direction, ModelFace>> = {}
  for (const d of DIRECTIONS) faces[d] = face(d)
  const element: ModelElement = { from: [0, 0, 0], to: [16, height, 16], rotation: null, shade: true, faces }
  return { id: `${id}#fluid`, elements: [element], meshes: [], ambientOcclusion: false }
}

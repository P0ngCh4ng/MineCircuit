// 形のないブロックの見た目（docs/design.md「モデルの解決」の「形のないブロック（#215）」）。
// チェストや Mod の多くの機械は、モデルに形がなく particle のテクスチャだけがあり、ゲームでは描画のコードが形を描く。
// 形はアプリに持たせず、particle のテクスチャを6面に貼った1ブロックの箱にする。

import type { ModelElement, ModelFace, ResolvedModel, TextureId } from '../../domain/blockModel'
import { DIRECTIONS, type Direction } from '../../domain/direction'

/** particle のテクスチャを6面に貼った箱。各面は隣の不透明なブロックで隠す */
export function particleBoxModel(id: string, particle: TextureId): ResolvedModel {
  const faces: Partial<Record<Direction, ModelFace>> = {}
  for (const d of DIRECTIONS) faces[d] = { texture: particle, uv: [0, 0, 16, 16], rotation: 0, cullface: d, tintIndex: null }
  const element: ModelElement = { from: [0, 0, 0], to: [16, 16, 16], rotation: null, shade: true, faces }
  return { id: `${id}#particle`, elements: [element], meshes: [], ambientOcclusion: true }
}

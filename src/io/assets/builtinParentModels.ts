// よく使うバニラの親モデル（block/cube_all など）を、コードで同じ形に組み立てる（#82）。
// Mod のモデルの多くは `"parent": "block/cube_all"` のようにバニラの親を使うが、バニラのモデルは Mod の jar にない。
// バニラのモデルファイルはアプリに入れない（docs/design.md「見た目」）。ここにあるのは
// 「全面が 0〜16 の立方体で、各面のテクスチャを変数で指す」という一般的な形と変数名の対応だけで、ファイルの写しではない。
// 利用者の資産（リソースパックや本体の jar）に同じ ID のモデルがあれば、そちらを先に使う。

import type { Direction } from '../../domain/direction'
import { DIRECTIONS } from '../../domain/direction'
import { defaultFaceUv, type UnbakedElement, type UnbakedFace, type UnbakedModel } from './modelJson'

/** 描けないモデル（コードで描くもの）。親をたどってここに来たら見た目は null */
export const UNDRAWABLE_BUILTIN_MODELS: readonly string[] = ['minecraft:builtin/generated', 'minecraft:builtin/entity']

// 全面が 0〜16 の立方体。各面は "#<向き>" の変数を指し、その向きに隣があれば描かない
function fullCube(): UnbakedElement {
  const faces: Partial<Record<Direction, UnbakedFace>> = {}
  for (const dir of DIRECTIONS) {
    faces[dir] = { texture: `#${dir}`, uv: defaultFaceUv(dir, [0, 0, 0], [16, 16, 16]), rotation: 0, cullface: dir, tintIndex: null }
  }
  return { from: [0, 0, 0], to: [16, 16, 16], rotation: null, shade: true, faces }
}

function model(parent: string | null, textures: Record<string, string>, elements: UnbakedElement[] | null = null): UnbakedModel {
  return { parent, textures, elements, ambientOcclusion: null }
}

// 6面の変数を、上・下・北・南・西・東の順に別の変数へ向ける
function faceTextures(down: string, up: string, north: string, south: string, west: string, east: string, particle: string): Record<string, string> {
  return { particle, down, up, north, south, west, east }
}

const BUILTIN: Readonly<Record<string, () => UnbakedModel>> = {
  // 要素を持たない、すべてのブロックモデルの根
  'minecraft:block/block': () => model(null, {}),
  // 各面が #down / #up / #north … を指す立方体
  'minecraft:block/cube': () => model('minecraft:block/block', { particle: '#north' }, [fullCube()]),
  // 全面が #all
  'minecraft:block/cube_all': () => model('minecraft:block/cube', faceTextures('#all', '#all', '#all', '#all', '#all', '#all', '#all')),
  // 上下が #end、横が #side（柱、丸太）
  'minecraft:block/cube_column': () =>
    model('minecraft:block/cube', faceTextures('#end', '#end', '#side', '#side', '#side', '#side', '#side')),
  // 上が #top、下が #bottom、横が #side
  'minecraft:block/cube_bottom_top': () =>
    model('minecraft:block/cube', faceTextures('#bottom', '#top', '#side', '#side', '#side', '#side', '#side')),
  // 北が #front、上が #top、下が #bottom、ほかが #side（かまどのような正面のあるブロック）
  'minecraft:block/orientable_with_bottom': () =>
    model('minecraft:block/cube', faceTextures('#bottom', '#top', '#front', '#side', '#side', '#side', '#front')),
  // orientable_with_bottom の下を上と同じにしたもの
  'minecraft:block/orientable': () => model('minecraft:block/orientable_with_bottom', { bottom: '#top' }),
}

/** 内蔵の親モデルの ID の一覧 */
export const BUILTIN_PARENT_MODEL_IDS: readonly string[] = Object.keys(BUILTIN)

/** id（namespace 付き）が内蔵の親モデルなら、その形。なければ null */
export function builtinParentModel(id: string): UnbakedModel | null {
  return BUILTIN[id]?.() ?? null
}

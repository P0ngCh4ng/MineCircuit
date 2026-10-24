// モデルの JSON（assets/<ns>/models/<path>.json）を、親をたどる前の形（UnbakedModel）に読む（#82）。
// テクスチャの変数（#side）はまだ解決しない。解決は modelResolver が親までまとめてから行う。
// 形の分からない値は捨てずに既定値にし、notes に書く（モデル1つが壊れていても、ほかは描けるように）。

import type { Direction } from '../../domain/direction'
import { DIRECTIONS } from '../../domain/direction'
import type { ModelElementRotation, QuarterTurn } from '../../domain/blockModel'
import { DEFAULT_NAMESPACE } from '../../domain/resourceLocation'
import type { Vec3 } from '../../domain/vec3'
import type { JsonValue } from '../modpack/jarScanner'

/** テクスチャの変数を解決する前の面 */
export interface UnbakedFace {
  /** "#side" のような変数、または直接の ID */
  readonly texture: string
  readonly uv: readonly [number, number, number, number]
  readonly rotation: QuarterTurn
  readonly cullface: Direction | null
  readonly tintIndex: number | null
}

export interface UnbakedElement {
  readonly from: Vec3
  readonly to: Vec3
  readonly rotation: ModelElementRotation | null
  readonly shade: boolean
  readonly faces: Readonly<Partial<Record<Direction, UnbakedFace>>>
}

/** 親をたどる前のモデル1つ分 */
export interface UnbakedModel {
  /** 親のモデルの ID（namespace 付きにしてある）。なければ null */
  readonly parent: string | null
  /** テクスチャの変数。値は "#other" か、namespace 付きのテクスチャの ID */
  readonly textures: Readonly<Record<string, string>>
  /** 要素。モデルが elements を持たなければ null（親のものを使う） */
  readonly elements: readonly UnbakedElement[] | null
  /** ambientocclusion。書いてなければ null（親のものを使う） */
  readonly ambientOcclusion: boolean | null
  /** OBJ のモデル（`"loader": "forge:obj"`）なら、その .obj と flip-v。OBJ でなければ null（親のものを使う） */
  readonly obj: ObjModelRef | null
}

/** モデルの JSON に書いてある OBJ のファイル */
export interface ObjModelRef {
  /** `"model"` の値（`create:models/block/x.obj`）。namespace 付きにしてある */
  readonly model: string
  /** テクスチャの v を上下に返すか（`flip-v`、NeoForge は `flip_v`） */
  readonly flipV: boolean
}

/** OBJ の読み込みを指す loader（`forge:obj`・`neoforge:obj`・`porting_lib:obj` など） */
const OBJ_LOADER = /^([a-z0-9_.-]+:)?obj$/

type JsonObject = { [key: string]: JsonValue }

export function isJsonObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * ID に namespace を付ける。"block/cube_all" → "minecraft:block/cube_all"。
 * Minecraft と同じく、namespace がなければ minecraft とみなす
 */
export function withNamespace(id: string): string {
  const colon = id.indexOf(':')
  if (colon < 0) return `${DEFAULT_NAMESPACE}:${id}`
  if (colon === 0) return `${DEFAULT_NAMESPACE}${id}`
  return id
}

/** モデルの ID → 資産のパス。"create:block/shaft" → "assets/create/models/block/shaft.json" */
export function modelPath(modelId: string): string {
  const id = withNamespace(modelId)
  const colon = id.indexOf(':')
  return `assets/${id.slice(0, colon)}/models/${id.slice(colon + 1)}.json`
}

/** 0 / 90 / 180 / 270 に直す。それ以外の値は null */
export function quarterTurn(v: JsonValue | undefined): QuarterTurn | null {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isFinite(v) || v % 90 !== 0) return null
  return (((v % 360) + 360) % 360) as QuarterTurn
}

function vec3(v: JsonValue | undefined): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  const [x, y, z] = v
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  return [x, y, z]
}

/**
 * uv を書いていない面の uv。Minecraft と同じく、要素の大きさと面の向きから決める
 * （面に投影した範囲。16 から引くのは、テクスチャの v が下向きだから）
 */
export function defaultFaceUv(dir: Direction, from: Vec3, to: Vec3): readonly [number, number, number, number] {
  switch (dir) {
    case 'down':
      return [from[0], 16 - to[2], to[0], 16 - from[2]]
    case 'up':
      return [from[0], from[2], to[0], to[2]]
    case 'north':
      return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]]
    case 'south':
      return [from[0], 16 - to[1], to[0], 16 - from[1]]
    case 'west':
      return [from[2], 16 - to[1], to[2], 16 - from[1]]
    case 'east':
      return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]]
  }
}

function direction(v: JsonValue | undefined): Direction | null {
  if (typeof v !== 'string') return null
  if (v === 'bottom') return 'down' // 古い書き方
  return (DIRECTIONS as readonly string[]).includes(v) ? (v as Direction) : null
}

function parseFace(dir: Direction, json: JsonValue, from: Vec3, to: Vec3, note: (m: string) => void): UnbakedFace | null {
  if (!isJsonObject(json)) {
    note(`面 ${dir} の形が分かりません`)
    return null
  }
  if (typeof json.texture !== 'string' || json.texture === '') {
    note(`面 ${dir} にテクスチャがありません`)
    return null
  }
  let uv = defaultFaceUv(dir, from, to)
  if (json.uv !== undefined) {
    const u = json.uv
    if (Array.isArray(u) && u.length === 4 && u.every((n) => typeof n === 'number')) {
      uv = [u[0] as number, u[1] as number, u[2] as number, u[3] as number]
    } else {
      note(`面 ${dir} の uv が読めません。要素の大きさから決めます`)
    }
  }
  let rotation = quarterTurn(json.rotation)
  if (rotation === null) {
    note(`面 ${dir} の rotation ${JSON.stringify(json.rotation)} は 90 度単位ではありません。0 にします`)
    rotation = 0
  }
  const cullface = json.cullface === undefined ? null : direction(json.cullface)
  if (json.cullface !== undefined && cullface === null) note(`面 ${dir} の cullface ${JSON.stringify(json.cullface)} が分かりません`)
  const tint = json.tintindex
  const tintIndex = typeof tint === 'number' && Number.isInteger(tint) && tint >= 0 ? tint : null
  return { texture: json.texture, uv, rotation, cullface, tintIndex }
}

function parseRotation(json: JsonValue | undefined, note: (m: string) => void): ModelElementRotation | null {
  if (json === undefined || json === null) return null
  if (!isJsonObject(json)) {
    note('要素の rotation の形が分かりません。回さずに描きます')
    return null
  }
  const axis = json.axis
  const angle = json.angle
  if ((axis !== 'x' && axis !== 'y' && axis !== 'z') || typeof angle !== 'number') {
    note('要素の rotation の axis か angle が読めません。回さずに描きます')
    return null
  }
  return { origin: vec3(json.origin) ?? [8, 8, 8], axis, angle, rescale: json.rescale === true }
}

function parseElement(json: JsonValue, index: number, note: (m: string) => void): UnbakedElement | null {
  const at = (m: string): void => note(`要素 ${index + 1}: ${m}`)
  if (!isJsonObject(json)) {
    at('形が分からないので描きません')
    return null
  }
  const from = vec3(json.from)
  const to = vec3(json.to)
  if (!from || !to) {
    at('from か to が読めないので描きません')
    return null
  }
  const faces: Partial<Record<Direction, UnbakedFace>> = {}
  if (isJsonObject(json.faces)) {
    for (const [name, value] of Object.entries(json.faces)) {
      const dir = direction(name)
      if (!dir) {
        at(`面の向き "${name}" が分かりません`)
        continue
      }
      const face = parseFace(dir, value, from, to, at)
      if (face) faces[dir] = face
    }
  }
  return { from, to, rotation: parseRotation(json.rotation, at), shade: json.shade !== false, faces }
}

/**
 * モデルの JSON を読む。形の分からない部分は notes に書いて飛ばす。
 * モデル全体がオブジェクトでなければ null
 */
export function parseModelJson(json: JsonValue, note: (m: string) => void): UnbakedModel | null {
  if (!isJsonObject(json)) return null
  const parent = typeof json.parent === 'string' && json.parent !== '' ? withNamespace(json.parent) : null
  const textures: Record<string, string> = {}
  if (isJsonObject(json.textures)) {
    for (const [name, value] of Object.entries(json.textures)) {
      // 1.21.5 からは { "sprite": "..." } の形もある
      const v = typeof value === 'string' ? value : isJsonObject(value) && typeof value.sprite === 'string' ? value.sprite : null
      if (v === null || v === '') {
        note(`テクスチャの変数 "${name}" の値が読めません`)
        continue
      }
      textures[name] = v.startsWith('#') ? v : withNamespace(v)
    }
  }
  let elements: UnbakedElement[] | null = null
  if (Array.isArray(json.elements)) {
    elements = []
    json.elements.forEach((e, i) => {
      const element = parseElement(e, i, note)
      if (element) elements!.push(element)
    })
  }
  const ao = json.ambientocclusion
  return { parent, textures, elements, ambientOcclusion: typeof ao === 'boolean' ? ao : null, obj: parseObjRef(json, note) }
}

function parseObjRef(json: JsonObject, note: (m: string) => void): ObjModelRef | null {
  if (typeof json.loader !== 'string' || !OBJ_LOADER.test(json.loader)) return null
  if (typeof json.model !== 'string' || !json.model.toLowerCase().endsWith('.obj')) {
    note(`loader ${json.loader} の model（.obj のファイル）が書いてありません`)
    return null
  }
  const flip = json['flip-v'] ?? json.flip_v
  return { model: withNamespace(json.model), flipV: flip === true }
}

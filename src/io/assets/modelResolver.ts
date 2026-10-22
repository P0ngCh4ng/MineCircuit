// ブロック状態から、描くモデル（要素とテクスチャ）を確定する（#82）。
// 1. blockstates（assets/<ns>/blockstates/<path>.json）の variants / multipart から使うモデルを選ぶ（blockStateSelector）
// 2. モデルの parent をたどり、テクスチャの変数（#side）と要素を確定する
// 読むのは AssetReader だけ。jar をどう読むかは知らない。
// 結果はブロック状態ごと・モデルごとに覚えておき、同じものは2度読まない。

import type { BlockAppearance, ModelElement, ModelFace, PlacedModel, ResolvedModel, TextureId } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { Direction } from '../../domain/direction'
import type { ResourceLocation } from '../../domain/resourceLocation'
import { parseLenientJson, type JsonValue } from '../modpack/jarScanner'
import type { AssetReader } from './assetTypes'
import { selectModels } from './blockStateSelector'
import { builtinParentModel, UNDRAWABLE_BUILTIN_MODELS } from './builtinParentModels'
import { modelPath, parseModelJson, withNamespace, type UnbakedElement, type UnbakedModel } from './modelJson'

/**
 * テクスチャの変数が決まらなかった面に使う ID（Minecraft と同じ名前）。
 * 資産にはないので、アトラスでは見つからないテクスチャ（紫と黒）になる
 */
export const MISSING_TEXTURE: TextureId = 'minecraft:missingno'

/** 何もない見た目にするブロック。blockstates がなくても空にする */
const AIR_IDS: readonly string[] = ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']

/** 親をたどる深さの上限。これより深いものは循環とみなす */
const MAX_PARENT_DEPTH = 64

/** テクスチャの変数（#a → #b → ...）をたどる上限 */
const MAX_TEXTURE_HOPS = 32

type JsonFile = { readonly json: JsonValue } | 'missing' | 'invalid'

type RawModel = { readonly model: UnbakedModel } | 'missing' | 'invalid' | 'undrawable'

type ModelResult = { readonly model: ResolvedModel } | { readonly error: string }

/** ブロックの ID → blockstates のパス。create:shaft → assets/create/blockstates/shaft.json */
export function blockStatePath(id: ResourceLocation): string {
  return `assets/${id.namespace}/blockstates/${id.path}.json`
}

/**
 * ブロック状態 → 見た目。AppearanceProvider の中身として使う。
 * 見た目が分からないときは null を返し、理由を problems に書く（同じ内容は1回だけ）。
 */
export class ModelResolver {
  private readonly problemList: string[] = []
  private readonly problemSet = new Set<string>()
  private readonly byState = new Map<string, Promise<BlockAppearance | null>>()
  private readonly byModel = new Map<string, Promise<ModelResult>>()
  private readonly rawModels = new Map<string, Promise<RawModel>>()
  private readonly definitions = new Map<string, Promise<JsonFile>>()

  constructor(private readonly reader: AssetReader) {}

  /** これまでに見つかった問題（読めないファイル、決まらない変数など）。日本語で、そのまま画面に出せる */
  get problems(): readonly string[] {
    return this.problemList
  }

  /** 1つのブロック状態の見た目。分からなければ null */
  resolve(state: BlockState): Promise<BlockAppearance | null> {
    const key = state.key
    let p = this.byState.get(key)
    if (!p) {
      p = this.resolveState(state)
      this.byState.set(key, p)
    }
    return p
  }

  /** 複数のブロック状態の見た目。鍵は BlockState.key */
  async resolveAll(states: readonly BlockState[]): Promise<Record<string, BlockAppearance | null>> {
    const out: Record<string, BlockAppearance | null> = {}
    const results = await Promise.all(states.map((s) => this.resolve(s)))
    states.forEach((s, i) => {
      out[s.key] = results[i] ?? null
    })
    return out
  }

  /** モデル1つを、親をたどって確定する。描けなければ null（理由は problems） */
  async resolveModel(modelId: string): Promise<ResolvedModel | null> {
    const result = await this.bake(withNamespace(modelId))
    return 'model' in result ? result.model : null
  }

  private problem(message: string): void {
    if (this.problemSet.has(message)) return
    this.problemSet.add(message)
    this.problemList.push(message)
  }

  private async readJson(path: string): Promise<JsonFile> {
    let text: string | null
    try {
      text = await this.reader.readText(path)
    } catch (e) {
      this.problem(`${path} を読めませんでした（${e instanceof Error ? e.message : String(e)}）`)
      return 'invalid'
    }
    if (text === null) return 'missing'
    try {
      return { json: parseLenientJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as JsonValue }
    } catch {
      this.problem(`${path} は JSON として読めません。ファイルが壊れていないか確かめてください`)
      return 'invalid'
    }
  }

  private loadDefinition(id: ResourceLocation): Promise<JsonFile> {
    const key = id.toString()
    let p = this.definitions.get(key)
    if (!p) {
      const path = blockStatePath(id)
      p = this.readJson(path).then((file) => {
        if (file === 'missing') this.problem(`${key}: blockstates が見つかりません（${path}）。この Mod の jar が Modpack にあるか確かめてください`)
        return file
      })
      this.definitions.set(key, p)
    }
    return p
  }

  private async resolveState(state: BlockState): Promise<BlockAppearance | null> {
    const id = state.id.toString()
    if (AIR_IDS.includes(id)) return { parts: [] }
    const file = await this.loadDefinition(state.id)
    if (file === 'missing' || file === 'invalid') return null

    const key = state.key
    const selection = selectModels(file.json, state.properties)
    for (const note of selection.notes) this.problem(`${key}: ${note}`)
    if (selection.refs === null) return null

    const parts: PlacedModel[] = []
    const results = await Promise.all(selection.refs.map((ref) => this.bake(ref.model)))
    for (let i = 0; i < selection.refs.length; i++) {
      const ref = selection.refs[i]!
      const result = results[i]!
      if ('error' in result) return null // 理由はモデルの問題として書いてある
      parts.push({ model: result.model, x: ref.x, y: ref.y, uvlock: ref.uvlock })
    }
    if (parts.every((p) => p.model.elements.length === 0)) {
      // ゲームでは BlockEntityRenderer などのプログラムで描くブロック。箱で描いたほうが場所が分かる
      this.problem(`${key}: モデルに描く要素がありません（ゲームではプログラムで描くブロックです）`)
      return null
    }
    return { parts }
  }

  private loadRaw(id: string): Promise<RawModel> {
    let p = this.rawModels.get(id)
    if (!p) {
      p = this.readRaw(id)
      this.rawModels.set(id, p)
    }
    return p
  }

  private async readRaw(id: string): Promise<RawModel> {
    if (UNDRAWABLE_BUILTIN_MODELS.includes(id)) return 'undrawable'
    const path = modelPath(id)
    const file = await this.readJson(path)
    if (file === 'invalid') return 'invalid'
    if (file === 'missing') {
      // 利用者の資産になければ、よく使うバニラの親を内蔵の形で使う
      const builtin = builtinParentModel(id)
      return builtin ? { model: builtin } : 'missing'
    }
    const model = parseModelJson(file.json, (m) => this.problem(`モデル ${id}: ${m}`))
    if (!model) {
      this.problem(`モデル ${id}: 形が分かりません（${path}）`)
      return 'invalid'
    }
    return { model }
  }

  private bake(id: string): Promise<ModelResult> {
    let p = this.byModel.get(id)
    if (!p) {
      p = this.bakeModel(id).then((result) => {
        if ('error' in result) this.problem(result.error)
        return result
      })
      this.byModel.set(id, p)
    }
    return p
  }

  // 親をたどる。たどる途中の親を待つだけで、ほかのモデルの結果は待たない（循環しても止まらない）
  private async bakeModel(id: string): Promise<ModelResult> {
    const chain: UnbakedModel[] = []
    const visited: string[] = []
    let current: string | null = id
    while (current !== null) {
      if (visited.includes(current) || visited.length >= MAX_PARENT_DEPTH) {
        return { error: `モデル ${id}: 親モデルが循環しています（${[...visited, current].join(' → ')}）` }
      }
      visited.push(current)
      const raw: RawModel = await this.loadRaw(current)
      const via = current === id ? '' : `（${id} の親）`
      if (raw === 'undrawable') return { error: `モデル ${id}: ${current} はゲームのプログラムで描くモデルなので、描けません` }
      if (raw === 'missing') return { error: `モデル ${current}${via} が見つかりません（${modelPath(current)}）` }
      if (raw === 'invalid') return { error: `モデル ${current}${via} を読めません` }
      chain.push(raw.model)
      current = raw.model.parent
    }

    // 子が書いたものが優先。テクスチャの変数は根から順に上書きする
    const textures: Record<string, string> = {}
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i]!.textures)
    const elements = chain.find((m) => m.elements !== null)?.elements ?? []
    const ambientOcclusion = chain.find((m) => m.ambientOcclusion !== null)?.ambientOcclusion ?? true

    const missing = new Set<string>()
    const baked: ModelElement[] = elements.map((e) => this.bakeElement(e, textures, missing))
    for (const ref of missing) this.problem(`モデル ${id}: テクスチャの変数 ${ref} が決まっていません`)
    return { model: { id, elements: baked, ambientOcclusion } }
  }

  private bakeElement(element: UnbakedElement, textures: Readonly<Record<string, string>>, missing: Set<string>): ModelElement {
    const faces: Partial<Record<Direction, ModelFace>> = {}
    for (const [dir, face] of Object.entries(element.faces) as [Direction, NonNullable<UnbakedElement['faces'][Direction]>][]) {
      let texture = resolveTextureReference(face.texture, textures)
      if (texture === null) {
        missing.add(face.texture)
        texture = MISSING_TEXTURE
      }
      faces[dir] = { texture, uv: face.uv, rotation: face.rotation, cullface: face.cullface, tintIndex: face.tintIndex }
    }
    return { from: element.from, to: element.to, rotation: element.rotation, shade: element.shade, faces }
  }
}

/**
 * 面のテクスチャ（"#side"）を、変数をたどってテクスチャの ID にする。決まらなければ null。
 * "#" のない値も変数名として探し（Minecraft と同じ）、なければ ID（"create:block/x"）とみなす
 */
export function resolveTextureReference(reference: string, textures: Readonly<Record<string, string>>): TextureId | null {
  let current = reference
  for (let hop = 0; hop < MAX_TEXTURE_HOPS; hop++) {
    const isVariable = current.startsWith('#')
    const name = isVariable ? current.slice(1) : current
    const value = Object.hasOwn(textures, name) ? textures[name] : undefined
    if (value === undefined) {
      if (!isVariable && (name.includes(':') || name.includes('/'))) return withNamespace(name)
      return null
    }
    if (!value.startsWith('#')) return value
    current = value
  }
  return null // 変数が循環している
}

// BlueprintMeshBuilder：ブロックの種類ごとに InstancedMesh を作る。docs/design.md「view」。
// 同じ種類のブロックを1回の描画でまとめて描くので、ブロック数が多くても軽い。
//
// 段の表示方法はメッシュを作り直さずに切り替える（#10）。
// - 種類ごとに、普通のメッシュと半透明のメッシュを1つずつ作る。2つは置き場所（instanceMatrix）を共有する
// - どの段を描くかは、材質のクリッピング面（clippingPlanes）で決める。面の位置を変えるだけなので、段を動かしても軽い
// - 段ごとの非表示は、その段のブロックの大きさを 0 にして隠す（置き場所を書き直すだけ）
// - 検索の強調（#15）で薄くするブロックは別のまとまりにし、普通に描く段でも半透明の材質で描く
// - 見た目（AppearanceSet）が分かるブロックは、見た目と隠す面ごとにモデルの形を作り、アトラスのテクスチャで描く（#84）。
//   透明なところ（葉やガラス）はアルファで切り抜く。見た目が null のブロックは今までどおり色付きの箱

import * as THREE from 'three'
import type { BlockAppearance, TextureAtlas } from '../../domain/blockModel'
import type { LayerMode } from '../layers/layerDisplay'
import type { BlockInstanceGroup, LayerVisibilityOf } from './blockInstances'
import { buildModelGeometry, GRASS_TINT } from './modelGeometry'

/** ブロックの立方体の1辺。隣のブロックとの境目が見えるよう、1 より少し小さくする */
export const BLOCK_SIZE = 0.94

/** 半透明のブロックの不透明度 */
export const GHOST_OPACITY = 0.14

/** クリッピング面で「切らない」ときの位置。設計図より十分に遠い */
const FAR = 1e7

/** 作ったメッシュ1つ分の情報（テストや強調表示で使う） */
export interface BlockMeshInfo {
  readonly id: string
  readonly ghost: boolean
}

/** テクスチャで描くときの材質（アトラス1枚につき1組） */
interface ModelMaterials {
  readonly texture: THREE.DataTexture
  readonly solid: THREE.MeshLambertMaterial
  readonly ghost: THREE.MeshLambertMaterial
  readonly dim: THREE.MeshLambertMaterial
}

/** 透明なところを切り抜く境目（アルファ）。半透明の材質では不透明度を掛けたあとの値と比べる */
const ALPHA_CUTOFF = 0.5

/** 1種類のブロックの、普通のメッシュと半透明のメッシュ */
export interface BlockMeshPair {
  readonly group: BlockInstanceGroup
  readonly solid: THREE.InstancedMesh
  readonly ghost: THREE.InstancedMesh
}

/** build の結果 */
export interface BuiltBlocks {
  readonly root: THREE.Group
  readonly pairs: readonly BlockMeshPair[]
}

/**
 * 描く段の範囲（y、ブロックの下の面の高さ）。
 * 普通のメッシュは solidMin 〜 solidMax、半透明のメッシュは ghostMin より上を描く。
 * null は「その向きには切らない」。
 */
export interface LayerClip {
  readonly solidMin: number | null
  readonly solidMax: number | null
  readonly ghostMin: number | null
}

/**
 * ブロックのメッシュを作る。立方体の形と色ごとの材質は使い回し、dispose() でまとめて捨てる。
 * 作ったメッシュのまとまり（THREE.Group）は、要らなくなったら disposeMeshes() で捨てる。
 */
export class BlueprintMeshBuilder {
  private readonly geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
  private readonly solidMaterials = new Map<string, THREE.MeshLambertMaterial>()
  private readonly ghostMaterials = new Map<string, THREE.MeshLambertMaterial>()
  /** 薄くするブロックを、普通に描く段で描く材質（半透明で、クリッピングは普通と同じ） */
  private readonly dimMaterials = new Map<string, THREE.MeshLambertMaterial>()
  // クリッピング面はすべての材質で共有する。面の数を変えるとシェーダーを作り直すので、数は変えない
  // Plane は「法線との内積 + constant が負の側」を描かない
  private readonly solidBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), FAR)
  private readonly solidTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), FAR)
  private readonly ghostBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), FAR)
  private readonly solidPlanes = [this.solidBottom, this.solidTop]
  private readonly ghostPlanes = [this.ghostBottom]
  private currentClip: LayerClip = { solidMin: null, solidMax: null, ghostMin: null }
  private atlas: TextureAtlas | null = null
  private modelMaterials: ModelMaterials | null = null
  /** 見た目ごと・隠す面ごとの形。アトラスが変わったら捨てる */
  private readonly modelGeometries = new Map<BlockAppearance, Map<number, THREE.BufferGeometry>>()

  /**
   * テクスチャで描くときのアトラスを変える。前のテクスチャ・材質・モデルの形は捨てる。
   * build で作ったメッシュは古い材質を使っているので、このあと作り直すこと
   */
  setAtlas(atlas: TextureAtlas | null): void {
    if (atlas === this.atlas) return
    this.disposeModels()
    this.atlas = atlas
  }

  /** 種類ごとのまとまりから、InstancedMesh を並べた Group を作る。最初はすべての段を見せる */
  build(groups: readonly BlockInstanceGroup[]): BuiltBlocks {
    const root = new THREE.Group()
    root.name = 'blocks'
    const pairs: BlockMeshPair[] = []
    for (const g of groups) {
      if (g.positions.length === 0) continue
      const solid = this.solidMesh(g)
      const ghost = new THREE.InstancedMesh(solid.geometry, this.materialFor(g, 'ghost'), solid.count)
      // 置き場所は普通のメッシュと共有する（GPU へ送るのも1回で済む）
      ghost.instanceMatrix = solid.instanceMatrix
      ghost.userData = { id: g.id, ghost: true } satisfies BlockMeshInfo
      ghost.name = `${meshName(g)} (半透明)`
      ghost.boundingSphere = solid.boundingSphere
      ghost.boundingBox = solid.boundingBox
      // 半透明は不透明のあとに描く
      ghost.renderOrder = 1
      ghost.visible = false
      root.add(solid, ghost)
      pairs.push({ group: g, solid, ghost })
    }
    return { root, pairs }
  }

  /** 描く段の範囲を変える。すべての材質に効く */
  setClip(clip: LayerClip): void {
    this.currentClip = clip
    // 普通：y >= solidMin（y - solidMin >= 0）、y <= solidMax（solidMax - y >= 0）
    this.solidBottom.constant = clip.solidMin === null ? FAR : -clip.solidMin
    this.solidTop.constant = clip.solidMax === null ? FAR : clip.solidMax
    this.ghostBottom.constant = clip.ghostMin === null ? FAR : -clip.ghostMin
  }

  get clip(): LayerClip {
    return this.currentClip
  }

  /**
   * 隠す段のブロックの大きさを 0 にし、ほかは元の大きさに戻す。
   * hiddenOf(y) が true の段を隠す。置き場所を書き直すだけで、メッシュは作り直さない。
   */
  writeMatrices(pair: BlockMeshPair, hiddenOf: (y: number) => boolean): void {
    writeInstanceMatrices(pair.solid.instanceMatrix.array, pair.group.positions, hiddenOf)
    pair.solid.instanceMatrix.needsUpdate = true
  }

  /**
   * 段ごとの見え方に合わせて、メッシュの表示を切り替える（描くブロックが1つもないメッシュは描かない）。
   * 描いているメッシュの数を返す。
   */
  updateVisibility(pairs: readonly BlockMeshPair[], visibilityOf: LayerVisibilityOf): number {
    let meshes = 0
    for (const pair of pairs) {
      let solid = false
      let ghost = false
      for (const y of pair.group.layerCounts.keys()) {
        const v = visibilityOf(y)
        if (v === 'solid') solid = true
        else if (v === 'ghost') ghost = true
        if (solid && ghost) break
      }
      pair.solid.visible = solid
      pair.ghost.visible = ghost
      meshes += Number(solid) + Number(ghost)
    }
    return meshes
  }

  /** build で作った Group のメッシュを捨てる（形と材質は使い回すので残す） */
  disposeMeshes(root: THREE.Group): void {
    for (const child of root.children) {
      if (child instanceof THREE.InstancedMesh) child.dispose()
    }
    root.clear()
  }

  /** 形と材質を捨てる */
  dispose(): void {
    this.disposeModels()
    this.atlas = null
    this.geometry.dispose()
    for (const m of this.solidMaterials.values()) m.dispose()
    for (const m of this.ghostMaterials.values()) m.dispose()
    for (const m of this.dimMaterials.values()) m.dispose()
    this.solidMaterials.clear()
    this.ghostMaterials.clear()
    this.dimMaterials.clear()
  }

  private disposeModels(): void {
    for (const byMask of this.modelGeometries.values()) for (const g of byMask.values()) g.dispose()
    this.modelGeometries.clear()
    if (this.modelMaterials) {
      const { texture, solid, ghost, dim } = this.modelMaterials
      texture.dispose()
      solid.dispose()
      ghost.dispose()
      dim.dispose()
      this.modelMaterials = null
    }
  }

  /** テクスチャで描く材質。アトラスがなければ null */
  private modelMaterial(kind: 'solid' | 'ghost' | 'dim'): THREE.MeshLambertMaterial | null {
    const atlas = this.atlas
    if (!atlas) return null
    if (!this.modelMaterials) {
      // RGBA の上の行から。flipY なしで使うので、v は上が 0（modelGeometry.ts と同じ）
      const data = new Uint8Array(atlas.pixels.buffer, atlas.pixels.byteOffset, atlas.pixels.byteLength)
      const texture = new THREE.DataTexture(data, atlas.width, atlas.height, THREE.RGBAFormat)
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      const ghostLike = (planes: THREE.Plane[]) =>
        new THREE.MeshLambertMaterial({
          map: texture,
          vertexColors: true,
          transparent: true,
          opacity: GHOST_OPACITY,
          alphaTest: GHOST_OPACITY * ALPHA_CUTOFF,
          depthWrite: false,
          clippingPlanes: planes,
        })
      this.modelMaterials = {
        texture,
        solid: new THREE.MeshLambertMaterial({
          map: texture,
          vertexColors: true,
          alphaTest: ALPHA_CUTOFF,
          clippingPlanes: this.solidPlanes,
        }),
        ghost: ghostLike(this.ghostPlanes),
        dim: ghostLike(this.solidPlanes),
      }
    }
    return this.modelMaterials[kind]
  }

  /** 見た目と隠す面から、モデルの形を作る（同じものは使い回す） */
  private modelGeometry(appearance: BlockAppearance, cullMask: number, atlas: TextureAtlas): THREE.BufferGeometry {
    let byMask = this.modelGeometries.get(appearance)
    if (!byMask) {
      byMask = new Map()
      this.modelGeometries.set(appearance, byMask)
    }
    let geometry = byMask.get(cullMask)
    if (!geometry) {
      // 頂点の色は linear の値で渡す（Three.js の色の扱いに合わせる）
      const tint = new THREE.Color(GRASS_TINT)
      const data = buildModelGeometry(appearance, atlas, cullMask, [tint.r, tint.g, tint.b])
      geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
      byMask.set(cullMask, geometry)
    }
    return geometry
  }

  /** まとまりを描く形。見た目があり、アトラスもあればモデル、なければ立方体 */
  private geometryFor(g: BlockInstanceGroup): THREE.BufferGeometry {
    return g.appearance && this.atlas ? this.modelGeometry(g.appearance, g.cullMask, this.atlas) : this.geometry
  }

  private materialFor(g: BlockInstanceGroup, kind: 'solid' | 'ghost' | 'dim'): THREE.MeshLambertMaterial {
    return (g.appearance ? this.modelMaterial(kind) : null) ?? this.material(g.id, g.color, kind)
  }

  private material(id: string, color: number, kind: 'solid' | 'ghost' | 'dim'): THREE.MeshLambertMaterial {
    const cache = kind === 'solid' ? this.solidMaterials : kind === 'ghost' ? this.ghostMaterials : this.dimMaterials
    let m = cache.get(id)
    if (!m) {
      m =
        kind === 'solid'
          ? new THREE.MeshLambertMaterial({ color, clippingPlanes: this.solidPlanes })
          : new THREE.MeshLambertMaterial({
              color,
              transparent: true,
              opacity: GHOST_OPACITY,
              depthWrite: false,
              clippingPlanes: kind === 'ghost' ? this.ghostPlanes : this.solidPlanes,
            })
      cache.set(id, m)
    }
    return m
  }

  private solidMesh(g: BlockInstanceGroup): THREE.InstancedMesh {
    const count = g.positions.length / 3
    const mesh = new THREE.InstancedMesh(this.geometryFor(g), this.materialFor(g, g.dimmed ? 'dim' : 'solid'), count)
    mesh.userData = { id: g.id, ghost: g.dimmed } satisfies BlockMeshInfo
    const name = meshName(g)
    mesh.name = g.dimmed ? `${name} (薄く)` : name
    // 薄くするブロックは半透明なので、不透明のあとに描く
    if (g.dimmed) mesh.renderOrder = 1
    writeInstanceMatrices(mesh.instanceMatrix.array, g.positions, () => false)
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
    return mesh
  }
}

/** メッシュの名前。色付きの箱は ID、モデルはブロック状態の key（隠す面があれば、その印も） */
function meshName(g: BlockInstanceGroup): string {
  if (g.stateKey === null) return g.id
  return g.cullMask !== 0 ? `${g.stateKey} (隠す面 ${g.cullMask})` : g.stateKey
}

/** 置き場所の行列を書く。行列は平行移動と大きさだけなので、配列に直接書く（Matrix4 を作るより速い） */
function writeInstanceMatrices(m: THREE.TypedArray, positions: readonly number[], hiddenOf: (y: number) => boolean): void {
  const count = positions.length / 3
  for (let i = 0; i < count; i++) {
    const o = i * 16
    const y = positions[i * 3 + 1]
    const s = hiddenOf(y) ? 0 : 1
    m[o] = s
    m[o + 5] = s
    m[o + 10] = s
    m[o + 15] = 1
    // ブロック p は [p, p+1) の立方体なので、中心は p + 0.5
    m[o + 12] = positions[i * 3] + 0.5
    m[o + 13] = y + 0.5
    m[o + 14] = positions[i * 3 + 2] + 0.5
  }
}

/** 段の表示方法から、描く段の範囲を決める。境目はブロックとブロックの隙間に置く */
export function layerClipFor(mode: LayerMode, layer: number): LayerClip {
  switch (mode) {
    case 'all':
      return { solidMin: null, solidMax: null, ghostMin: null }
    case 'hideAbove':
      return { solidMin: null, solidMax: layer + 1, ghostMin: null }
    case 'ghostAbove':
      return { solidMin: null, solidMax: layer + 1, ghostMin: layer + 1 }
    case 'only':
      return { solidMin: layer, solidMax: layer + 1, ghostMin: null }
  }
}

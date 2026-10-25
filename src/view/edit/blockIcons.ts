// 置くブロックの棚のアイコン（docs/design.md「ブロックのアイコン」）。
// ブロックの見た目（BlockAppearance）を、斜め上から見た平行投影で小さな画像にする。
// - IconRasterizer：1つの見た目を画像（data URL）にする。WebGL を使うものは createWebGlIconRasterizer
// - BlockIconLoader：状態の一覧を受け取り、provider で見た目を用意して、少しずつ画像にする

import * as THREE from 'three'
import type { AppearanceSet, BlockAppearance, TextureAtlas } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { AppearanceProvider } from '../../io/assets/assetTypes'
import { buildModelGeometry } from '../viewport/modelGeometry'

/** 見た目を画像にするもの */
export interface IconRasterizer {
  /** 画像の data URL。描くものがなければ null */
  draw(appearance: BlockAppearance, atlas: TextureAtlas): string | null
  dispose(): void
}

/** アイコンの大きさ（画素） */
export const ICON_SIZE = 64

/** 透明なところを切り抜く境目（3D 表示と同じ） */
const ALPHA_CUTOFF = 0.5

/**
 * WebGL でアイコンを描くもの。画面に出さない canvas を1つ使い回す。WebGL が使えなければ null
 */
export function createWebGlIconRasterizer(size = ICON_SIZE): IconRasterizer | null {
  let renderer: THREE.WebGLRenderer
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  } catch {
    return null
  }
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6a62, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  // ゲームのインベントリと同じく、上が明るく、左の面が右の面より明るい
  sun.position.set(-0.6, 1, 0.8)
  scene.add(sun)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  // 南西の上から見る（ゲームのインベントリのブロックと同じ向き）
  camera.position.set(-10, 8.2, 10)
  camera.lookAt(0, 0, 0)

  /** アトラスごとの材質。AppearanceSet が変わったら作り直す */
  let current: { atlas: TextureAtlas; texture: THREE.DataTexture; material: THREE.MeshLambertMaterial } | null = null
  const materialFor = (atlas: TextureAtlas): THREE.MeshLambertMaterial => {
    if (current?.atlas === atlas) return current.material
    current?.texture.dispose()
    current?.material.dispose()
    const data = new Uint8Array(atlas.pixels.buffer, atlas.pixels.byteOffset, atlas.pixels.byteLength)
    const texture = new THREE.DataTexture(data, atlas.width, atlas.height, THREE.RGBAFormat)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    const material = new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: ALPHA_CUTOFF })
    current = { atlas, texture, material }
    return material
  }

  return {
    draw(appearance, atlas) {
      const data = buildModelGeometry(appearance, atlas)
      if (data.indices.length === 0) return null
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
      const mesh = new THREE.Mesh(geometry, materialFor(atlas))
      scene.add(mesh)
      // 1 ブロックより大きいモデル（粉砕ホイールなど）も収まるように、映す範囲を広げる
      geometry.computeBoundingSphere()
      const r = Math.max(0.87, geometry.boundingSphere?.radius ?? 0.87)
      const c = geometry.boundingSphere?.center ?? new THREE.Vector3()
      camera.left = -r
      camera.right = r
      camera.top = r
      camera.bottom = -r
      camera.position.set(c.x - 10, c.y + 8.2, c.z + 10)
      camera.lookAt(c)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      const url = renderer.domElement.toDataURL('image/png')
      scene.remove(mesh)
      geometry.dispose()
      return url
    },
    dispose() {
      current?.texture.dispose()
      current?.material.dispose()
      current = null
      renderer.dispose()
    },
  }
}

/** 一度に描く数。描いたら次の分は少し待ってから描く（画面を止めない） */
const DRAW_BATCH = 24

/**
 * 状態の一覧から、アイコンを用意する。頼まれた状態は覚えておき、同じものは2度描かない。
 * 見た目が null のもの・描けなかったものは null（棚は色と略称で描く）
 */
export class BlockIconLoader {
  private readonly requested = new Set<string>()
  private readonly pending = new Map<string, BlockState>()
  private flushing: Promise<void> | null = null
  private disposed = false

  constructor(
    private readonly provider: AppearanceProvider,
    private readonly rasterizer: IconRasterizer | null,
    private readonly onIcon: (key: string, url: string | null) => void,
    private readonly yieldToUi: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
  ) {}

  /** アイコンを頼む。まだ頼んでいない状態だけを、まとめて用意する */
  request(states: readonly BlockState[]): Promise<void> {
    for (const s of states) {
      if (this.requested.has(s.key)) continue
      this.requested.add(s.key)
      this.pending.set(s.key, s)
    }
    this.flushing ??= this.flush().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
  }

  private async flush(): Promise<void> {
    while (this.pending.size > 0 && !this.disposed) {
      const batch = [...this.pending.values()]
      this.pending.clear()
      let set: AppearanceSet
      try {
        set = await this.provider.prepare(batch)
      } catch {
        for (const s of batch) this.onIcon(s.key, null)
        continue
      }
      for (let i = 0; i < batch.length && !this.disposed; i += DRAW_BATCH) {
        for (const s of batch.slice(i, i + DRAW_BATCH)) {
          const look = set.appearances[s.key] ?? null
          let url: string | null = null
          if (look && this.rasterizer) {
            try {
              url = this.rasterizer.draw(look, set.atlas)
            } catch {
              url = null
            }
          }
          this.onIcon(s.key, url)
        }
        if (i + DRAW_BATCH < batch.length) await this.yieldToUi()
      }
    }
  }
}

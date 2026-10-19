// BlueprintMeshBuilder：ブロックの種類ごとに InstancedMesh を1つ作る。docs/design.md「view」。
// 同じ種類のブロックを1回の描画でまとめて描くので、ブロック数が多くても軽い。

import * as THREE from 'three'
import type { BlockInstanceGroup } from './blockInstances'

/** ブロックの立方体の1辺。隣のブロックとの境目が見えるよう、1 より少し小さくする */
export const BLOCK_SIZE = 0.94

/** 半透明のブロックの不透明度 */
export const GHOST_OPACITY = 0.14

/** 作ったメッシュ1つ分の情報（テストや強調表示で使う） */
export interface BlockMeshInfo {
  readonly id: string
  readonly ghost: boolean
}

/**
 * ブロックのメッシュを作る。立方体の形と色ごとの材質は使い回し、dispose() でまとめて捨てる。
 * 作ったメッシュのまとまり（THREE.Group）は、要らなくなったら disposeMeshes() で捨てる。
 */
export class BlueprintMeshBuilder {
  private readonly geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
  private readonly solidMaterials = new Map<string, THREE.MeshLambertMaterial>()
  private readonly ghostMaterials = new Map<string, THREE.MeshLambertMaterial>()

  /** 種類ごとのまとまりから、InstancedMesh を並べた Group を作る */
  build(groups: readonly BlockInstanceGroup[]): THREE.Group {
    const root = new THREE.Group()
    root.name = 'blocks'
    for (const g of groups) {
      if (g.solid.length > 0) root.add(this.mesh(g, g.solid, false))
      if (g.ghost.length > 0) root.add(this.mesh(g, g.ghost, true))
    }
    return root
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
    this.geometry.dispose()
    for (const m of this.solidMaterials.values()) m.dispose()
    for (const m of this.ghostMaterials.values()) m.dispose()
    this.solidMaterials.clear()
    this.ghostMaterials.clear()
  }

  private material(g: BlockInstanceGroup, ghost: boolean): THREE.MeshLambertMaterial {
    const cache = ghost ? this.ghostMaterials : this.solidMaterials
    let m = cache.get(g.id)
    if (!m) {
      m = ghost
        ? new THREE.MeshLambertMaterial({ color: g.color, transparent: true, opacity: GHOST_OPACITY, depthWrite: false })
        : new THREE.MeshLambertMaterial({ color: g.color })
      cache.set(g.id, m)
    }
    return m
  }

  private mesh(g: BlockInstanceGroup, positions: readonly number[], ghost: boolean): THREE.InstancedMesh {
    const count = positions.length / 3
    const mesh = new THREE.InstancedMesh(this.geometry, this.material(g, ghost), count)
    const info: BlockMeshInfo = { id: g.id, ghost }
    mesh.userData = info
    mesh.name = ghost ? `${g.id} (半透明)` : g.id
    // 行列は平行移動だけなので、配列に直接書く（Matrix4 を作るより速い）
    const m = mesh.instanceMatrix.array
    for (let i = 0; i < count; i++) {
      const o = i * 16
      m[o] = 1
      m[o + 5] = 1
      m[o + 10] = 1
      m[o + 15] = 1
      // ブロック p は [p, p+1) の立方体なので、中心は p + 0.5
      m[o + 12] = positions[i * 3] + 0.5
      m[o + 13] = positions[i * 3 + 1] + 0.5
      m[o + 14] = positions[i * 3 + 2] + 0.5
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
    // 半透明は不透明のあとに描く
    if (ghost) mesh.renderOrder = 1
    return mesh
  }
}

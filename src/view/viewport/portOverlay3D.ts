// 3D表示に重ねる仮の入出力の印（#70）。
// つないだブロックの面の外側に、薄い板を置く。動力源は緑、負荷は橙、選んでいるものは大きく濃くする。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import type { VirtualPort } from '../../calc/virtualPort'
import { directionVector } from '../../domain/direction'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'

/** 動力源の印の色 */
export const PORT_SOURCE_COLOR = 0x2e9d4f
/** 負荷など、動力源でない印の色 */
export const PORT_LOAD_COLOR = 0xc77c14

/** 種類から印の色を決める。'source' を含む種類を動力源とみなす */
export function portColor(kind: string): number {
  return kind.includes('source') ? PORT_SOURCE_COLOR : PORT_LOAD_COLOR
}

export class PortOverlay3D {
  readonly group = new THREE.Group()

  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>()
  private meshes: THREE.Mesh[] = []

  constructor() {
    this.group.name = 'port-overlay'
  }

  /** 印を作り直す。隠した段の印は出さない */
  update(ports: readonly VirtualPort[], selectedId: string | null, display: LayerDisplay = SHOW_ALL_LAYERS): void {
    this.clear()
    for (const port of ports) {
      if (layerVisibility(display, port.pos[1]) === 'hidden') continue
      const selected = port.id === selectedId
      const mesh = new THREE.Mesh(this.geometry, this.material(portColor(port.kind), selected))
      mesh.name = `port-${port.id}`
      const d = directionVector(port.face)
      const [x, y, z] = port.pos
      const offset = selected ? 0.62 : 0.6
      mesh.position.set(x + 0.5 + d[0] * offset, y + 0.5 + d[1] * offset, z + 0.5 + d[2] * offset)
      const side = selected ? 0.9 : 0.7
      const thin = 0.16
      mesh.scale.set(d[0] !== 0 ? thin : side, d[1] !== 0 ? thin : side, d[2] !== 0 ? thin : side)
      mesh.renderOrder = 6
      // 印には当たらないようにする（picker はブロック座標で別に当たりを調べる）
      mesh.raycast = () => {}
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
  }

  /** 出している印の数（テストと状態の確認用） */
  count(): number {
    return this.meshes.length
  }

  dispose(): void {
    this.clear()
    for (const m of this.materials.values()) m.dispose()
    this.materials.clear()
    this.geometry.dispose()
    this.group.removeFromParent()
  }

  private clear(): void {
    for (const mesh of this.meshes) mesh.removeFromParent()
    this.meshes = []
  }

  private material(color: number, selected: boolean): THREE.MeshBasicMaterial {
    const key = `${color}|${selected}`
    let m = this.materials.get(key)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.95 : 0.75, depthWrite: false })
      this.materials.set(key, m)
    }
    return m
  }
}

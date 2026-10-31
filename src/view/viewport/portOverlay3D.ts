// 3D表示に重ねる仮の入出力の印（#70）。
// 付けたブロックを、少し大きい半透明の箱で包む（#195）。動力源は緑、負荷は橙、物の入口は青、選んでいるものは濃くする。
// 同じブロックに2つ以上あれば、2つ目から少しずつ大きくして重ねる。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import type { VirtualPort } from '../../calc/virtualPort'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'

/** 動力源の印の色 */
export const PORT_SOURCE_COLOR = 0x2e9d4f
/** 負荷など、動力源でない印の色 */
export const PORT_LOAD_COLOR = 0xc77c14

/** 物の入口の印の色（#127） */
export const PORT_ITEM_COLOR = 0x2f6fd0

/** 種類から印の色を決める。'item-' で始まる種類は物の入口、'source' を含む種類を動力源とみなす */
export function portColor(kind: string): number {
  if (kind.startsWith('item-')) return PORT_ITEM_COLOR
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
    const slots = new Map<string, number>()
    for (const port of ports) {
      if (layerVisibility(display, port.pos[1]) === 'hidden') continue
      const selected = port.id === selectedId
      const mesh = new THREE.Mesh(this.geometry, this.material(portColor(port.kind), selected))
      mesh.name = `port-${port.id}`
      const [x, y, z] = port.pos
      const key = `${x},${y},${z}`
      const slot = slots.get(key) ?? 0
      slots.set(key, slot + 1)
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5)
      mesh.scale.setScalar(1.08 + slot * 0.06)
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
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.5 : 0.3, depthWrite: false })
      this.materials.set(key, m)
    }
    return m
  }
}

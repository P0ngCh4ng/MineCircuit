// 3D表示の「物の流れ」（#231、docs/ui.md「物の流れ」）。物の印を小さな球で描く。ブロックに隠れないよう手前に描く。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。

import * as THREE from 'three'
import { MAX_ITEM_DOTS, type ItemDot } from '../../calc/itemFlowDots'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'
import { itemDotColor } from './itemDotColor'

export class ItemFlowOverlay3D {
  readonly group = new THREE.Group()

  private readonly geometry = new THREE.SphereGeometry(0.13, 12, 8)
  private readonly material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true })
  private readonly mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_ITEM_DOTS)
  private readonly matrix = new THREE.Matrix4()
  private readonly color = new THREE.Color()

  constructor() {
    this.group.name = 'item-flow-overlay'
    this.mesh.name = 'item-flow-dots'
    this.mesh.renderOrder = 8
    this.mesh.raycast = () => {}
    // 位置を毎回変えるので、作ったときの範囲で切り捨てない
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.visible = false
    this.group.add(this.mesh)
  }

  /** 出す印を変える。隠した段の印は出さない */
  update(dots: readonly ItemDot[], display: LayerDisplay = SHOW_ALL_LAYERS): void {
    let n = 0
    for (const dot of dots) {
      if (n >= MAX_ITEM_DOTS) break
      if (layerVisibility(display, Math.floor(dot.pos[1])) === 'hidden') continue
      this.mesh.setMatrixAt(n, this.matrix.makeTranslation(dot.pos[0], dot.pos[1], dot.pos[2]))
      this.mesh.setColorAt(n, this.color.set(itemDotColor(dot.item)))
      n++
    }
    this.mesh.count = n
    this.mesh.visible = n > 0
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  /** 出している印の数（テストと状態の確認用） */
  get count(): number {
    return this.mesh.count
  }

  dispose(): void {
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.group.removeFromParent()
  }
}

// 3D表示に重ねる貼り付けの見本（#133、docs/ui.md「コピー・切り取り・貼り付け」）。
// 切り抜きのブロックを半透明の箱で出し、見本の範囲に線を引く。重なるブロックがあれば全部を赤くする。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import { boxSize, type Box } from '../../domain/box'
import type { PasteCell } from '../stores/pasteStore'
import { blockColor } from './blockColor'

/** 重なるときの見本の色（置くツールの置けない所と同じ） */
export const PASTE_BLOCKED_COLOR = 0xe0402a
/** 見本の範囲の線の色 */
export const PASTE_OUTLINE_COLOR = 0x2f6fd0

export class PasteOverlay3D {
  readonly group = new THREE.Group()

  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5, depthWrite: false })
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: PASTE_OUTLINE_COLOR, depthTest: false, transparent: true })
  private readonly outline: THREE.LineSegments
  private mesh: THREE.InstancedMesh | null = null
  private shown = 0

  constructor() {
    this.group.name = 'paste-overlay'
    const unit = new THREE.BoxGeometry(1, 1, 1)
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit), this.lineMaterial)
    unit.dispose()
    this.outline.name = 'paste-box'
    this.outline.visible = false
    this.outline.renderOrder = 7
    this.outline.raycast = () => {}
    this.group.add(this.outline)
  }

  /** 見本を作り直す。cells が空なら出さない */
  update(cells: readonly PasteCell[], box: Box | null, blocked: boolean): void {
    this.clearMesh()
    this.shown = cells.length
    if (cells.length > 0) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, cells.length)
      mesh.name = 'paste-cells'
      const m = new THREE.Matrix4()
      const color = new THREE.Color()
      cells.forEach((c, i) => {
        m.makeTranslation(c.pos[0] + 0.5, c.pos[1] + 0.5, c.pos[2] + 0.5)
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, color.set(blocked ? PASTE_BLOCKED_COLOR : blockColor(c.state.id.toString())))
      })
      mesh.renderOrder = 5
      // 見本には当たらないようにする（下のブロックをクリックできるように）
      mesh.raycast = () => {}
      this.group.add(mesh)
      this.mesh = mesh
    }
    this.outline.visible = box !== null
    if (box) {
      const [sx, sy, sz] = boxSize(box)
      this.outline.scale.set(sx + 0.04, sy + 0.04, sz + 0.04)
      this.outline.position.set(box.min[0] + sx / 2, box.min[1] + sy / 2, box.min[2] + sz / 2)
      this.lineMaterial.color.set(blocked ? PASTE_BLOCKED_COLOR : PASTE_OUTLINE_COLOR)
    }
  }

  /** 出している見本のマスの数（テストと状態の確認用） */
  count(): number {
    return this.shown
  }

  /** 範囲の線を出しているか（テスト用） */
  get outlineVisible(): boolean {
    return this.outline.visible
  }

  private clearMesh(): void {
    if (!this.mesh) return
    this.mesh.removeFromParent()
    this.mesh.dispose()
    this.mesh = null
  }

  dispose(): void {
    this.clearMesh()
    this.geometry.dispose()
    this.material.dispose()
    this.outline.geometry.dispose()
    this.lineMaterial.dispose()
    this.group.removeFromParent()
  }
}

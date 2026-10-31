// 3D表示に重ねる選択範囲の箱の線（#130、docs/ui.md「範囲を選ぶ」）。
// 2つ以上のマスが入る範囲を選んでいるときだけ出す。1マスのときは BlueprintScene の選択の枠のまま。
// 選択ツールのときは、面の外側に広げる・縮める取っ手も出す（#200）。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import { boxSize, isSingleCell, type Box } from '../../domain/box'
import { FACE_HANDLES, HANDLE_SIZE_3D, handleCenter3D } from '../edit/rangeHandles'
import { LIGHT_THEME, type ViewportTheme } from './viewportTheme'

/** 箱の線をブロックの外側へ少し広げる量（ブロックの面と重なってちらつかないようにする） */
export const SELECTION_BOX_MARGIN = 0.02

export class SelectionOverlay3D {
  readonly group = new THREE.Group()

  private readonly material = new THREE.LineBasicMaterial({
    color: LIGHT_THEME.selection,
    // ブロックに隠れた辺も見えるように、手前に重ねて描く
    depthTest: false,
    transparent: true,
  })
  private readonly edges: THREE.LineSegments
  private readonly handleMaterial = new THREE.MeshBasicMaterial({
    color: LIGHT_THEME.selection,
    depthTest: false,
    transparent: true,
  })
  private readonly handleGeometry = new THREE.BoxGeometry(HANDLE_SIZE_3D, HANDLE_SIZE_3D, HANDLE_SIZE_3D)
  private readonly handles: THREE.Mesh[]
  private box: Box | null = null
  private handlesWanted = false

  constructor() {
    this.group.name = 'selection-overlay'
    const unit = new THREE.BoxGeometry(1, 1, 1)
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(unit), this.material)
    unit.dispose()
    this.edges.name = 'selection-box'
    this.edges.visible = false
    // 半透明のブロックや印より後に描く
    this.edges.renderOrder = 7
    this.edges.raycast = () => {}
    this.group.add(this.edges)
    this.handles = FACE_HANDLES.map((h) => {
      const mesh = new THREE.Mesh(this.handleGeometry, this.handleMaterial)
      mesh.name = `selection-handle-${'xyz'[h.axis]}-${h.side}`
      mesh.visible = false
      mesh.renderOrder = 8
      mesh.raycast = () => {}
      this.group.add(mesh)
      return mesh
    })
  }

  /** 選択範囲を変える。null か1マスの箱なら出さない */
  update(box: Box | null): void {
    this.box = box && !isSingleCell(box) ? box : null
    const shown = this.box
    this.edges.visible = shown !== null
    this.placeHandles()
    if (!shown) return
    const [sx, sy, sz] = boxSize(shown)
    const m = SELECTION_BOX_MARGIN * 2
    this.edges.scale.set(sx + m, sy + m, sz + m)
    this.edges.position.set(shown.min[0] + sx / 2, shown.min[1] + sy / 2, shown.min[2] + sz / 2)
  }

  /** 取っ手を出すか（選択ツールで、貼り付けの見本がないとき）。範囲を出していなければ出さない */
  setHandlesVisible(visible: boolean): void {
    this.handlesWanted = visible
    this.placeHandles()
  }

  private placeHandles(): void {
    const box = this.handlesWanted ? this.box : null
    FACE_HANDLES.forEach((h, i) => {
      const mesh = this.handles[i]!
      mesh.visible = box !== null
      if (box) mesh.position.set(...handleCenter3D(box, h))
    })
  }

  setTheme(theme: ViewportTheme): void {
    this.material.color.set(theme.selection)
    this.handleMaterial.color.set(theme.selection)
  }

  /** 出している取っ手の数（テスト用） */
  get shownHandles(): number {
    return this.handles.filter((m) => m.visible).length
  }

  /** 出している範囲（テストと状態の確認用）。出していなければ null */
  get shownBox(): Box | null {
    return this.box
  }

  /** 箱の線（テスト用） */
  get object(): THREE.LineSegments {
    return this.edges
  }

  dispose(): void {
    this.edges.geometry.dispose()
    this.material.dispose()
    this.handleGeometry.dispose()
    this.handleMaterial.dispose()
    this.group.removeFromParent()
  }
}

// 3D表示に重ねる選択範囲の箱の線（#130、docs/ui.md「範囲を選ぶ」）。
// 2つ以上のマスが入る範囲を選んでいるときだけ出す。1マスのときは BlueprintScene の選択の枠のまま。
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import { boxSize, isSingleCell, type Box } from '../../domain/box'
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
  private box: Box | null = null

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
  }

  /** 選択範囲を変える。null か1マスの箱なら出さない */
  update(box: Box | null): void {
    this.box = box && !isSingleCell(box) ? box : null
    const shown = this.box
    this.edges.visible = shown !== null
    if (!shown) return
    const [sx, sy, sz] = boxSize(shown)
    const m = SELECTION_BOX_MARGIN * 2
    this.edges.scale.set(sx + m, sy + m, sz + m)
    this.edges.position.set(shown.min[0] + sx / 2, shown.min[1] + sy / 2, shown.min[2] + sz / 2)
  }

  setTheme(theme: ViewportTheme): void {
    this.material.color.set(theme.selection)
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
    this.group.removeFromParent()
  }
}

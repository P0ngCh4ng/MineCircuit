// 3D表示に重ねる計算結果の印（#31）。
// - ネットワーク：プローブでクリックしたブロックと、回転でつながったブロックを青緑の半透明の箱で包む
// - 問題：応力不足などの問題の位置を赤い半透明の箱で包む。ほかのブロックに隠れても見えるように最後に描く
// BlueprintScene とは別の THREE.Group にして、Viewport3D がシーンに足す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import type { Vec3 } from '../../domain/vec3'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'

/** ネットワークの印の色 */
export const NETWORK_MARK_COLOR = 0x14a3c7
/** 問題の印の色 */
export const ISSUE_MARK_COLOR = 0xe0402a

type MarkKind = 'network' | 'issue'

interface MarkLayer {
  readonly material: THREE.MeshBasicMaterial
  mesh: THREE.InstancedMesh | null
  positions: readonly Vec3[]
}

export class CalcOverlay3D {
  readonly group = new THREE.Group()

  private readonly geometry = new THREE.BoxGeometry(1.08, 1.08, 1.08)
  private readonly layers: Record<MarkKind, MarkLayer> = {
    network: {
      material: new THREE.MeshBasicMaterial({ color: NETWORK_MARK_COLOR, transparent: true, opacity: 0.35, depthWrite: false }),
      mesh: null,
      positions: [],
    },
    issue: {
      material: new THREE.MeshBasicMaterial({
        color: ISSUE_MARK_COLOR,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        depthTest: false,
      }),
      mesh: null,
      positions: [],
    },
  }
  private display: LayerDisplay = SHOW_ALL_LAYERS

  constructor() {
    this.group.name = 'calc-overlay'
  }

  /** 強調するネットワークのブロック。null なら出さない */
  setNetwork(positions: readonly Vec3[] | null): void {
    this.layers.network.positions = positions ?? []
    this.rebuild('network')
  }

  /** 問題の位置 */
  setIssues(positions: readonly Vec3[]): void {
    this.layers.issue.positions = positions
    this.rebuild('issue')
  }

  /** まとめて変える（印を1回だけ作り直す） */
  update(network: readonly Vec3[] | null, issues: readonly Vec3[], display: LayerDisplay): void {
    this.display = display
    this.layers.network.positions = network ?? []
    this.layers.issue.positions = issues
    this.rebuild('network')
    this.rebuild('issue')
  }

  /** 段の表示方法。隠した段の印は出さない */
  setLayerDisplay(display: LayerDisplay): void {
    this.display = display
    this.rebuild('network')
    this.rebuild('issue')
  }

  /** 出している印の数（テストと状態の確認用） */
  count(kind: MarkKind): number {
    return this.layers[kind].mesh?.count ?? 0
  }

  dispose(): void {
    for (const kind of ['network', 'issue'] as const) {
      const layer = this.layers[kind]
      layer.mesh?.removeFromParent()
      layer.mesh?.dispose()
      layer.mesh = null
      layer.material.dispose()
    }
    this.geometry.dispose()
    this.group.removeFromParent()
  }

  private rebuild(kind: MarkKind): void {
    const layer = this.layers[kind]
    if (layer.mesh) {
      layer.mesh.removeFromParent()
      layer.mesh.dispose()
      layer.mesh = null
    }
    const display = this.display
    const shown = layer.positions.filter((p) => layerVisibility(display, p[1]) !== 'hidden')
    if (shown.length === 0) return
    const mesh = new THREE.InstancedMesh(this.geometry, layer.material, shown.length)
    mesh.name = `calc-${kind}`
    mesh.renderOrder = kind === 'issue' ? 9 : 4
    // 印には当たらないようにする（picker はブロック座標で別に当たりを調べる）
    mesh.raycast = () => {}
    const m = new THREE.Matrix4()
    shown.forEach((p, i) => {
      m.makeTranslation(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    this.group.add(mesh)
    layer.mesh = mesh
  }
}

// 3D表示のシーン。設計図のブロック、グリッド、座標軸、今の段の枠、選択とマウスの下の枠を持つ。
// WebGL を使わないので、テストでも作れる。描画とカメラは viewportRenderer.ts が受け持つ。
//
// 座標はブロック座標のまま置く（ブロック p は [p, p+1) の立方体）。
// こうすると、カメラのレイをそのまま picker.ts の pick3D に渡せる。

import * as THREE from 'three'
import type { AppearanceSet } from '../../domain/blockModel'
import type { Blueprint } from '../../domain/blueprint'
import { cellIndex } from '../../domain/blockVolume'
import { equalsVec3, type Vec3 } from '../../domain/vec3'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'
import { pick3D, type PickRay } from '../tools/picker'
import type { PickTarget } from '../tools/tool'
import { AnalysisOverlay3D } from './analysisOverlay3D'
import { collectBlockInstances, countInstances, type BlockInstanceGroup } from './blockInstances'
import { BlueprintMeshBuilder, layerClipFor, type BlockMeshPair } from './blueprintMeshBuilder'
import { LIGHT_THEME, type ViewportTheme } from './viewportTheme'

function lineMaterial(color: number, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
}

/** 大きさ s の立方体の枠（中心が原点） */
function boxEdges(s: number, material: THREE.LineBasicMaterial): THREE.LineSegments {
  const box = new THREE.BoxGeometry(s, s, s)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), material)
  box.dispose()
  edges.visible = false
  return edges
}

function disposeObject(obj: THREE.Object3D | null): void {
  if (!obj) return
  obj.removeFromParent()
  obj.traverse((o) => {
    if (o instanceof THREE.LineSegments || o instanceof THREE.Line || o instanceof THREE.Mesh) {
      o.geometry.dispose()
    }
  })
}

export class BlueprintScene {
  readonly scene = new THREE.Scene()

  private readonly builder = new BlueprintMeshBuilder()
  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x6b6a62, LIGHT_THEME.ambient)
  private readonly sun = new THREE.DirectionalLight(0xffffff, LIGHT_THEME.sun)
  private readonly gridMaterial = lineMaterial(LIGHT_THEME.grid)
  private readonly frameMaterial = lineMaterial(LIGHT_THEME.layerFrame)
  private readonly selectionMaterial = lineMaterial(LIGHT_THEME.selection)
  private readonly hoverMaterial = lineMaterial(LIGHT_THEME.hover, 0.6)
  private readonly selectionBox = boxEdges(1.04, this.selectionMaterial)
  private readonly hoverBox = boxEdges(1.01, this.hoverMaterial)
  // 置くツールの見本。半透明の立方体を1つだけ動かして使う
  private readonly ghostMaterial = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5, depthWrite: false })
  private readonly ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMaterial)

  private blueprint: Blueprint | null = null
  /** モデルとテクスチャで描くときの見た目（#84）。null なら色付きの箱だけで描く */
  private appearances: AppearanceSet | null = null
  private display: LayerDisplay = SHOW_ALL_LAYERS
  private blocks: THREE.Group | null = null
  private groups: readonly BlockInstanceGroup[] = []
  private pairs: readonly BlockMeshPair[] = []
  /** 置き場所に書き込んである、隠す段 */
  private writtenHidden: ReadonlySet<number> = new Set()
  private grid: THREE.LineSegments | null = null
  private axes: THREE.AxesHelper | null = null
  private layerFrame: THREE.LineLoop | null = null
  private gridVisible = true
  private axesVisible = false
  private selected: Vec3 | null = null
  private hovered: Vec3 | null = null
  private ghost: Vec3 | null = null
  /** 強調するブロックの位置（cellIndex の番号）。強調していなければ null */
  private highlight: ReadonlySet<number> | null = null
  private highlightPositions: readonly Vec3[] | null = null
  private theme: ViewportTheme = LIGHT_THEME
  private stats = { solid: 0, ghost: 0, meshes: 0 }
  /** 計測とつながりの重ね描き（#16） */
  readonly analysisOverlay = new AnalysisOverlay3D()
  private connectGroup: readonly Vec3[] | null = null

  constructor() {
    this.sun.position.set(0.6, 1, 0.35)
    this.scene.add(this.ambient, this.sun, this.selectionBox, this.hoverBox, this.ghostBox, this.analysisOverlay.group)
    this.ghostBox.name = 'ghost'
    this.ghostBox.visible = false
    this.ghostBox.renderOrder = 5
    // 枠はブロックに隠れても見えるように、最後に重ねて描く
    for (const box of [this.selectionBox, this.hoverBox]) {
      box.renderOrder = 10
      ;(box.material as THREE.LineBasicMaterial).depthTest = false
    }
  }

  /** 今の設計図の大きさ。開いていなければ null */
  get size(): Vec3 | null {
    return this.blueprint?.size ?? null
  }

  /** 描いているブロックの数とメッシュの数（テストと状態の確認用） */
  get renderStats(): { readonly solid: number; readonly ghost: number; readonly meshes: number } {
    return this.stats
  }

  /** 描いているブロックのメッシュのまとまり。設計図がなければ null */
  get blockGroup(): THREE.Group | null {
    return this.blocks
  }

  /**
   * 設計図を入れ替える。同じ設計図でも、中身が変わったら（編集・元に戻す）もう一度呼ぶ。
   * null なら何も描かない。
   */
  setBlueprint(blueprint: Blueprint | null): void {
    const sizeChanged = !sameVec3(this.blueprint?.size ?? null, blueprint?.size ?? null)
    this.blueprint = blueprint
    if (sizeChanged) this.highlight = this.highlightKeys()
    this.rebuildBlocks()
    if (sizeChanged) this.rebuildHelpers()
    this.updateMarkers()
  }

  /**
   * ブロックの見た目（モデルとテクスチャ）を入れ替える（#84）。null なら、すべて色付きの箱で描く。
   * 見た目が null のブロックは、見た目があっても色付きの箱で描く
   */
  setAppearances(appearances: AppearanceSet | null): void {
    if (appearances === this.appearances) return
    this.appearances = appearances
    // 古い材質を使うメッシュを先に捨ててから、アトラスを入れ替える
    this.clearBlocks()
    this.builder.setAtlas(appearances?.atlas ?? null)
    this.rebuildBlocks()
  }

  /** 今の見た目。なければ null */
  get appearanceSet(): AppearanceSet | null {
    return this.appearances
  }

  /**
   * 段の表示方法を変える（#10 の段の選択と表示方法）。メッシュは作り直さない。
   * 表示方法と今の段はクリッピング面で、段ごとの非表示はブロックの大きさを 0 にして切り替える
   */
  setLayerDisplay(display: LayerDisplay): void {
    this.display = display
    this.applyLayerDisplay()
    this.updateLayerFrame()
    this.updateMarkers()
    this.updateConnectGroup()
  }

  /** 計測ツールで選んだ点（0〜2個）。2個なら点線で結ぶ */
  setMeasurePoints(points: readonly Vec3[]): void {
    this.analysisOverlay.setMeasurePoints(points)
  }

  /** つながりツールのまとまり。隠した段のブロックは強調しない */
  setConnectGroup(positions: readonly Vec3[] | null): void {
    this.connectGroup = positions
    this.updateConnectGroup()
  }

  get layerDisplay(): LayerDisplay {
    return this.display
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    if (this.grid) this.grid.visible = visible
  }

  setAxesVisible(visible: boolean): void {
    this.axesVisible = visible
    if (this.axes) this.axes.visible = visible
  }

  /** 選択中のブロックの枠 */
  setSelected(pos: Vec3 | null): void {
    this.selected = pos
    this.updateMarkers()
  }

  /** マウスの下のブロックの枠 */
  setHovered(pos: Vec3 | null): void {
    this.hovered = pos
    this.updateMarkers()
  }

  /**
   * 置くブロックの見本（半透明の立方体）。置くツールのマウスの下に出す。
   * color はブロックの色（0xRRGGBB）。pos か color が null なら出さない
   */
  setGhost(pos: Vec3 | null, color: number | null): void {
    this.ghost = pos && color !== null ? pos : null
    if (color !== null) this.ghostMaterial.color.set(color)
    this.updateMarkers()
  }

  /** 見本を出しているマス（テストと状態の確認用） */
  get ghostPos(): Vec3 | null {
    return this.ghostBox.visible ? this.ghost : null
  }

  /**
   * 強調するブロックの位置（設計図全体の座標）。それ以外のブロックを半透明にする。
   * null で強調を解除する。空の配列なら、すべて半透明になる。
   */
  setHighlight(positions: readonly Vec3[] | null): void {
    this.highlightPositions = positions
    this.highlight = this.highlightKeys()
    this.rebuildBlocks()
  }

  /** 強調しているブロックの位置。強調していなければ null */
  get highlighted(): readonly Vec3[] | null {
    return this.highlightPositions
  }

  setTheme(theme: ViewportTheme): void {
    this.theme = theme
    this.ambient.intensity = theme.ambient
    this.sun.intensity = theme.sun
    this.gridMaterial.color.set(theme.grid)
    this.frameMaterial.color.set(theme.layerFrame)
    this.selectionMaterial.color.set(theme.selection)
    this.hoverMaterial.color.set(theme.hover)
    this.analysisOverlay.setTheme(theme.name)
  }

  get currentTheme(): ViewportTheme {
    return this.theme
  }

  /**
   * ブロック座標のレイから、マウスの下のもの（PickTarget）を求める。
   * 隠した段・半透明の段のブロックには当たらない。何もなければ今の段の床の空きマス。
   */
  pick(ray: PickRay): PickTarget | null {
    const bp = this.blueprint
    if (!bp) return null
    const display = this.display
    return pick3D(ray, {
      size: bp.size,
      layer: display.layer,
      isSolid: (pos) => layerVisibility(display, pos[1]) === 'solid' && bp.get(pos) !== null,
    })
  }

  dispose(): void {
    if (this.blocks) this.builder.disposeMeshes(this.blocks)
    this.blocks = null
    this.builder.dispose()
    for (const o of [this.grid, this.axes, this.layerFrame, this.selectionBox, this.hoverBox, this.ghostBox]) disposeObject(o)
    for (const m of [this.gridMaterial, this.frameMaterial, this.selectionMaterial, this.hoverMaterial, this.ghostMaterial]) m.dispose()
    this.axes?.dispose()
    this.analysisOverlay.dispose()
  }

  private updateConnectGroup(): void {
    const display = this.display
    const group = this.connectGroup?.filter((p) => layerVisibility(display, p[1]) !== 'hidden') ?? null
    this.analysisOverlay.setConnectGroup(group)
  }

  private clearBlocks(): void {
    if (this.blocks) {
      this.builder.disposeMeshes(this.blocks)
      this.blocks.removeFromParent()
      this.blocks = null
    }
  }

  private rebuildBlocks(): void {
    this.clearBlocks()
    this.groups = []
    this.pairs = []
    this.writtenHidden = new Set()
    const bp = this.blueprint
    if (bp) {
      const highlight = this.highlight
      const size = bp.size
      const dimmed = highlight ? (x: number, y: number, z: number) => !highlight.has(cellIndex(size, x, y, z)) : null
      this.groups = collectBlockInstances(bp, dimmed, this.appearances)
      const built = this.builder.build(this.groups)
      this.blocks = built.root
      this.pairs = built.pairs
      this.scene.add(this.blocks)
    }
    this.applyLayerDisplay()
  }

  /** 今の段の表示方法を、作ってあるメッシュに当てはめる */
  private applyLayerDisplay(): void {
    const display = this.display
    this.builder.setClip(layerClipFor(display.mode, display.layer))
    if (!sameSet(this.writtenHidden, display.hidden)) {
      const hidden = display.hidden
      for (const pair of this.pairs) {
        // 隠す段を持たない種類は、前も今も隠すブロックがなければ書き直さない
        const touched = [...pair.group.layerCounts.keys()].some((y) => hidden.has(y) !== this.writtenHidden.has(y))
        if (touched) this.builder.writeMatrices(pair, (y) => hidden.has(y))
      }
      this.writtenHidden = hidden
    }
    const visibilityOf = (y: number) => layerVisibility(display, y)
    const meshes = this.builder.updateVisibility(this.pairs, visibilityOf)
    this.stats = { ...countInstances(this.groups, visibilityOf), meshes }
  }

  /** 強調する位置を、設計図の大きさでの cellIndex の番号の集まりにする */
  private highlightKeys(): ReadonlySet<number> | null {
    const positions = this.highlightPositions
    if (!positions) return null
    const size = this.blueprint?.size
    const keys = new Set<number>()
    if (size) {
      for (const [x, y, z] of positions) {
        const i = cellIndex(size, x, y, z)
        if (i >= 0) keys.add(i)
      }
    }
    return keys
  }

  /** グリッド・座標軸・段の枠を、設計図の大きさに合わせて作り直す */
  private rebuildHelpers(): void {
    for (const o of [this.grid, this.axes, this.layerFrame]) disposeObject(o)
    this.axes?.dispose()
    this.grid = null
    this.axes = null
    this.layerFrame = null
    const size = this.size
    if (!size) return
    const [w, , d] = size

    // 床（y = 0）のマス目
    const points: number[] = []
    for (let x = 0; x <= w; x++) points.push(x, 0, 0, x, 0, d)
    for (let z = 0; z <= d; z++) points.push(0, 0, z, w, 0, z)
    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    this.grid = new THREE.LineSegments(gridGeometry, this.gridMaterial)
    this.grid.name = 'grid'
    this.grid.visible = this.gridVisible

    // 原点（設計図の北西の下の角）から x（赤）・y（緑）・z（青）
    this.axes = new THREE.AxesHelper(Math.max(3, Math.min(w, d) / 3))
    this.axes.name = 'axes'
    this.axes.position.set(0, 0.01, 0)
    this.axes.visible = this.axesVisible

    const frameGeometry = new THREE.BufferGeometry()
    frameGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, w, 0, 0, w, 0, d, 0, 0, d], 3))
    this.layerFrame = new THREE.LineLoop(frameGeometry, this.frameMaterial)
    this.layerFrame.name = 'layer-frame'

    this.scene.add(this.grid, this.axes, this.layerFrame)
    this.updateLayerFrame()
  }

  /** 今の段の枠。すべて表示のときは出さない */
  private updateLayerFrame(): void {
    if (!this.layerFrame) return
    this.layerFrame.visible = this.display.mode !== 'all'
    this.layerFrame.position.y = this.display.layer + 0.02
  }

  private updateMarkers(): void {
    placeBox(this.selectionBox, this.blueprint ? this.selected : null)
    // 選択中と同じブロックなら、選択の枠だけにする
    const hover = this.hovered && !(this.selected && sameVec3(this.selected, this.hovered)) ? this.hovered : null
    placeBox(this.hoverBox, this.blueprint ? hover : null)
    placeBox(this.ghostBox, this.blueprint ? this.ghost : null)
  }
}

function placeBox(box: THREE.Object3D, pos: Vec3 | null): void {
  box.visible = pos !== null
  if (pos) box.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5)
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

function sameVec3(a: Vec3 | null, b: Vec3 | null): boolean {
  if (a === null || b === null) return a === b
  return equalsVec3(a, b)
}

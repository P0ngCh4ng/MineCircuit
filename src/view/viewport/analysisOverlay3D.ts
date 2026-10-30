// 3D表示の、計測（#16）と同じブロック（#16）の重ね描き。
// - 計測：選んだ点の枠と、2点の中心を結ぶ点線
// - 同じブロック：まとまりのブロックごとの枠（線を1つのジオメトリにまとめる）
// BlueprintScene が持ち、シーンに足す。座標はブロック座標のまま（ブロック p は [p, p+1)）。

import * as THREE from 'three'
import type { Vec3 } from '../../domain/vec3'
import type { ThemeName } from './viewportTheme'

/** 重ね描きの色。テーマ（明るい・暗い）ごと */
export const ANALYSIS_COLORS_3D: Readonly<Record<ThemeName, { readonly measure: number; readonly connect: number }>> = {
  light: { measure: 0x1f6fb8, connect: 0xb0369a },
  dark: { measure: 0x6cb6ff, connect: 0xf08ad8 },
}

/** 大きさ s の立方体の 12 本の辺（中心 c）を points に足す */
function pushBoxEdges(points: number[], c: readonly [number, number, number], s: number): void {
  const h = s / 2
  const [x0, y0, z0] = [c[0] - h, c[1] - h, c[2] - h]
  const [x1, y1, z1] = [c[0] + h, c[1] + h, c[2] + h]
  const corners = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  for (const [a, b] of edges) points.push(...corners[a], ...corners[b])
}

function center(p: Vec3): [number, number, number] {
  return [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]
}

function boxesGeometry(positions: readonly Vec3[], s: number): THREE.BufferGeometry {
  const points: number[] = []
  for (const p of positions) pushBoxEdges(points, center(p), s)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return g
}

export class AnalysisOverlay3D {
  /** シーンに足すまとまり */
  readonly group = new THREE.Group()

  private readonly measureMaterial = new THREE.LineBasicMaterial({ color: ANALYSIS_COLORS_3D.light.measure, depthTest: false })
  private readonly measureLineMaterial = new THREE.LineDashedMaterial({
    color: ANALYSIS_COLORS_3D.light.measure,
    dashSize: 0.3,
    gapSize: 0.2,
    depthTest: false,
  })
  private readonly connectMaterial = new THREE.LineBasicMaterial({ color: ANALYSIS_COLORS_3D.light.connect, depthTest: false })
  private measureObjects: THREE.Object3D[] = []
  private connectObject: THREE.LineSegments | null = null

  constructor() {
    this.group.name = 'analysis-overlay'
  }

  /** 計測の点（0〜2個）。2個なら中心どうしを点線で結ぶ */
  setMeasurePoints(points: readonly Vec3[]): void {
    for (const o of this.measureObjects) disposeLine(o)
    this.measureObjects = []
    if (points.length === 0) return
    const boxes = new THREE.LineSegments(boxesGeometry(points, 1.06), this.measureMaterial)
    boxes.name = 'measure-points'
    this.measureObjects.push(boxes)
    if (points.length >= 2) {
      const g = new THREE.BufferGeometry().setFromPoints(points.slice(0, 2).map((p) => new THREE.Vector3(...center(p))))
      const line = new THREE.Line(g, this.measureLineMaterial)
      line.computeLineDistances()
      line.name = 'measure-line'
      this.measureObjects.push(line)
    }
    for (const o of this.measureObjects) {
      o.renderOrder = 11
      this.group.add(o)
    }
  }

  /** 同じブロックのまとまり。null か空なら消す */
  setConnectGroup(positions: readonly Vec3[] | null): void {
    if (this.connectObject) disposeLine(this.connectObject)
    this.connectObject = null
    if (!positions || positions.length === 0) return
    this.connectObject = new THREE.LineSegments(boxesGeometry(positions, 1.03), this.connectMaterial)
    this.connectObject.name = 'connect-group'
    this.connectObject.renderOrder = 9
    this.group.add(this.connectObject)
  }

  /** 描いているもの（テスト用） */
  get stats(): { readonly measurePoints: number; readonly measureLine: boolean; readonly connectBlocks: number } {
    const boxes = this.measureObjects[0] as THREE.LineSegments | undefined
    return {
      measurePoints: boxes ? boxes.geometry.getAttribute('position').count / 24 : 0,
      measureLine: this.measureObjects.length > 1,
      connectBlocks: this.connectObject ? this.connectObject.geometry.getAttribute('position').count / 24 : 0,
    }
  }

  setTheme(name: ThemeName): void {
    const c = ANALYSIS_COLORS_3D[name]
    this.measureMaterial.color.set(c.measure)
    this.measureLineMaterial.color.set(c.measure)
    this.connectMaterial.color.set(c.connect)
  }

  dispose(): void {
    this.setMeasurePoints([])
    this.setConnectGroup(null)
    this.group.removeFromParent()
    this.measureMaterial.dispose()
    this.measureLineMaterial.dispose()
    this.connectMaterial.dispose()
  }
}

function disposeLine(o: THREE.Object3D): void {
  o.removeFromParent()
  if (o instanceof THREE.Line) o.geometry.dispose()
}

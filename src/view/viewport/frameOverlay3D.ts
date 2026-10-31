// 3D表示に重ねる設計図の枠の取っ手と、引いている間の変えたあとの枠（#201、docs/ui.md「設計図の大きさ」）。
// 取っ手は枠の6つの面の外側の球。範囲の取っ手（四角）より外に出す。WebGL を使わないので、テストでも作れる。

import * as THREE from 'three'
import { boxSize, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { FRAME_HANDLE_RADIUS_3D, frameHandleCenter3D } from '../edit/frameHandles'
import { FACE_HANDLES } from '../edit/rangeHandles'
import type { FramePreview } from '../stores/blueprintResizeStore'
import { LIGHT_THEME, type ViewportTheme } from './viewportTheme'

/** 縮めて消えるものがあるときの点線の色（貼り付けの見本の赤と同じ） */
const REMOVES_COLOR = 0xe0402a

export class FrameOverlay3D {
  readonly group = new THREE.Group()

  private readonly handleMaterial = new THREE.MeshBasicMaterial({ color: LIGHT_THEME.hover, depthTest: false, transparent: true, opacity: 0.85 })
  private readonly handleGeometry = new THREE.SphereGeometry(FRAME_HANDLE_RADIUS_3D, 16, 12)
  private readonly handles: THREE.Mesh[]
  private readonly previewMaterial = new THREE.LineDashedMaterial({ color: LIGHT_THEME.hover, dashSize: 0.3, gapSize: 0.2, depthTest: false, transparent: true })
  private previewLines: THREE.LineSegments | null = null
  private theme: ViewportTheme = LIGHT_THEME
  private shownSize: Vec3 | null = null
  private shownPreview: FramePreview | null = null

  constructor() {
    this.group.name = 'frame-overlay'
    this.handles = FACE_HANDLES.map((h) => {
      const mesh = new THREE.Mesh(this.handleGeometry, this.handleMaterial)
      mesh.name = `frame-handle-${'xyz'[h.axis]}-${h.side}`
      mesh.visible = false
      mesh.renderOrder = 8
      mesh.raycast = () => {}
      this.group.add(mesh)
      return mesh
    })
  }

  /** 取っ手を出す設計図の大きさ。null なら出さない */
  setHandles(size: Vec3 | null): void {
    this.shownSize = size
    FACE_HANDLES.forEach((h, i) => {
      const mesh = this.handles[i]!
      mesh.visible = size !== null
      if (size) mesh.position.set(...frameHandleCenter3D(size, h))
    })
  }

  /** 引いている間の、変えたあとの枠。null なら出さない */
  setPreview(preview: FramePreview | null): void {
    this.shownPreview = preview
    if (this.previewLines) {
      this.previewLines.geometry.dispose()
      this.previewLines.removeFromParent()
      this.previewLines = null
    }
    if (!preview) return
    const [sx, sy, sz] = boxSize(preview.box)
    const box = new THREE.BoxGeometry(sx, sy, sz)
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.previewMaterial)
    box.dispose()
    lines.computeLineDistances()
    lines.name = 'frame-preview'
    lines.renderOrder = 8
    lines.raycast = () => {}
    lines.position.set(preview.box.min[0] + sx / 2, preview.box.min[1] + sy / 2, preview.box.min[2] + sz / 2)
    this.previewMaterial.color.set(preview.removes ? REMOVES_COLOR : this.theme.hover)
    this.group.add(lines)
    this.previewLines = lines
  }

  setTheme(theme: ViewportTheme): void {
    this.theme = theme
    this.handleMaterial.color.set(theme.hover)
    if (!this.shownPreview?.removes) this.previewMaterial.color.set(theme.hover)
  }

  /** 出している取っ手の数（テスト用） */
  get shownHandles(): number {
    return this.shownSize ? this.handles.length : 0
  }

  /** 出している変えたあとの枠（テスト用） */
  get shownPreviewBox(): Box | null {
    return this.shownPreview?.box ?? null
  }

  dispose(): void {
    this.setPreview(null)
    this.handleGeometry.dispose()
    this.handleMaterial.dispose()
    this.previewMaterial.dispose()
    this.group.removeFromParent()
  }
}

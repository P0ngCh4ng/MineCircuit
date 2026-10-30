// 3D表示の描画とカメラ。WebGL を使うので、テストでは作らない（シーンは blueprintScene.ts）。
// 描くのは何かが変わったときだけ（requestRender）。止まっている間は GPU を使わない。

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Vec3 } from '../../domain/vec3'
import type { PickRay } from '../tools/picker'
import type { BlueprintScene } from './blueprintScene'
import { cameraPose, fitPose, type CameraPose, type CameraView } from './cameraViews'

/** カメラの縦の視野角（度） */
export const CAMERA_FOV = 45

/**
 * 3D表示の部品（Viewport3D.vue）が使う描画の窓口。テストでは WebGL を使わない偽物を渡す。
 */
export interface SceneRenderer {
  /** マウスでカメラを動かし始めたとき */
  onUserMove: (() => void) | null
  /** カメラの水平の向き [x, z] が変わったとき */
  onHeadingChange?: ((x: number, z: number) => void) | null
  resize(width: number, height: number): void
  requestRender(): void
  showView(view: CameraView, size: Vec3): void
  fitAll(size: Vec3): void
  rayAt(clientX: number, clientY: number): PickRay
  /** 左ドラッグでカメラを回すのを止める・戻す（置くツールで一直線に引く間。#161）。任意 */
  setOrbitEnabled?(enabled: boolean): void
  /**
   * ブロック座標の点を、表示部分の中の位置（CSS ピクセル。左上が 0）に直す。カメラの後ろなら null。
   * 範囲のツールバーを置くのに使う（#160）。任意
   */
  projectToScreen?(point: Vec3): [number, number] | null
  /** 描いたあとに呼ばれる（カメラが動いたときも）。任意 */
  onRender?: (() => void) | null
  dispose(): void
}

/** SceneRenderer を作る関数。WebGL が使えなければ例外を投げる */
export type SceneRendererFactory = (canvas: HTMLCanvasElement, content: BlueprintScene) => SceneRenderer

export const createViewportRenderer: SceneRendererFactory = (canvas, content) => new ViewportRenderer(canvas, content)

export class ViewportRenderer implements SceneRenderer {
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000)
  readonly controls: OrbitControls
  /** マウスでカメラを動かし始めたとき */
  onUserMove: (() => void) | null = null

  private readonly renderer: THREE.WebGLRenderer
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private frame = 0
  private disposed = false

  /** WebGL が使えないと例外を投げる */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: BlueprintScene,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    // 背景は透明にして、表示部分の CSS の背景を見せる（テーマに合わせて変わる）
    this.renderer.setClearColor(0x000000, 0)
    // 段の表示方法は、ブロックの材質のクリッピング面で切り替える（blueprintMeshBuilder.ts）
    this.renderer.localClippingEnabled = true

    this.controls = new OrbitControls(this.camera, canvas)
    // 左ドラッグで回す、右ドラッグで動かす、ホイールで拡大・縮小
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    this.controls.screenSpacePanning = true
    this.controls.addEventListener('change', () => {
      this.requestRender()
      this.notifyHeading()
    })
    this.controls.addEventListener('start', () => this.onUserMove?.())
  }

  /** カメラの水平の向き [x, z] が変わったとき（矢印キーで範囲を動かす向きに使う） */
  onHeadingChange: ((x: number, z: number) => void) | null = null

  private notifyHeading(): void {
    const t = this.controls.target
    const p = this.camera.position
    this.onHeadingChange?.(t.x - p.x, t.z - p.z)
  }

  setOrbitEnabled(enabled: boolean): void {
    this.controls.enabled = enabled
  }

  /** 描いたあとに呼ばれる */
  onRender: (() => void) | null = null

  private readonly projected = new THREE.Vector3()

  projectToScreen(point: Vec3): [number, number] | null {
    const v = this.projected.set(point[0], point[1], point[2]).project(this.camera)
    if (v.z < -1 || v.z > 1) return null
    return [((v.x + 1) / 2) * this.canvas.clientWidth, ((1 - v.y) / 2) * this.canvas.clientHeight]
  }

  /** 描画の大きさを表示部分に合わせる（CSS ピクセル） */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  get aspect(): number {
    return this.camera.aspect
  }

  /** 次のフレームで1回描く。何度呼んでも1回にまとめる */
  requestRender(): void {
    if (this.frame || this.disposed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.disposed) return
      this.renderer.render(this.content.scene, this.camera)
      this.onRender?.()
    })
  }

  /** カメラを置く。size は設計図の大きさ（遠くの描画範囲を決める） */
  applyPose(pose: CameraPose, size: Vec3): void {
    const radius = Math.max(0.5 * Math.hypot(size[0], size[1], size[2]), 1)
    this.camera.near = 0.05
    this.camera.far = Math.max(2000, radius * 60)
    this.camera.position.set(...pose.position)
    this.camera.updateProjectionMatrix()
    this.controls.target.set(...pose.target)
    this.controls.maxDistance = radius * 25
    this.controls.update()
    this.requestRender()
    this.notifyHeading()
  }

  /** 視点を切り替え、設計図全体を表示する */
  showView(view: CameraView, size: Vec3): void {
    this.applyPose(cameraPose(view, size, CAMERA_FOV, this.camera.aspect), size)
  }

  /** 今の向きのまま、設計図全体を表示する */
  fitAll(size: Vec3): void {
    const d = this.camera.position.clone().sub(this.controls.target)
    this.applyPose(fitPose([d.x, d.y, d.z], size, CAMERA_FOV, this.camera.aspect), size)
  }

  /** 画面の位置（clientX, clientY）を通るレイ。座標はブロック座標 */
  rayAt(clientX: number, clientY: number): PickRay {
    const r = this.canvas.getBoundingClientRect()
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const { origin: o, direction: d } = this.raycaster.ray
    return { origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z] }
  }

  dispose(): void {
    this.disposed = true
    if (this.frame) cancelAnimationFrame(this.frame)
    this.controls.dispose()
    this.renderer.dispose()
  }
}

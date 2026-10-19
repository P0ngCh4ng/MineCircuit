// 視点（斜め・上・正面・横）と「全体を表示」のカメラの位置。Three.js に依存しない計算だけを置く。
// 座標はブロック座標（ブロック p は [p, p+1) の立方体）。y が上、北が −Z（Minecraft と同じ）。

import type { Vec3 } from '../../domain/vec3'

/** 視点の種類 */
export type CameraView = 'iso' | 'top' | 'front' | 'side'

/** 画面に出す視点の名前。並びはボタンの順 */
export const CAMERA_VIEWS: readonly { readonly id: CameraView; readonly label: string; readonly title: string }[] = [
  { id: 'iso', label: '斜め', title: '南東の斜め上から見る' },
  { id: 'top', label: '上', title: '真上から見る（画面の上が北）' },
  { id: 'front', label: '正面', title: '南から北を向いて見る' },
  { id: 'side', label: '横', title: '東から西を向いて見る' },
]

export interface CameraPose {
  readonly position: Vec3
  /** カメラが見る点（回転の中心） */
  readonly target: Vec3
}

// 見る点からカメラへの向き。上から見るときは、真上だと回転の操作が決まらないので少しだけ南へずらす
const VIEW_DIRECTIONS: Readonly<Record<CameraView, Vec3>> = {
  iso: [0.62, 0.55, 0.78],
  top: [0, 1, 1e-4],
  front: [0, 0, 1],
  side: [1, 0, 0],
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len === 0 ? [0, 0, 1] : [v[0] / len, v[1] / len, v[2] / len]
}

/** 視点の向き（見る点からカメラへの単位ベクトル） */
export function viewDirection(view: CameraView): Vec3 {
  return normalize(VIEW_DIRECTIONS[view])
}

/** 設計図の中心 */
export function blueprintCenter(size: Vec3): Vec3 {
  return [size[0] / 2, size[1] / 2, size[2] / 2]
}

/**
 * 設計図全体が画面に入るカメラの距離。設計図を囲む球が、縦と横の狭いほうの視野に収まる距離にする。
 * fovDeg は縦の視野角、aspect は幅 / 高さ。
 */
export function fitDistance(size: Vec3, fovDeg: number, aspect: number): number {
  const radius = Math.max(0.5 * Math.hypot(size[0], size[1], size[2]), 1)
  const vHalf = (fovDeg * Math.PI) / 360
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.01))
  const half = Math.min(vHalf, hHalf)
  // 端がぎりぎりにならないよう、少しだけ余白を取る
  return (radius / Math.sin(half)) * 1.05
}

/** 向き direction（見る点からカメラへ）から、設計図全体を表示するカメラの位置 */
export function fitPose(direction: Vec3, size: Vec3, fovDeg: number, aspect: number): CameraPose {
  const target = blueprintCenter(size)
  const d = normalize(direction)
  const dist = fitDistance(size, fovDeg, aspect)
  return {
    position: [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist],
    target,
  }
}

/** 視点 view で設計図全体を表示するカメラの位置 */
export function cameraPose(view: CameraView, size: Vec3, fovDeg: number, aspect: number): CameraPose {
  return fitPose(viewDirection(view), size, fovDeg, aspect)
}

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { CalcRotation } from '../../calc/calcPlugin'
import type { FlowTrace } from '../../calc/flowTrace'
import type { LayerDisplay } from '../layers/layerDisplay'
import { rotationLabel } from './layerRenderer2D'
import { ringMatrix, RotationOverlay3D } from './rotationOverlay3D'
import { rotationColorKey, showsDirection } from './rotationColors'

const rot = (over: Partial<CalcRotation>): CalcRotation => ({
  pos: [0, 0, 0],
  axis: 'y',
  rpm: 16,
  level: 'slow',
  overloaded: false,
  ...over,
})

/** 板の向き（表の法線）と、板の右（絵の右）がどこを向くか */
function frame(m: THREE.Matrix4): { normal: number[]; right: number[] } {
  const n = new THREE.Vector3(0, 0, 1).transformDirection(m)
  const x = new THREE.Vector3(1, 0, 0).transformDirection(m)
  const round = (v: THREE.Vector3) => [v.x, v.y, v.z].map((c) => Math.round(c) + 0)
  return { normal: round(n), right: round(x) }
}

describe('ringMatrix', () => {
  it('板の表を軸の正の向きへ向け、ブロックの中心に置く', () => {
    expect(frame(ringMatrix(rot({ axis: 'x' }))).normal).toEqual([1, 0, 0])
    expect(frame(ringMatrix(rot({ axis: 'y' }))).normal).toEqual([0, 1, 0])
    expect(frame(ringMatrix(rot({ axis: 'z' }))).normal).toEqual([0, 0, 1])
    const p = new THREE.Vector3().setFromMatrixPosition(ringMatrix(rot({ pos: [2, 3, 4] })))
    expect([p.x, p.y, p.z]).toEqual([2.5, 3.5, 4.5])
  })

  it('上の軸を上から見ると、絵の右は東（左右が返っていない）。負の回転数なら左右を返す', () => {
    // 上から見て北が上なら、右は東（+x）。反時計回りの絵がそのまま反時計回りに見える
    expect(frame(ringMatrix(rot({ axis: 'y', rpm: 16 }))).right).toEqual([1, 0, 0])
    expect(frame(ringMatrix(rot({ axis: 'y', rpm: -16 }))).right).toEqual([-1, 0, 0])
    // x 軸を +x から見ると、右は北（-z）
    expect(frame(ringMatrix(rot({ axis: 'x', rpm: 16 }))).right).toEqual([0, 0, -1])
  })
})

describe('RotationOverlay3D', () => {
  it('回転ごとに色の箱を出し、隠した段のものは出さない。空にすると消える', () => {
    const overlay = new RotationOverlay3D()
    overlay.update([rot({ pos: [0, 0, 0] }), rot({ pos: [0, 1, 0], rpm: 0, level: 'stopped' }), rot({ pos: [0, 2, 0] })])
    expect(overlay.count().boxes).toBe(3)
    const only2: LayerDisplay = { layer: 2, mode: 'only', hidden: new Set() }
    overlay.update([rot({ pos: [0, 0, 0] }), rot({ pos: [0, 2, 0] })], only2)
    expect(overlay.count().boxes).toBe(1)
    overlay.update([])
    expect(overlay.count()).toEqual({ boxes: 0, rings: 0, arrows: 0 })
    overlay.dispose()
  })

  it('力の流れの矢印は、どちらかの端が見えている段のものだけ出す（#207）', () => {
    const overlay = new RotationOverlay3D()
    const rotations = [rot({ pos: [0, 0, 0] }), rot({ pos: [1, 0, 0] }), rot({ pos: [1, 1, 0] }), rot({ pos: [1, 2, 0] })]
    const flow: FlowTrace = {
      arrows: [
        { from: [0, 0, 0], to: [1, 0, 0], kind: 'power' },
        { from: [1, 0, 0], to: [1, 1, 0], kind: 'power' },
        { from: [1, 1, 0], to: [1, 2, 0], kind: 'item' },
      ],
      blocks: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0]],
    }
    overlay.update(rotations, undefined, flow)
    expect(overlay.count().arrows).toBe(3)
    overlay.update(rotations, { layer: 0, mode: 'only', hidden: new Set() }, flow)
    expect(overlay.count().arrows).toBe(2)
    overlay.update(rotations)
    expect(overlay.count().arrows).toBe(0)
    overlay.dispose()
  })
})

describe('回転の色と2Dの文字', () => {
  it('過負荷は赤、止まっているものには向きの印を出さない', () => {
    expect(rotationColorKey(rot({ overloaded: true }))).toBe('overloaded')
    expect(rotationColorKey(rot({ level: 'fast' }))).toBe('fast')
    expect(showsDirection(rot({ rpm: 0 }))).toBe(false)
    expect(showsDirection(rot({ overloaded: true }))).toBe(false)
    expect(showsDirection(rot({ rpm: -8 }))).toBe(true)
  })

  it('回転数は符号を付ける。力の流れを出したブロックの上下の軸は、上から見た向き（#207）', () => {
    expect(rotationLabel(rot({ axis: 'y', rpm: 16 }))).toBe('+16')
    expect(rotationLabel(rot({ axis: 'y', rpm: 16 }), true)).toBe('↺16')
    expect(rotationLabel(rot({ axis: 'y', rpm: -32 }), true)).toBe('↻32')
    expect(rotationLabel(rot({ axis: 'x', rpm: 64 }), true)).toBe('+64')
    expect(rotationLabel(rot({ axis: 'x', rpm: 64 }))).toBe('+64')
    expect(rotationLabel(rot({ axis: 'z', rpm: -10.25 }))).toBe('−10.3')
  })
})

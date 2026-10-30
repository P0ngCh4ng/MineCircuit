import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { layoutGrid2D } from './layerGrid2D'
import { drawLayer2D, LIGHT_THEME_2D, type Canvas2DLike } from './layerRenderer2D'
import { drawOrientation2D, orientationMark2D } from './orientation2D'

const state = (id: string, properties: Record<string, string> = {}): BlockState => new BlockState(ResourceLocation.parse(id), properties)

/** 引いた線（moveTo から lineTo までの点）を記録する偽の canvas */
function fakeContext() {
  const lines: [number, number][][] = []
  let strokes = 0
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo(x: number, y: number) {
      lines.push([[x, y]])
    },
    lineTo(x: number, y: number) {
      lines[lines.length - 1]?.push([x, y])
    },
    stroke() {
      strokes++
    },
    fillText() {},
    strokeText() {},
    save() {},
    restore() {},
  }
  return { ctx: ctx as unknown as Canvas2DLike, lines, strokes: () => strokes }
}

describe('orientationMark2D', () => {
  it('facing の水平は矢印、上下は丸。axis は線と丸。向きがなければ null', () => {
    expect(orientationMark2D(state('create:mechanical_press', { horizontal_facing: 'east' }))).toEqual({ kind: 'arrow', dir: 'east' })
    expect(orientationMark2D(state('create:encased_fan', { facing: 'north' }))).toEqual({ kind: 'arrow', dir: 'north' })
    expect(orientationMark2D(state('create:encased_fan', { facing: 'up' }))).toEqual({ kind: 'up' })
    expect(orientationMark2D(state('create:encased_fan', { facing: 'down' }))).toEqual({ kind: 'down' })
    expect(orientationMark2D(state('create:shaft', { axis: 'x' }))).toEqual({ kind: 'axis', axis: 'x' })
    expect(orientationMark2D(state('create:shaft', { axis: 'z' }))).toEqual({ kind: 'axis', axis: 'z' })
    expect(orientationMark2D(state('create:shaft', { axis: 'y' }))).toEqual({ kind: 'axisY' })
    // 両方あるときは horizontal_facing
    expect(orientationMark2D(state('create:mechanical_press', { horizontal_facing: 'east', facing: 'north' }))).toEqual({ kind: 'arrow', dir: 'east' })
    expect(orientationMark2D(state('minecraft:stone'))).toBeNull()
    expect(orientationMark2D(state('create:shaft', { axis: 'w' }))).toBeNull()
  })
})

describe('drawOrientation2D', () => {
  it('矢印は向きの側のマスの端の近くに先を描く', () => {
    const tips = (dir: 'north' | 'south' | 'east' | 'west'): [number, number] => {
      const fake = fakeContext()
      drawOrientation2D(fake.ctx, { kind: 'arrow', dir }, 0, 0, 40)
      // 1本目の線（軸）の終わりが矢の先
      const shaft = fake.lines[0] ?? []
      return shaft[shaft.length - 1] ?? [NaN, NaN]
    }
    expect(tips('east')[0]).toBeGreaterThan(30)
    expect(tips('west')[0]).toBeLessThan(10)
    expect(tips('north')[1]).toBeLessThan(10)
    expect(tips('south')[1]).toBeGreaterThan(30)
  })

  it('軸 x は横、軸 z は縦の線。縁と線の2回なぞる', () => {
    const x = fakeContext()
    drawOrientation2D(x.ctx, { kind: 'axis', axis: 'x' }, 0, 0, 40)
    const [a, b] = x.lines[0] ?? []
    expect(a?.[1]).toBe(b?.[1])
    expect(Math.abs((b?.[0] ?? 0) - (a?.[0] ?? 0))).toBeGreaterThan(20)
    expect(x.strokes()).toBe(2)

    const z = fakeContext()
    drawOrientation2D(z.ctx, { kind: 'axis', axis: 'z' }, 0, 0, 40)
    const [c, e] = z.lines[0] ?? []
    expect(c?.[0]).toBe(e?.[0])
  })
})

describe('drawLayer2D の向き', () => {
  const bp = blueprintFixture({ size: [2, 1, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'minecraft:stone')
    .toBlueprint()

  const draw = (size: number, showOrientation?: boolean): number => {
    const fake = fakeContext()
    drawLayer2D(fake.ctx, size, size, {
      blueprint: bp,
      layer: 0,
      layout: layoutGrid2D(size, size, bp.size),
      theme: LIGHT_THEME_2D,
      showGrid: false,
      showLabels: false,
      hovered: null,
      selected: null,
      fontFamily: 'sans-serif',
      ...(showOrientation === undefined ? {} : { showOrientation }),
    })
    return fake.strokes()
  }

  it('向きのあるブロックに印を描く。マスが小さいときと、切ったときは描かない', () => {
    const withMarks = draw(400)
    expect(withMarks - draw(400, false)).toBe(2)
    // マスが 12px より小さいとき
    expect(draw(130) - draw(130, false)).toBe(0)
  })
})

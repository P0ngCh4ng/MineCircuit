import { describe, expect, it } from 'vitest'
import { state } from '../../../tests/fixtures/blueprintFixture'
import type { BlockTransform, MirrorAxis, QuarterTurns } from '../../domain/blockTransform'
import { boxFromCorners } from '../../domain/box'
import { nbt } from '../../domain/nbt'
import { transformCreateBlockEntity, transformCreateState } from './createTransform'

const turn = (quarterTurns: QuarterTurns): BlockTransform => ({ translate: [0, 0, 0], quarterTurns, mirror: 'none', pivot: [0, 0, 0] })
const mirror = (axis: MirrorAxis): BlockTransform => ({ translate: [0, 0, 0], quarterTurns: 0, mirror: axis, pivot: [0, 0, 0] })

function props(id: string, p: Record<string, string>, t: BlockTransform): Record<string, string> | undefined {
  return transformCreateState(state(id, p), t)?.properties
}

describe('transformCreateState', () => {
  it('Create のブロックでなければ null', () => {
    expect(transformCreateState(state('minecraft:hopper', { facing: 'north' }), turn(1))).toBeNull()
  })

  it('バニラの向き（axis・facing）も一緒に変える', () => {
    expect(props('create:shaft', { axis: 'x' }, turn(1))).toEqual({ axis: 'z' })
    expect(props('create:andesite_funnel', { facing: 'north', extracting: 'false' }, mirror('z'))).toEqual({
      facing: 'south',
      extracting: 'false',
    })
  })

  it('axis_along_first は 90° の奇数回で入れ替わり、反転では変わらない', () => {
    expect(props('create:deployer', { facing: 'up', axis_along_first: 'true' }, turn(1))).toEqual({ facing: 'up', axis_along_first: 'false' })
    expect(props('create:deployer', { facing: 'east', axis_along_first: 'true' }, turn(2))).toEqual({ facing: 'west', axis_along_first: 'true' })
    expect(props('create:deployer', { facing: 'east', axis_along_first: 'true' }, mirror('x'))).toEqual({
      facing: 'west',
      axis_along_first: 'true',
    })
  })

  it('上を向いた鋸の flipped（SawBlock の規則）', () => {
    const saw = { facing: 'up', axis_along_first: 'false', flipped: 'false' }
    // 右回りで、axis_along_first が false なら flipped が変わる
    expect(props('create:mechanical_saw', saw, turn(1))).toMatchObject({ axis_along_first: 'true', flipped: 'true' })
    expect(props('create:mechanical_saw', saw, turn(3))).toMatchObject({ axis_along_first: 'true', flipped: 'false' })
    expect(props('create:mechanical_saw', saw, turn(2))).toMatchObject({ flipped: 'true' })
    expect(props('create:mechanical_saw', saw, mirror('z'))).toMatchObject({ flipped: 'true' })
    expect(props('create:mechanical_saw', saw, mirror('x'))).toMatchObject({ flipped: 'false' })
  })

  it('縦のベルトは、向きの正負が変わると start ↔ end', () => {
    const belt = { facing: 'east', slope: 'vertical', part: 'start', casing: 'false' }
    expect(props('create:belt', belt, turn(1))).toMatchObject({ facing: 'south', part: 'start' })
    expect(props('create:belt', belt, turn(2))).toMatchObject({ facing: 'west', part: 'end' })
    expect(props('create:belt', belt, mirror('x'))).toMatchObject({ facing: 'west', part: 'end' })
    // 横のベルトは part を変えない
    expect(props('create:belt', { ...belt, slope: 'horizontal' }, turn(2))).toMatchObject({ part: 'start' })
  })

  it('歯車のケースの両側のシャフト', () => {
    const cog = { axis: 'x', top_shaft: 'true', bottom_shaft: 'false' }
    expect(props('create:andesite_encased_cogwheel', cog, turn(1))).toEqual({ axis: 'z', top_shaft: 'true', bottom_shaft: 'false' })
    expect(props('create:andesite_encased_cogwheel', cog, turn(3))).toEqual({ axis: 'z', top_shaft: 'false', bottom_shaft: 'true' })
    expect(props('create:andesite_encased_cogwheel', cog, mirror('x'))).toEqual({ axis: 'x', top_shaft: 'false', bottom_shaft: 'true' })
    expect(props('create:andesite_encased_cogwheel', { ...cog, axis: 'y' }, turn(2))).toEqual({ ...cog, axis: 'y' })
  })

  it('チェーンドライブはつながる向きを回し、正の端が負になれば start ↔ end', () => {
    // axis=y、axis_along_first=true なら、つながる向きは x
    const chain = { axis: 'y', axis_along_first: 'true', part: 'start' }
    expect(props('create:encased_chain_drive', chain, turn(1))).toEqual({ axis: 'y', axis_along_first: 'false', part: 'start' })
    expect(props('create:encased_chain_drive', chain, turn(3))).toEqual({ axis: 'y', axis_along_first: 'false', part: 'end' })
    expect(props('create:encased_chain_drive', chain, mirror('x'))).toEqual({ ...chain, part: 'end' })
    expect(props('create:encased_chain_drive', chain, mirror('z'))).toEqual(chain)
  })

  it('液体タンクの窓、シャーシの貼る面、horizontal_axis', () => {
    const tank = { shape: 'window_ne', top: 'true', bottom: 'true' }
    expect(props('create:fluid_tank', tank, turn(1))).toMatchObject({ shape: 'window_se' })
    expect(props('create:fluid_tank', tank, mirror('x'))).toMatchObject({ shape: 'window_nw' })
    expect(
      props('create:secondary_linear_chassis', { axis: 'y', sticky_north: 'true', sticky_east: 'false', sticky_up: 'true' }, turn(1)),
    ).toEqual({ axis: 'y', sticky_east: 'true', sticky_south: 'false', sticky_up: 'true' })
    expect(props('create:item_vault', { horizontal_axis: 'x', large: 'false' }, turn(1))).toEqual({ horizontal_axis: 'z', large: 'false' })
  })

  it('4回回すと元に戻る', () => {
    const samples = [
      state('create:mechanical_saw', { facing: 'down', axis_along_first: 'true', flipped: 'false' }),
      state('create:belt', { facing: 'north', slope: 'vertical', part: 'end', casing: 'false' }),
      state('create:adjustable_chain_gearshift', { axis: 'z', axis_along_first: 'false', part: 'end' }),
      state('create:brass_encased_cogwheel', { axis: 'z', top_shaft: 'false', bottom_shaft: 'true' }),
    ]
    for (const s of samples) {
      let r = s
      for (let i = 0; i < 4; i++) r = transformCreateState(r, turn(1))!
      expect(r.key).toBe(s.key)
    }
  })
})

describe('transformCreateBlockEntity', () => {
  const box = boxFromCorners([0, 0, 0], [4, 2, 4])

  it('機械アームの行き先（相対位置）を回す。compound と int 配列のどちらの形も保つ', () => {
    const arm = nbt.compound({
      InteractionPoints: nbt.list('compound', [
        nbt.compound({ Pos: nbt.compound({ X: nbt.int(2), Y: nbt.int(0), Z: nbt.int(0) }), Type: nbt.string('create:belt') }),
        nbt.compound({ Pos: nbt.intArray([0, 1, -1]) }),
      ]),
      Phase: nbt.string('SEARCH_INPUTS'),
    })
    const result = transformCreateBlockEntity(state('create:mechanical_arm'), arm, turn(1), [2, 0, 2], [2, 0, 2], box)
    expect(result?.unresolved).toBe(false)
    expect(result!.nbt.value.get('InteractionPoints')).toEqual(
      nbt.list('compound', [
        nbt.compound({ Pos: nbt.compound({ X: nbt.int(0), Y: nbt.int(0), Z: nbt.int(2) }), Type: nbt.string('create:belt') }),
        nbt.compound({ Pos: nbt.intArray([1, 1, 0]) }),
      ]),
    )
    expect(result!.nbt.value.get('Phase')).toEqual(nbt.string('SEARCH_INPUTS'))
  })

  it('範囲の外を指す位置があれば unresolved', () => {
    const link = nbt.compound({ TargetOffset: nbt.intArray([5, 0, 0]) })
    const result = transformCreateBlockEntity(state('create:display_link'), link, mirror('x'), [2, 0, 2], [2, 0, 2], box)
    expect(result?.nbt.value.get('TargetOffset')).toEqual(nbt.intArray([-5, 0, 0]))
    expect(result?.unresolved).toBe(true)
  })

  it('位置の項目がないブロックは null（ベルトの Controller はワールド座標なので変えない）', () => {
    const belt = nbt.compound({ Controller: nbt.intArray([100, 64, 100]) })
    expect(transformCreateBlockEntity(state('create:belt'), belt, turn(1), [0, 0, 0], [0, 0, 0], box)).toBeNull()
  })
})

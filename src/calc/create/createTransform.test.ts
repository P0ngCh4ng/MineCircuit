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

  it('[TF-VANILLA] バニラの向き（axis・facing）も一緒に変える', () => {
    expect(props('create:shaft', { axis: 'x' }, turn(1))).toEqual({ axis: 'z' })
    expect(props('create:andesite_funnel', { facing: 'north', extracting: 'false' }, mirror('z'))).toEqual({
      facing: 'south',
      extracting: 'false',
    })
  })

  it('[TF-CONTROLLER-RAIL] コントローラーレールは、押す向きが一緒に回るように backwards を変える（坂も。#237）', () => {
    // 押す向き：north_south は北、east_west は西、ascending_X は X の向き。ascending_south・ascending_east は backwards が逆
    const rail = (shape: string, backwards: string, t: BlockTransform) => props('create:controller_rail', { shape, backwards }, t)
    // 北へ押す → 右回りで東へ押す
    expect(rail('north_south', 'false', turn(1))).toEqual({ shape: 'east_west', backwards: 'true' })
    expect(rail('ascending_north', 'false', turn(1))).toEqual({ shape: 'ascending_east', backwards: 'true' })
    // 西へ押す → 右回りで北へ押す
    expect(rail('east_west', 'false', turn(1))).toEqual({ shape: 'north_south', backwards: 'false' })
    // 北へ押す → 左回りで西へ押す
    expect(rail('ascending_north', 'false', turn(3))).toEqual({ shape: 'ascending_west', backwards: 'false' })
    // 180° はいつも逆
    expect(rail('ascending_south', 'false', turn(2))).toEqual({ shape: 'ascending_north', backwards: 'true' })
    // 北へ押す → z の反転で南へ押す。東へ押す（ascending_east）→ x の反転で西へ押す
    expect(rail('north_south', 'false', mirror('z'))).toEqual({ shape: 'north_south', backwards: 'true' })
    expect(rail('ascending_east', 'false', mirror('x'))).toEqual({ shape: 'ascending_west', backwards: 'true' })
  })

  it('[TF-AXIS-ALONG-FIRST] axis_along_first は 90° の奇数回で入れ替わり、反転では変わらない', () => {
    expect(props('create:deployer', { facing: 'up', axis_along_first: 'true' }, turn(1))).toEqual({ facing: 'up', axis_along_first: 'false' })
    expect(props('create:deployer', { facing: 'east', axis_along_first: 'true' }, turn(2))).toEqual({ facing: 'west', axis_along_first: 'true' })
    expect(props('create:deployer', { facing: 'east', axis_along_first: 'true' }, mirror('x'))).toEqual({
      facing: 'west',
      axis_along_first: 'true',
    })
  })

  it('[TF-SAW-FLIPPED] 上を向いた鋸の flipped（SawBlock の規則）', () => {
    const saw = { facing: 'up', axis_along_first: 'false', flipped: 'false' }
    // 右回りで、axis_along_first が false なら flipped が変わる
    expect(props('create:mechanical_saw', saw, turn(1))).toMatchObject({ axis_along_first: 'true', flipped: 'true' })
    expect(props('create:mechanical_saw', saw, turn(3))).toMatchObject({ axis_along_first: 'true', flipped: 'false' })
    expect(props('create:mechanical_saw', saw, turn(2))).toMatchObject({ flipped: 'true' })
    expect(props('create:mechanical_saw', saw, mirror('z'))).toMatchObject({ flipped: 'true' })
    expect(props('create:mechanical_saw', saw, mirror('x'))).toMatchObject({ flipped: 'false' })
  })

  it('[TF-BELT-VERTICAL] 縦のベルトは、向きの正負が変わると start ↔ end', () => {
    const belt = { facing: 'east', slope: 'vertical', part: 'start', casing: 'false' }
    expect(props('create:belt', belt, turn(1))).toMatchObject({ facing: 'south', part: 'start' })
    expect(props('create:belt', belt, turn(2))).toMatchObject({ facing: 'west', part: 'end' })
    expect(props('create:belt', belt, mirror('x'))).toMatchObject({ facing: 'west', part: 'end' })
    // 横のベルトは part を変えない
    expect(props('create:belt', { ...belt, slope: 'horizontal' }, turn(2))).toMatchObject({ part: 'start' })
  })

  it('[TF-ENCASED-COG-SHAFTS] 歯車のケースの両側のシャフト', () => {
    const cog = { axis: 'x', top_shaft: 'true', bottom_shaft: 'false' }
    expect(props('create:andesite_encased_cogwheel', cog, turn(1))).toEqual({ axis: 'z', top_shaft: 'true', bottom_shaft: 'false' })
    expect(props('create:andesite_encased_cogwheel', cog, turn(3))).toEqual({ axis: 'z', top_shaft: 'false', bottom_shaft: 'true' })
    expect(props('create:andesite_encased_cogwheel', cog, mirror('x'))).toEqual({ axis: 'x', top_shaft: 'false', bottom_shaft: 'true' })
    expect(props('create:andesite_encased_cogwheel', { ...cog, axis: 'y' }, turn(2))).toEqual({ ...cog, axis: 'y' })
  })

  it('[TF-CHAIN-DRIVE] チェーンドライブはつながる向きを回し、正の端が負になれば start ↔ end', () => {
    // axis=y、axis_along_first=true なら、つながる向きは x
    const chain = { axis: 'y', axis_along_first: 'true', part: 'start' }
    expect(props('create:encased_chain_drive', chain, turn(1))).toEqual({ axis: 'y', axis_along_first: 'false', part: 'start' })
    expect(props('create:encased_chain_drive', chain, turn(3))).toEqual({ axis: 'y', axis_along_first: 'false', part: 'end' })
    expect(props('create:encased_chain_drive', chain, mirror('x'))).toEqual({ ...chain, part: 'end' })
    expect(props('create:encased_chain_drive', chain, mirror('z'))).toEqual(chain)
  })

  it('[TF-TANK-WINDOW][TF-CHASSIS-STICKY][TF-HORIZONTAL-AXIS] 液体タンクの窓、シャーシの貼る面、horizontal_axis', () => {
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

  it('[TF-NBT-ARM][TF-NBT-POS-FORM] 機械アームの行き先（相対位置）を回す。compound と int 配列のどちらの形も保つ', () => {
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

  it('[TF-NBT-DISPLAY-LINK][TF-NBT-OUTSIDE] 範囲の外を指す位置があれば unresolved', () => {
    const link = nbt.compound({ TargetOffset: nbt.intArray([5, 0, 0]) })
    const result = transformCreateBlockEntity(state('create:display_link'), link, mirror('x'), [2, 0, 2], [2, 0, 2], box)
    expect(result?.nbt.value.get('TargetOffset')).toEqual(nbt.intArray([-5, 0, 0]))
    expect(result?.unresolved).toBe(true)
  })

  it('[TF-NBT-BELT-CONTROLLER] 位置の項目がないブロックは null（ベルトの Controller はワールド座標なので変えない）', () => {
    const belt = nbt.compound({ Controller: nbt.intArray([100, 64, 100]) })
    expect(transformCreateBlockEntity(state('create:belt'), belt, turn(1), [0, 0, 0], [0, 0, 0], box)).toBeNull()
  })
})

describe('回転・反転の規則ごとの確かめ（#237）', () => {
  const box = boxFromCorners([0, 0, 0], [4, 2, 4])
  const both = (quarterTurns: QuarterTurns, m: MirrorAxis): BlockTransform => ({ translate: [0, 0, 0], quarterTurns, mirror: m, pivot: [0, 0, 0] })
  const entity = (id: string, data: Parameters<typeof transformCreateBlockEntity>[1], t: BlockTransform) =>
    transformCreateBlockEntity(state(id), data, t, [2, 0, 2], [2, 0, 2], box)

  it('[TF-ORDER] 回転と反転を一度にするときは、先に反転し、次に回す', () => {
    // 東向き → x の反転で西 → 右回りで北。先に回すと南になる
    const deployer = state('create:deployer', { facing: 'east', axis_along_first: 'true' })
    expect(transformCreateState(deployer, both(1, 'x'))?.properties).toEqual({ facing: 'north', axis_along_first: 'false' })
    const saw = state('create:mechanical_saw', { facing: 'up', axis_along_first: 'false', flipped: 'false' })
    const stepwise = transformCreateState(transformCreateState(saw, mirror('z'))!, turn(1))
    expect(transformCreateState(saw, both(1, 'z'))?.key).toBe(stepwise?.key)
  })

  it('[TF-HORIZONTAL-AXIS] horizontal_axis は 90° の奇数回で x ↔ z。180° と反転では変わらない', () => {
    expect(props('create:andesite_tunnel', { horizontal_axis: 'z', shape: 'straight' }, turn(3))).toEqual({ horizontal_axis: 'x', shape: 'straight' })
    expect(transformCreateState(state('create:item_vault', { horizontal_axis: 'x', large: 'false' }), turn(2))?.properties).toEqual({
      horizontal_axis: 'x',
      large: 'false',
    })
    expect(props('create:item_vault', { horizontal_axis: 'z', large: 'true' }, mirror('x'))).toEqual({ horizontal_axis: 'z', large: 'true' })
  })

  it('[TF-TANK-WINDOW] 窓は右回りごとに ne → se → sw → nw、z の反転で ne ↔ se・nw ↔ sw', () => {
    const tank = (shape: string, t: BlockTransform) => props('create:fluid_tank', { shape, top: 'false', bottom: 'false' }, t)?.shape
    expect(tank('window_nw', turn(1))).toBe('window_ne')
    expect(tank('window_ne', turn(2))).toBe('window_sw')
    expect(tank('window_ne', turn(3))).toBe('window_nw')
    expect(tank('window_ne', mirror('z'))).toBe('window_se')
    expect(tank('window_sw', mirror('z'))).toBe('window_nw')
    // 窓のない形は変えない
    expect(tank('plain', turn(1))).toBe('plain')
  })

  it('[TF-CHASSIS-STICKY] 貼る面は反転した面へ移る', () => {
    expect(props('create:radial_chassis', { axis: 'y', sticky_north: 'true', sticky_east: 'false', sticky_south: 'false', sticky_west: 'true' }, mirror('x'))).toEqual({
      axis: 'y',
      sticky_north: 'true',
      sticky_east: 'true',
      sticky_south: 'false',
      sticky_west: 'false',
    })
  })

  it('[TF-CHAIN-DRIVE] 横の軸のチェーンドライブ。180° と、つながる向きの軸の反転', () => {
    // axis=x、axis_along_first=false なら、つながる向きは z
    const chain = { axis: 'x', axis_along_first: 'false', part: 'start' }
    expect(props('create:encased_chain_drive', chain, turn(2))).toEqual({ ...chain, part: 'end' })
    expect(props('create:adjustable_chain_gearshift', chain, mirror('z'))).toEqual({ ...chain, part: 'end' })
    expect(props('create:adjustable_chain_gearshift', chain, mirror('x'))).toEqual(chain)
    // 右回りで軸は z、つながる向きは負の x になるので start ↔ end
    expect(props('create:encased_chain_drive', chain, turn(1))).toEqual({ axis: 'z', axis_along_first: 'true', part: 'end' })
  })

  it('[TF-UNHANDLED] 線路・桁は、Create 独自のプロパティを変えない', () => {
    const girder = { axis: 'y', x: 'true', z: 'false', top: 'false', bottom: 'false', waterlogged: 'false' }
    expect(props('create:metal_girder', girder, turn(1))).toEqual(girder)
    const track = { shape: 'zo', turn: 'false', waterlogged: 'false' }
    expect(props('create:track', track, turn(1))).toEqual(track)
  })

  it('[TF-NBT-CRAFTER] クラフターのつながった入口（ConnectedInput の Data）を回す', () => {
    const crafter = nbt.compound({
      ConnectedInput: nbt.compound({ Data: nbt.list('intArray', [nbt.intArray([1, 0, 0]), nbt.intArray([0, 1, 0])]) }),
    })
    const r = entity('create:mechanical_crafter', crafter, turn(1))
    expect(r?.nbt.value.get('ConnectedInput')).toEqual(
      nbt.compound({ Data: nbt.list('intArray', [nbt.intArray([0, 0, 1]), nbt.intArray([0, 1, 0])]) }),
    )
    expect(r?.unresolved).toBe(false)
  })

  it('[TF-NBT-CHAIN-CONVEYOR] チェーンコンベアのつながる先（Connections）を回す', () => {
    const conveyor = nbt.compound({ Connections: nbt.list('intArray', [nbt.intArray([0, 0, 2]), nbt.intArray([0, 0, 3])]) })
    const r = entity('create:chain_conveyor', conveyor, mirror('z'))
    expect(r?.nbt.value.get('Connections')).toEqual(nbt.list('intArray', [nbt.intArray([0, 0, -2]), nbt.intArray([0, 0, -3])]))
    // [2,0,5] は範囲の外
    expect(r?.unresolved).toBe(true)
  })

  it('[TF-NBT-CONTROLLER][TF-NBT-SOURCE][TF-NBT-ENGINE-POS] ワールド座標と、ゲームが入れ直す位置は変えない', () => {
    const pos = nbt.intArray([100, 64, 100])
    expect(entity('create:fluid_tank', nbt.compound({ Controller: pos, LastKnownPos: pos }), turn(1))).toBeNull()
    expect(entity('create:item_vault', nbt.compound({ Controller: pos }), turn(1))).toBeNull()
    expect(entity('create:shaft', nbt.compound({ Source: pos }), turn(1))).toBeNull()
    expect(entity('create:powered_shaft', nbt.compound({ EnginePos: nbt.intArray([0, 0, 1]) }), turn(1))).toBeNull()
  })

  it('[TF-NBT-UNHANDLED] チェーンコンベアの荷物の行き先、コピーキャットの中身は変えない', () => {
    const packages = nbt.compound({ TravellingPackages: nbt.list('compound', [nbt.compound({ Target: nbt.intArray([3, 0, 0]) })]) })
    expect(entity('create:chain_conveyor', packages, turn(1))).toBeNull()
    expect(entity('create:copycat_step', nbt.compound({ Material: nbt.compound({ Name: nbt.string('minecraft:stone') }) }), turn(1))).toBeNull()
  })
})

describe('生データの位置の分かれ道（#237）', () => {
  const box = boxFromCorners([0, 0, 0], [4, 2, 4])
  const arm = (points: Parameters<typeof nbt.list>[1], elementType: Parameters<typeof nbt.list>[0] = 'compound') =>
    nbt.compound({ InteractionPoints: nbt.list(elementType, points) })
  const entity = (id: string, data: Parameters<typeof transformCreateBlockEntity>[1]) =>
    transformCreateBlockEntity(state(id), data, turn(1), [2, 0, 2], [2, 0, 2], box)

  it('Create のブロックでなければ null', () => {
    expect(entity('minecraft:chest', nbt.compound({ TargetOffset: nbt.intArray([1, 0, 0]) }))).toBeNull()
  })

  it('[TF-NBT-POS-FORM] 読めない位置（文字列・X Y Z のそろわない compound）と、Pos のない行き先は元のまま', () => {
    const points = [
      nbt.compound({ Pos: nbt.string('1,0,0') }),
      nbt.compound({ Pos: nbt.compound({ X: nbt.int(1), Y: nbt.int(0) }) }),
      nbt.compound({ Type: nbt.string('create:depot') }),
    ]
    const r = entity('create:mechanical_arm', arm(points))
    expect(r?.nbt).toEqual(arm(points))
    expect(r?.unresolved).toBe(false)
    // compound でない要素も元のまま
    expect(entity('create:mechanical_arm', arm([nbt.int(3)], 'int'))?.nbt).toEqual(arm([nbt.int(3)], 'int'))
  })

  it('位置の項目がないか、形が違えば null', () => {
    expect(entity('create:mechanical_arm', nbt.compound({}))).toBeNull()
    expect(entity('create:mechanical_arm', nbt.compound({ InteractionPoints: nbt.string('x') }))).toBeNull()
    expect(entity('create:mechanical_crafter', nbt.compound({}))).toBeNull()
    expect(entity('create:mechanical_crafter', nbt.compound({ ConnectedInput: nbt.string('x') }))).toBeNull()
    expect(entity('create:display_link', nbt.compound({}))).toBeNull()
  })
})

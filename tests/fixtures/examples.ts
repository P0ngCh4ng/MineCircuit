// 代表的なテスト用の設計図。どれも呼ぶたびに新しい BlueprintFixture を返すので、
// 続けて place() などで足してもよい。中身は架空のもので、実在の設計図ではない。

import { nbt } from '../../src/domain/nbt'
import { blueprintFixture, entityNbt, type BlueprintFixture } from './blueprintFixture'

/** 空の設計図。大きさ 2×2×2、ブロックなし、パレットなし */
export function emptyFixture(): BlueprintFixture {
  return blueprintFixture({ name: 'empty.nbt', size: [2, 2, 2] })
}

/** ブロック1つだけ（minecraft:stone、[0, 0, 0]、大きさ 1×1×1） */
export function singleBlockFixture(): BlueprintFixture {
  return blueprintFixture({ name: 'single.nbt' }).place([0, 0, 0], 'minecraft:stone')
}

/**
 * 生データ付き。properties を持つ状態と、ブロックエンティティの nbt を持つブロックがある。
 * 生データには int・long・float・string・list・入れ子の compound を入れている。
 */
export function blockEntityFixture(): BlueprintFixture {
  const motorNbt = nbt.compound({
    id: nbt.string('create:creative_motor'),
    Speed: nbt.float(64),
    ScrollValue: nbt.int(64),
    Network: nbt.compound({ Id: nbt.long(123456789012345n), Size: nbt.int(3) }),
    Source: nbt.list('int', [nbt.int(0), nbt.int(0), nbt.int(0)]),
  })
  const chestNbt = nbt.compound({
    id: nbt.string('minecraft:chest'),
    Items: nbt.list('compound', [
      nbt.compound({ Slot: nbt.byte(0), id: nbt.string('minecraft:iron_ingot'), Count: nbt.byte(12) }),
    ]),
  })
  return blueprintFixture({ name: 'block-entity.nbt', size: [3, 1, 2] })
    .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, motorNbt)
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'create:cogwheel', { axis: 'x' })
    .place([0, 0, 1], 'minecraft:chest', { facing: 'north', type: 'single', waterlogged: 'false' }, chestNbt)
}

/**
 * 知らない項目付き。Mod が足した一番上の項目、エンティティ、使われていないパレットの状態がある。
 * 読み込み・書き出しで捨てていないかを確かめるのに使う。
 */
export function unknownKeysFixture(): BlueprintFixture {
  return blueprintFixture({ name: 'unknown-keys.nbt', size: [2, 2, 1] })
    .place([0, 0, 0], 'create:andesite_casing')
    .place([1, 1, 0], 'create:shaft', { axis: 'y' })
    .paletteState('create:brass_casing')
    .entity(entityNbt([1, 0, 0], 'minecraft:item_frame', nbt.compound({ Facing: nbt.byte(3) })))
    .extra('Railways_DataVersion', nbt.int(2))
    .extra('ExampleMod_Info', nbt.compound({ Note: nbt.string('fixture'), Flags: nbt.byteArray([1, 0, 1]) }))
}

/**
 * palettes 形式で書き出すための設計図。toNbtDocument / toNbtBytes に palettesOptions を渡す。
 * 2つ目のパレットは別のブロックなので、読み込みが先頭のパレットを使っているかが分かる。
 */
export function palettesFixture(): BlueprintFixture {
  return blueprintFixture({ name: 'palettes.nbt' }).layers(
    [
      ['SS',
       'SG'],
      ['.L'],
    ],
    { S: 'minecraft:stone_bricks', G: 'minecraft:glass', L: 'minecraft:lantern[hanging=false]' },
  )
}

/** palettesFixture() を palettes 形式で書くときの選び方 */
export const palettesOptions = {
  paletteForm: 'palettes',
  alternatePalettes: [['minecraft:mossy_stone_bricks', 'minecraft:tinted_glass', 'minecraft:soul_lantern[hanging=false]']],
} as const

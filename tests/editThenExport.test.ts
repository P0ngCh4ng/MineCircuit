// 編集してから書き出すテスト。edit と io の両方を使うので、層の外（tests/）に置く。
import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../src/domain/blueprint'
import { eraseBlock, placeBlock, rotateBlock, type EditCommand } from '../src/edit/editCommand'
import { EditHistory } from '../src/edit/editHistory'
import { NbtBlueprintReader } from '../src/io/readers/nbtBlueprintReader'
import { NbtBlueprintWriter } from '../src/io/writers/nbtBlueprintWriter'
import { blueprintContents, state, type BlueprintFixture } from './fixtures/blueprintFixture'
import { blockEntityFixture, palettesFixture, palettesOptions, unknownKeysFixture } from './fixtures/examples'

const reader = new NbtBlueprintReader()
const writer = new NbtBlueprintWriter()

async function load(fx: BlueprintFixture, options: Parameters<BlueprintFixture['toNbtBytes']>[0] = {}): Promise<Blueprint> {
  return reader.read('test.nbt', await fx.toNbtBytes(options))
}

async function roundTrip(bp: Blueprint): Promise<Blueprint> {
  return reader.read(bp.name, await writer.write(bp))
}

function apply(history: EditHistory, cmd: EditCommand | null): void {
  if (!cmd) throw new Error('操作を作れませんでした')
  history.apply(cmd)
}

describe('NbtBlueprintWriter: 編集のあと', () => {
  it('置く・消す・回すのあとで、書き出して読み直すと編集後の内容と一致する', async () => {
    const bp = await load(blockEntityFixture())
    const history = new EditHistory(bp)
    apply(history, placeBlock(bp, [1, 0, 1], state('create:gearbox', { axis: 'y' }), false))
    apply(history, eraseBlock(bp, [2, 0, 0]))
    apply(history, rotateBlock(bp, [0, 0, 0], false))
    // 生データのあるブロックを別のブロックで置き換える（生データは消える）
    apply(history, placeBlock(bp, [0, 0, 1], state('minecraft:barrel', { facing: 'up', open: 'false' }), true))

    const back = await roundTrip(bp)
    expect(blueprintContents(back)).toEqual(blueprintContents(bp))
    // 回したモーターの生データは残り、置き換えたチェストの生データはない
    expect(back.regions[0].get(0, 0, 0)?.key).toBe('create:creative_motor[facing=south]')
    expect(back.regions[0].blockEntityAt(0, 0, 0)).toEqual(bp.regions[0].blockEntityAt(0, 0, 0))
    expect(back.regions[0].blockEntityAt(1, 0, 1)).toBeNull()
    expect(back.regions[0].blockEntityAt(0, 0, 1)).toBeNull()
    // 使われなくなった状態（cogwheel、chest、回す前のモーター）はパレットから消える
    expect(back.regions[0].palette.map((s) => s.id.toString()).sort()).toEqual([
      'create:creative_motor',
      'create:gearbox',
      'create:shaft',
      'minecraft:barrel',
    ])
  })

  it('全部元に戻してから書き出すと、元のファイルと同じ内容になる', async () => {
    const fx = unknownKeysFixture()
    const original = await load(fx)
    const bp = await load(fx)
    const history = new EditHistory(bp)
    apply(history, placeBlock(bp, [0, 1, 0], state('minecraft:glass'), false))
    apply(history, eraseBlock(bp, [0, 0, 0]))
    while (history.undo());

    const back = await roundTrip(bp)
    expect(blueprintContents(back)).toEqual(blueprintContents(original))
    expect(await writer.write(bp)).toEqual(await writer.write(original))
  })

  it('palettes 形式で編集で足した状態は、別のパレットにも同じ状態を書く', async () => {
    const bp = await load(palettesFixture(), palettesOptions)
    const history = new EditHistory(bp)
    apply(history, placeBlock(bp, [0, 1, 0], state('minecraft:oak_planks'), false))

    const back = await roundTrip(bp)
    expect(blueprintContents(back)).toEqual(blueprintContents(bp))
    const alt = back.regions[0].alternatePalettes[0]
    expect(alt.map((c) => (c.value.get('Name') as { value: string }).value)).toEqual([
      'minecraft:mossy_stone_bricks',
      'minecraft:tinted_glass',
      'minecraft:soul_lantern',
      'minecraft:oak_planks',
    ])
  })
})

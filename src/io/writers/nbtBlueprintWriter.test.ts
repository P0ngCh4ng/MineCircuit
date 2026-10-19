import { describe, expect, it } from 'vitest'
import { BlockVolume } from '../../domain/blockVolume'
import { Blueprint } from '../../domain/blueprint'
import { nbt, type NbtCompound, type NbtList, type RawNbt } from '../../domain/nbt'
import { blueprintContents, blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import {
  blockEntityFixture,
  emptyFixture,
  palettesFixture,
  palettesOptions,
  singleBlockFixture,
  unknownKeysFixture,
} from '../../../tests/fixtures/examples'
import { parseNbtFile } from '../nbt/index'
import { NbtBlueprintReader, UNKNOWN_DATA_VERSION } from '../readers/nbtBlueprintReader'
import { BlueprintWriteError } from './blueprintWriter'
import { NbtBlueprintWriter, blueprintToStructure } from './nbtBlueprintWriter'

const reader = new NbtBlueprintReader()
const writer = new NbtBlueprintWriter()

type NbtOptions = Parameters<BlueprintFixture['toNbtBytes']>[0]

/** ヘルパーの .nbt を読み込む */
async function load(fx: BlueprintFixture, options: NbtOptions = {}): Promise<Blueprint> {
  return reader.read('test.nbt', await fx.toNbtBytes(options))
}

/** 書き出して読み直す */
async function roundTrip(bp: Blueprint): Promise<Blueprint> {
  return reader.read(bp.name, await writer.write(bp))
}

/** 書き出したファイルの一番上の Compound */
async function writtenRoot(bp: Blueprint): Promise<NbtCompound> {
  return (await parseNbtFile(await writer.write(bp))).root
}

describe('NbtBlueprintWriter: 読み込み → 書き出し → 読み込み', () => {
  const examples: [string, () => BlueprintFixture, NbtOptions][] = [
    ['空の設計図', emptyFixture, {}],
    ['ブロック1つ', singleBlockFixture, {}],
    ['生データ付き', blockEntityFixture, {}],
    ['知らない項目・エンティティ付き', unknownKeysFixture, {}],
    ['palettes 形式', palettesFixture, palettesOptions],
    ['DataVersion なし', () => singleBlockFixture(), { omitDataVersion: true }],
    ['entities なし', () => singleBlockFixture(), { omitEntities: true }],
  ]

  it.each(examples)('%s: 配置・状態・生データ・エンティティ・知らない項目が一致する', async (_name, make, options) => {
    const original = await load(make(), options)
    const back = await roundTrip(original)
    expect(blueprintContents(back)).toEqual(blueprintContents(original))
    expect(back.regions[0].alternatePalettes).toEqual(original.regions[0].alternatePalettes)
  })

  it('もう一度書き出しても同じバイト列になる', async () => {
    const original = await load(unknownKeysFixture())
    const first = await writer.write(original)
    const second = await writer.write(await reader.read('a.nbt', first))
    expect(second).toEqual(first)
  })

  it('一番上の項目はバニラの並びで、知らない項目はその後ろに元の順で書く', async () => {
    const root = await writtenRoot(await load(unknownKeysFixture()))
    expect([...root.value.keys()]).toEqual([
      'size',
      'entities',
      'blocks',
      'palette',
      'DataVersion',
      'Railways_DataVersion',
      'ExampleMod_Info',
    ])
    expect(root.value.get('Railways_DataVersion')).toEqual(nbt.int(2))
  })

  it('DataVersion がなかった設計図は DataVersion を書かない', async () => {
    const bp = await load(singleBlockFixture(), { omitDataVersion: true })
    expect(bp.dataVersion).toBe(UNKNOWN_DATA_VERSION)
    const root = await writtenRoot(bp)
    expect(root.value.has('DataVersion')).toBe(false)
  })

  it('DataVersion を書く', async () => {
    const root = await writtenRoot(await load(singleBlockFixture().dataVersion(3465)))
    expect(root.value.get('DataVersion')).toEqual(nbt.int(3465))
  })

  it('空のリストは要素型 end で書く', async () => {
    const root = await writtenRoot(await load(emptyFixture()))
    expect(root.value.get('blocks')).toEqual(nbt.list('end'))
    expect(root.value.get('entities')).toEqual(nbt.list('end'))
    expect(root.value.get('palette')).toEqual(nbt.list('end'))
  })

  it('既存ブロックの生データをそのまま書く', async () => {
    const original = await load(blockEntityFixture())
    const back = await roundTrip(original)
    expect(back.regions[0].blockEntityAt(0, 0, 0)).toEqual(original.regions[0].blockEntityAt(0, 0, 0))
    expect(back.regions[0].blockEntityAt(0, 0, 1)).toEqual(original.regions[0].blockEntityAt(0, 0, 1))
    expect(back.regions[0].blockEntityAt(1, 0, 0)).toBeNull()
  })
})

describe('NbtBlueprintWriter: パレットの作り直し', () => {
  it('使っている状態だけでパレットを作り直す', async () => {
    const original = await load(unknownKeysFixture())
    // 読み込んだ直後は使われていない brass_casing もパレットにある
    expect(original.regions[0].palette.map((s) => s.key)).toContain('create:brass_casing')
    const back = await roundTrip(original)
    expect(back.regions[0].palette.map((s) => s.key)).toEqual(['create:andesite_casing', 'create:shaft[axis=y]'])
  })

  it('blocks の state は作り直したパレットの番号を指す', async () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .paletteState('minecraft:dirt')
      .paletteState('minecraft:sand')
      .place([0, 0, 0], 'minecraft:stone')
      .place([1, 0, 0], 'minecraft:sand')
      .toBlueprint()
    const root = await writtenRoot(bp)
    const palette = (root.value.get('palette') as NbtList).value as NbtCompound[]
    expect(palette.map((p) => p.value.get('Name'))).toEqual([nbt.string('minecraft:sand'), nbt.string('minecraft:stone')])
    const blocks = (root.value.get('blocks') as NbtList).value as NbtCompound[]
    expect(blocks.map((b) => b.value.get('state'))).toEqual([nbt.int(1), nbt.int(0)])
  })

  it('properties のない状態には Properties を書かない', async () => {
    const root = await writtenRoot(await load(singleBlockFixture()))
    const entry = (root.value.get('palette') as NbtList).value[0] as NbtCompound
    expect([...entry.value.keys()]).toEqual(['Name'])
  })

  it('palettes 形式は、別のパレットからも使っている番号の項目だけを書く', async () => {
    const fx = palettesFixture().paletteState('minecraft:dirt')
    const options = {
      paletteForm: 'palettes',
      alternatePalettes: [[...palettesOptions.alternatePalettes[0], 'minecraft:coarse_dirt']],
    } as const
    const original = await load(fx, options)
    const root = await writtenRoot(original)
    expect(root.value.has('palette')).toBe(false)
    const lists = (root.value.get('palettes') as NbtList).value as NbtList[]
    const names = lists.map((l) => (l.value as NbtCompound[]).map((c) => (c.value.get('Name') as { value: string }).value))
    expect(names).toEqual([
      ['minecraft:stone_bricks', 'minecraft:glass', 'minecraft:lantern'],
      ['minecraft:mossy_stone_bricks', 'minecraft:tinted_glass', 'minecraft:soul_lantern'],
    ])
  })
})

describe('blueprintToStructure', () => {
  it('リージョンが1つでなければ BlueprintWriteError', () => {
    const region = (name: string) => new BlockVolume({ name, size: [1, 1, 1] })
    const bp = new Blueprint('multi.litematic', 'litematic', 2975, [region('a'), region('b')])
    expect(() => blueprintToStructure(bp)).toThrow(BlueprintWriteError)
    expect(() => blueprintToStructure(bp)).toThrow(/リージョンが 2 個/)
  })

  it('extra に形式で決まった項目があっても、作り直した値を書く', () => {
    const extra: RawNbt = nbt.compound({ size: nbt.int(99), Custom: nbt.string('x') })
    const bp = new Blueprint('a.nbt', 'nbt', 2975, [new BlockVolume({ name: 'main', size: [1, 2, 3], extra })])
    const root = blueprintToStructure(bp)
    expect(root.value.get('size')).toEqual(nbt.list('int', [nbt.int(1), nbt.int(2), nbt.int(3)]))
    expect(root.value.get('Custom')).toEqual(nbt.string('x'))
  })
})

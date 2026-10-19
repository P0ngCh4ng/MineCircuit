import { describe, expect, it } from 'vitest'
import { nbt, type NbtTag } from '../../domain/nbt'
import { blueprintContents, blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import {
  blockEntityFixture,
  emptyFixture,
  palettesFixture,
  palettesOptions,
  singleBlockFixture,
  unknownKeysFixture,
} from '../../../tests/fixtures/examples'
import { serializeNbtFile } from '../nbt/index'
import { BlueprintReadError } from './blueprintReader'
import { NbtBlueprintReader, UNKNOWN_DATA_VERSION } from './nbtBlueprintReader'
import { findBlueprintReader, readBlueprint } from './readBlueprint'

const reader = new NbtBlueprintReader()

async function readFixture(fx: BlueprintFixture, options: Parameters<BlueprintFixture['toNbtBytes']>[0] = {}) {
  return reader.read('test.nbt', await fx.toNbtBytes(options))
}

/** 一番上の項目を並べて構造物 NBT のバイト列を作る（形式が違うファイルの再現用） */
function rawFile(entries: Record<string, NbtTag>): Promise<Uint8Array> {
  return serializeNbtFile({ name: '', root: nbt.compound(entries) })
}

const ints = (...values: number[]) => nbt.list('int', values.map((v) => nbt.int(v)))
const stonePalette = () => nbt.list('compound', [nbt.compound({ Name: nbt.string('minecraft:stone') })])
const oneBlock = (x: number, y: number, z: number, state: number) =>
  nbt.list('compound', [nbt.compound({ pos: ints(x, y, z), state: nbt.int(state) })])

describe('NbtBlueprintReader', () => {
  const examples: [string, () => BlueprintFixture][] = [
    ['空の設計図', emptyFixture],
    ['ブロック1つ', singleBlockFixture],
    ['生データ付き', blockEntityFixture],
    ['知らない項目付き', unknownKeysFixture],
    ['palettes 用の設計図（palette 形式で書いたもの）', palettesFixture],
  ]

  it.each(examples)('%s を読むと、ヘルパーの Blueprint と同じ中身になる', async (_label, make) => {
    const fx = make()
    const bp = await reader.read('example.nbt', await fx.toNbtBytes())
    expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
    expect(bp.name).toBe('example.nbt')
    expect(bp.format).toBe('nbt')
    expect(bp.regions).toHaveLength(1)
    expect(bp.regions[0].name).toBe('main')
    expect(bp.regions[0].offset).toEqual([0, 0, 0])
  })

  it('gzip で圧縮していないファイルも読める', async () => {
    const fx = blockEntityFixture()
    const bp = await readFixture(fx, { compress: false })
    expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
  })

  it('ArrayBuffer でも読める', async () => {
    const fx = singleBlockFixture()
    const bytes = await fx.toNbtBytes()
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const bp = await reader.read('single.nbt', buffer)
    expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
  })

  it('パレットはファイルと同じ並びで、使われていない状態も残る', async () => {
    const fx = unknownKeysFixture()
    const bp = await readFixture(fx)
    expect(bp.regions[0].palette.map((s) => s.key)).toEqual(fx.palette.map((s) => s.key))
    expect(bp.regions[0].palette.map((s) => s.key)).toContain('create:brass_casing')
  })

  describe('palettes 形式', () => {
    it('先頭のパレットを使う', async () => {
      const fx = palettesFixture()
      const bp = await readFixture(fx, palettesOptions)
      expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
      expect(bp.get([1, 1, 0])?.key).toBe('minecraft:lantern[hanging=false]')
    })

    it('先頭より後ろのパレットは生データのまま alternatePalettes に残る', async () => {
      const bp = await readFixture(palettesFixture(), palettesOptions)
      const alternates = bp.regions[0].alternatePalettes
      expect(alternates).toHaveLength(1)
      expect(alternates[0]).toEqual([
        nbt.compound({ Name: nbt.string('minecraft:mossy_stone_bricks') }),
        nbt.compound({ Name: nbt.string('minecraft:tinted_glass') }),
        nbt.compound({ Name: nbt.string('minecraft:soul_lantern'), Properties: nbt.compound({ hanging: nbt.string('false') }) }),
      ])
      // extra には入れない
      expect(bp.regions[0].extra.value.has('palettes')).toBe(false)
    })

    it('パレットが1つだけの palettes も読める', async () => {
      const fx = palettesFixture()
      const bp = await readFixture(fx, { paletteForm: 'palettes' })
      expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
      expect(bp.regions[0].alternatePalettes).toEqual([])
    })

    it('palette 形式では alternatePalettes は空', async () => {
      const bp = await readFixture(palettesFixture())
      expect(bp.regions[0].alternatePalettes).toEqual([])
    })
  })

  describe('捨てずに残すもの', () => {
    it('知らない一番上の項目を extra にそのまま残す', async () => {
      const bp = await readFixture(unknownKeysFixture())
      const extra = bp.regions[0].extra.value
      expect([...extra.keys()]).toEqual(['Railways_DataVersion', 'ExampleMod_Info'])
      expect(extra.get('Railways_DataVersion')).toEqual(nbt.int(2))
      expect(extra.get('ExampleMod_Info')).toEqual(
        nbt.compound({ Note: nbt.string('fixture'), Flags: nbt.byteArray([1, 0, 1]) }),
      )
    })

    it('決まった項目（size・palette・blocks・entities・DataVersion）は extra に入れない', async () => {
      const bp = await readFixture(unknownKeysFixture())
      for (const key of ['size', 'palette', 'palettes', 'blocks', 'entities', 'DataVersion']) {
        expect(bp.regions[0].extra.value.has(key)).toBe(false)
      }
    })

    it('ブロックエンティティの生データを型ごとそのまま残す', async () => {
      const fx = blockEntityFixture()
      const bp = await readFixture(fx)
      const expected = fx.toBlueprint()
      expect(bp.blockEntityAt([0, 0, 0])).toEqual(expected.blockEntityAt([0, 0, 0]))
      expect(bp.blockEntityAt([0, 0, 1])).toEqual(expected.blockEntityAt([0, 0, 1]))
      const motor = bp.blockEntityAt([0, 0, 0])
      expect(motor?.value.get('Speed')).toEqual(nbt.float(64))
      expect((motor?.value.get('Network') as { value: Map<string, NbtTag> }).value.get('Id')).toEqual(
        nbt.long(123456789012345n),
      )
      // 生データのないブロックは null
      expect(bp.blockEntityAt([1, 0, 0])).toBeNull()
    })

    it('エンティティを要素ごとそのまま残す', async () => {
      const fx = unknownKeysFixture()
      const bp = await readFixture(fx)
      expect(bp.regions[0].entities).toEqual(fx.toBlueprint().regions[0].entities)
      expect(bp.regions[0].entities).toHaveLength(1)
    })

    it('DataVersion を読む', async () => {
      const bp = await readFixture(blueprintFixture({ dataVersion: 3465 }).place([0, 0, 0], 'stone'))
      expect(bp.dataVersion).toBe(3465)
    })
  })

  describe('項目がないファイル', () => {
    it('DataVersion がなければ UNKNOWN_DATA_VERSION にする', async () => {
      const bp = await readFixture(singleBlockFixture(), { omitDataVersion: true })
      expect(bp.dataVersion).toBe(UNKNOWN_DATA_VERSION)
    })

    it('entities がなければ空にする', async () => {
      const bp = await readFixture(singleBlockFixture(), { omitEntities: true })
      expect(bp.regions[0].entities).toEqual([])
    })
  })

  describe('空気', () => {
    it('空気のブロックは置かれていないもの（空き）として読む', async () => {
      const fx = blueprintFixture({ size: [3, 1, 1] })
        .place([0, 0, 0], 'minecraft:air')
        .place([1, 0, 0], 'minecraft:stone')
        .place([2, 0, 0], 'minecraft:cave_air')
      const bp = await readFixture(fx)
      expect(bp.get([0, 0, 0])).toBeNull()
      expect(bp.get([1, 0, 0])?.key).toBe('minecraft:stone')
      expect(bp.get([2, 0, 0])).toBeNull()
      let count = 0
      bp.regions[0].forEachBlock(() => count++)
      expect(count).toBe(1)
    })

    it('空気はパレットに残すので、パレット番号はファイルと同じ', async () => {
      const fx = blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'minecraft:air').place([1, 0, 0], 'create:shaft[axis=x]')
      const bp = await readFixture(fx)
      expect(bp.regions[0].palette.map((s) => s.key)).toEqual(['minecraft:air', 'create:shaft[axis=x]'])
      expect([...bp.namespaces]).toEqual(['create'])
    })
  })

  describe('形式が違うファイル', () => {
    async function expectReadError(bytes: Uint8Array, message: RegExp) {
      const error = await reader.read('bad.nbt', bytes).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BlueprintReadError)
      expect((error as Error).message).toMatch(message)
    }

    it('NBT でないファイル', async () => {
      await expectReadError(new TextEncoder().encode('hello'), /NBT として読めませんでした/)
    })

    it('size がない', async () => {
      await expectReadError(await rawFile({ palette: stonePalette(), blocks: oneBlock(0, 0, 0, 0) }), /size（大きさ）がありません/)
    })

    it('size が3つの整数でない', async () => {
      await expectReadError(await rawFile({ size: ints(1, 1), palette: stonePalette(), blocks: oneBlock(0, 0, 0, 0) }), /size が3つの整数/)
    })

    it('palette も palettes もない', async () => {
      await expectReadError(await rawFile({ size: ints(1, 1, 1), blocks: oneBlock(0, 0, 0, 0) }), /palette.*も palettes もありません/)
    })

    it('palettes が空', async () => {
      await expectReadError(
        await rawFile({ size: ints(1, 1, 1), palettes: nbt.list('end'), blocks: oneBlock(0, 0, 0, 0) }),
        /palettes が空です/,
      )
    })

    it('blocks がない', async () => {
      await expectReadError(await rawFile({ size: ints(1, 1, 1), palette: stonePalette() }), /blocks（ブロックの一覧）がありません/)
    })

    it('パレットの状態に Name がない', async () => {
      const palette = nbt.list('compound', [nbt.compound({ Properties: nbt.compound() })])
      await expectReadError(await rawFile({ size: ints(1, 1, 1), palette, blocks: oneBlock(0, 0, 0, 0) }), /Name（ブロックの ID）がありません/)
    })

    it('state がパレットの外', async () => {
      await expectReadError(
        await rawFile({ size: ints(1, 1, 1), palette: stonePalette(), blocks: oneBlock(0, 0, 0, 5) }),
        /state 5 がパレットにありません/,
      )
    })

    it('位置が大きさの外', async () => {
      await expectReadError(
        await rawFile({ size: ints(1, 1, 1), palette: stonePalette(), blocks: oneBlock(1, 0, 0, 0) }),
        /位置 \[1, 0, 0\] が大きさ \[1, 1, 1\] の外です/,
      )
    })

    it('state がない', async () => {
      const blocks = nbt.list('compound', [nbt.compound({ pos: ints(0, 0, 0) })])
      await expectReadError(await rawFile({ size: ints(1, 1, 1), palette: stonePalette(), blocks }), /state（パレット番号）がありません/)
    })
  })
})

describe('readBlueprint', () => {
  it('拡張子で読み込みを選ぶ（大文字でもよい）', async () => {
    expect(findBlueprintReader('a.NBT')).toBeInstanceOf(NbtBlueprintReader)
    expect(findBlueprintReader('a.schem')).toBeNull()
    const fx = singleBlockFixture()
    const bp = await readBlueprint('Machine.NBT', await fx.toNbtBytes())
    expect(blueprintContents(bp)).toEqual(blueprintContents(fx.toBlueprint()))
    expect(bp.name).toBe('Machine.NBT')
  })

  it('対応していない形式はエラー', async () => {
    await expect(readBlueprint('a.litematic', new Uint8Array())).rejects.toThrow(BlueprintReadError)
    await expect(readBlueprint('a.litematic', new Uint8Array())).rejects.toThrow(/開けない形式です/)
  })
})

import { describe, expect, it } from 'vitest'
import { nbt, type NbtCompound, type NbtList, type NbtTag } from '../../src/domain/nbt'
import { parseNbtFile, readNbt } from '../../src/io/nbt/index'
import { blueprintContents, blueprintFixture, cloneNbt, entityNbt, state } from './blueprintFixture'
import {
  blockEntityFixture,
  emptyFixture,
  palettesFixture,
  palettesOptions,
  singleBlockFixture,
  unknownKeysFixture,
} from './examples'

function get(c: NbtCompound, key: string): NbtTag {
  const v = c.value.get(key)
  if (!v) throw new Error(`no ${key}`)
  return v
}
function list(c: NbtCompound, key: string): NbtList {
  const v = get(c, key)
  if (v.type !== 'list') throw new Error(`${key} is not a list`)
  return v
}
function ints(l: NbtList): number[] {
  return l.value.map((t) => (t.type === 'int' ? t.value : NaN))
}

describe('state', () => {
  it('文字列の properties を読む', () => {
    const s = state('create:shaft[axis=y, waterlogged=false]')
    expect(s.id.toString()).toBe('create:shaft')
    expect(s.properties).toEqual({ axis: 'y', waterlogged: 'false' })
    expect(state('stone').key).toBe('minecraft:stone')
    expect(state('create:shaft[axis=x]', { axis: 'z' }).key).toBe('create:shaft[axis=z]')
  })

  it('閉じていない [ はエラー', () => {
    expect(() => state('create:shaft[axis=y')).toThrow()
  })
})

describe('BlueprintFixture.toBlueprint', () => {
  it('置いたブロック・状態・生データが入る', () => {
    const raw = nbt.compound({ Speed: nbt.int(64) })
    const bp = blueprintFixture({ size: [3, 2, 3] })
      .place([0, 0, 0], 'create:shaft', { axis: 'y' })
      .place([1, 0, 0], 'create:creative_motor[facing=up]', raw)
      .place([2, 1, 2], 'create:cogwheel', { axis: 'x' }, nbt.compound({ Speed: nbt.int(8) }))
      .toBlueprint()
    expect(bp.format).toBe('nbt')
    expect(bp.dataVersion).toBe(2975)
    expect(bp.size).toEqual([3, 2, 3])
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=y]')
    expect(bp.get([1, 0, 0])?.key).toBe('create:creative_motor[facing=up]')
    expect(bp.blockEntityAt([1, 0, 0])).toEqual(raw)
    expect(bp.blockEntityAt([1, 0, 0])).not.toBe(raw) // 写してある
    expect(bp.blockEntityAt([2, 1, 2])?.value.get('Speed')).toEqual(nbt.int(8))
    expect(bp.get([1, 1, 1])).toBeNull()
    expect(bp.regions[0].name).toBe('main')
  })

  it('size を省略すると置いたブロックから決める', () => {
    const fx = blueprintFixture().place([2, 0, 1], 'stone')
    expect(fx.resolvedSize).toEqual([3, 1, 2])
    expect(emptyFixture().toBlueprint().size).toEqual([2, 2, 2])
  })

  it('範囲の外に置くとエラー', () => {
    expect(() => blueprintFixture({ size: [1, 1, 1] }).place([1, 0, 0], 'stone').toBlueprint()).toThrow()
    expect(() => blueprintFixture().place([-1, 0, 0], 'stone')).toThrow()
  })

  it('fill は両端を含む', () => {
    const bp = blueprintFixture().fill([2, 1, 0], [0, 0, 1], 'stone').toBlueprint()
    expect(bp.regions[0].palette).toHaveLength(1)
    let n = 0
    bp.regions[0].forEachBlock(() => n++)
    expect(n).toBe(12)
  })

  it('layers は段・行・文字の順に y・z・x', () => {
    const motorNbt = nbt.compound({ Speed: nbt.int(16) })
    const bp = blueprintFixture()
      .layers(
        [
          `
          CS.
          ..C
          `,
          ['M'],
        ],
        { C: 'create:cogwheel[axis=y]', S: state('create:shaft', { axis: 'x' }), M: { state: 'create:creative_motor', nbt: motorNbt } },
        [1, 0, 0],
      )
      .toBlueprint()
    expect(bp.size).toEqual([4, 2, 2])
    expect(bp.get([1, 0, 0])?.key).toBe('create:cogwheel[axis=y]')
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([3, 0, 1])?.key).toBe('create:cogwheel[axis=y]')
    expect(bp.get([1, 1, 0])?.key).toBe('create:creative_motor')
    expect(bp.blockEntityAt([1, 1, 0])).toEqual(motorNbt)
    expect(() => blueprintFixture().layers([['X']], {})).toThrow()
  })

  it('置き直すと前の生データは消える。remove で空きになる', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'chest', nbt.compound({ a: nbt.int(1) }))
      .place([0, 0, 0], 'stone')
      .place([1, 0, 0], 'stone')
      .remove([1, 0, 0])
      .toBlueprint()
    expect(bp.blockEntityAt([0, 0, 0])).toBeNull()
    expect(bp.get([1, 0, 0])).toBeNull()
    expect(bp.regions[0].palette.map((p) => p.key)).toEqual(['minecraft:chest', 'minecraft:stone'])
  })

  it('知らない項目とエンティティが入る', () => {
    const bp = unknownKeysFixture().toBlueprint()
    const r = bp.regions[0]
    expect([...r.extra.value.keys()]).toEqual(['Railways_DataVersion', 'ExampleMod_Info'])
    expect(r.entities).toHaveLength(1)
    expect(r.palette.map((p) => p.key)).toContain('create:brass_casing')
    expect(bp.namespaces).toEqual(new Set(['create']))
  })

  it('呼ぶたびに別の Blueprint を作る', () => {
    const fx = blockEntityFixture()
    const a = fx.toBlueprint()
    const b = fx.toBlueprint()
    expect(a).not.toBe(b)
    expect(a.blockEntityAt([0, 0, 0])).not.toBe(b.blockEntityAt([0, 0, 0]))
    expect(blueprintContents(a)).toEqual(blueprintContents(b))
  })

  it('決まった項目は extra に使えない', () => {
    expect(() => blueprintFixture().extra('palette', nbt.int(1))).toThrow()
  })
})

describe('BlueprintFixture.toNbtDocument', () => {
  it('構造物 NBT の形で書く', () => {
    const doc = blockEntityFixture().toNbtDocument()
    const root = doc.root
    expect(doc.name).toBe('')
    expect([...root.value.keys()]).toEqual(['size', 'entities', 'blocks', 'palette', 'DataVersion'])
    expect(ints(list(root, 'size'))).toEqual([3, 1, 2])
    expect(get(root, 'DataVersion')).toEqual(nbt.int(2975))

    const palette = list(root, 'palette').value as NbtCompound[]
    expect(palette[0].value.get('Name')).toEqual(nbt.string('create:creative_motor'))
    expect(palette[0].value.get('Properties')).toEqual(nbt.compound({ facing: nbt.string('east') }))

    const blocks = list(root, 'blocks').value as NbtCompound[]
    expect(blocks).toHaveLength(4)
    // cellIndex の順（y、z、x）
    expect(blocks.map((b) => ints(b.value.get('pos') as NbtList))).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [0, 0, 1],
    ])
    expect(blocks.map((b) => b.value.get('state'))).toEqual([0, 1, 2, 3].map((n) => nbt.int(n)))
    expect(blocks[0].value.get('nbt')).toEqual(blockEntityFixture().toBlueprint().blockEntityAt([0, 0, 0]))
    expect(blocks[1].value.has('nbt')).toBe(false)
  })

  it('properties がない状態は Properties を書かない', () => {
    const palette = list(singleBlockFixture().toNbtDocument().root, 'palette').value as NbtCompound[]
    expect([...palette[0].value.keys()]).toEqual(['Name'])
  })

  it('空の設計図は空のリストを書く', () => {
    const root = emptyFixture().toNbtDocument().root
    expect(list(root, 'blocks').value).toHaveLength(0)
    expect(list(root, 'palette').value).toHaveLength(0)
    expect(list(root, 'entities').value).toHaveLength(0)
  })

  it('palettes 形式では先頭に本来のパレット、後ろに別のパレットを書く', () => {
    const fx = palettesFixture()
    const root = fx.toNbtDocument(palettesOptions).root
    expect(root.value.has('palette')).toBe(false)
    const palettes = list(root, 'palettes')
    expect(palettes.elementType).toBe('list')
    expect(palettes.value).toHaveLength(2)
    expect(palettes.value[0]).toEqual(list(fx.toNbtDocument().root, 'palette'))
    expect(((palettes.value[1] as NbtList).value[0] as NbtCompound).value.get('Name')).toEqual(
      nbt.string('minecraft:mossy_stone_bricks'),
    )
    expect(() => fx.toNbtDocument({ paletteForm: 'palettes', alternatePalettes: [['stone']] })).toThrow()
  })

  it('知らない項目とエンティティを書く', () => {
    const root = unknownKeysFixture().toNbtDocument().root
    expect([...root.value.keys()].slice(-2)).toEqual(['Railways_DataVersion', 'ExampleMod_Info'])
    const entity = list(root, 'entities').value[0] as NbtCompound
    expect([...entity.value.keys()]).toEqual(['pos', 'blockPos', 'nbt'])
    expect((entity.value.get('nbt') as NbtCompound).value.get('id')).toEqual(nbt.string('minecraft:item_frame'))
  })

  it('DataVersion と entities を省ける', () => {
    const root = singleBlockFixture().toNbtDocument({ omitDataVersion: true, omitEntities: true }).root
    expect([...root.value.keys()]).toEqual(['size', 'blocks', 'palette'])
  })
})

describe('BlueprintFixture.toNbtBytes', () => {
  it('gzip で圧縮した .nbt を作り、読み直すと同じ中身になる', async () => {
    const fx = unknownKeysFixture()
    const bytes = await fx.toNbtBytes()
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)
    const file = await parseNbtFile(bytes)
    expect(file.compressed).toBe(true)
    expect(file.root).toEqual(fx.toNbtDocument().root)
  })

  it('compress: false なら圧縮しない', async () => {
    const fx = palettesFixture()
    const bytes = await fx.toNbtBytes({ compress: false, ...palettesOptions })
    expect(readNbt(bytes).root).toEqual(fx.toNbtDocument(palettesOptions).root)
  })
})

describe('補助', () => {
  it('cloneNbt は深く写す', () => {
    const a = nbt.compound({ list: nbt.list('int', [nbt.int(1)]), arr: nbt.longArray([1n]) })
    const b = cloneNbt(a)
    expect(b).toEqual(a)
    ;(b.value.get('list') as NbtList).value.push(nbt.int(2))
    expect((a.value.get('list') as NbtList).value).toHaveLength(1)
  })

  it('entityNbt は pos を double、blockPos を int で書く', () => {
    const e = entityNbt([1, 2, 3], 'minecraft:armor_stand')
    expect(e.value.get('pos')).toEqual(nbt.list('double', [1.5, 2.5, 3.5].map((n) => nbt.double(n))))
    expect(e.value.get('blockPos')).toEqual(nbt.list('int', [1, 2, 3].map((n) => nbt.int(n))))
  })

  it('blueprintContents はパレットの並びに左右されない', () => {
    const a = blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'stone').place([1, 0, 0], 'dirt')
    const b = blueprintFixture({ size: [2, 1, 1] }).paletteState('dirt').place([0, 0, 0], 'stone').place([1, 0, 0], 'dirt')
    expect(blueprintContents(a.toBlueprint())).toEqual(blueprintContents(b.toBlueprint()))
  })
})

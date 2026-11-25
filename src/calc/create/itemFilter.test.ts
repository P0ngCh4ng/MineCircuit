import { describe, expect, it } from 'vitest'
import { nbt, type NbtCompound } from '../../domain/nbt'
import { testFilter } from './itemFilter'

/** 1.18.2 のアイテムスタック */
const stack = (id: string, tag?: NbtCompound): NbtCompound =>
  nbt.compound({ id: nbt.string(id), Count: nbt.byte(1), ...(tag ? { tag } : {}) })

/** 1.18.2 のリストフィルター */
const listFilter = (ids: string[], blacklist: boolean): NbtCompound =>
  stack(
    'create:filter',
    nbt.compound({
      Blacklist: nbt.byte(blacklist ? 1 : 0),
      RespectNBT: nbt.byte(0),
      Items: nbt.compound({
        Size: nbt.int(18),
        Items: nbt.list(
          'compound',
          ids.map((id, slot) => nbt.compound({ Slot: nbt.int(slot), id: nbt.string(id), Count: nbt.byte(1) })),
        ),
      }),
    }),
  )

describe('フィルター（#253）', () => {
  it('[TP-FILTER] 空のフィルターは何でも通し、ふつうの物は同じ ID だけを通す', () => {
    expect(testFilter(null, 'minecraft:stone')).toEqual({ pass: true, unknown: null })
    expect(testFilter(nbt.compound({}), 'minecraft:stone').pass).toBe(true)
    expect(testFilter(nbt.compound({ id: nbt.string('minecraft:air'), Count: nbt.byte(1) }), 'minecraft:stone').pass).toBe(true)
    expect(testFilter(nbt.compound({ id: nbt.string('minecraft:dirt'), Count: nbt.byte(0) }), 'minecraft:stone').pass).toBe(true)
    expect(testFilter(stack('minecraft:copper_ingot'), 'minecraft:copper_ingot').pass).toBe(true)
    expect(testFilter(stack('minecraft:copper_ingot'), 'minecraft:raw_copper').pass).toBe(false)
    // 1.21.1 は数が count
    expect(testFilter(nbt.compound({ id: nbt.string('minecraft:dirt'), count: nbt.int(1) }), 'minecraft:stone').pass).toBe(false)
  })

  it('[TP-FILTER] リストフィルター：中の物のどれかに合えば通し、通さない一覧なら逆。中が空なら create:filter だけ', () => {
    const allow = listFilter(['minecraft:stone', 'minecraft:dirt'], false)
    expect(testFilter(allow, 'minecraft:dirt').pass).toBe(true)
    expect(testFilter(allow, 'minecraft:sand').pass).toBe(false)
    const deny = listFilter(['minecraft:lava_bucket'], true)
    expect(testFilter(deny, 'minecraft:lava_bucket').pass).toBe(false)
    expect(testFilter(deny, 'minecraft:bucket').pass).toBe(true)
    expect(testFilter(listFilter([], false), 'minecraft:stone').pass).toBe(false)
    expect(testFilter(listFilter([], false), 'create:filter').pass).toBe(true)
    // 中のフィルターも同じ読み方
    const nested = stack(
      'create:filter',
      nbt.compound({
        Items: nbt.compound({ Items: nbt.list('compound', [listFilter(['minecraft:stone'], false)]) }),
      }),
    )
    expect(testFilter(nested, 'minecraft:stone').pass).toBe(true)
    expect(testFilter(nested, 'minecraft:dirt').pass).toBe(false)
  })

  it('[TP-FILTER] 1.21.1 のリストフィルターは components の create:filter_items と create:filter_items_blacklist', () => {
    const filter = (blacklist: boolean) =>
      nbt.compound({
        id: nbt.string('create:filter'),
        count: nbt.int(1),
        components: nbt.compound({
          'create:filter_items': nbt.list('compound', [
            nbt.compound({ slot: nbt.int(0), item: nbt.compound({ id: nbt.string('minecraft:stone'), count: nbt.int(1) }) }),
          ]),
          'create:filter_items_blacklist': nbt.byte(blacklist ? 1 : 0),
        }),
      })
    expect(testFilter(filter(false), 'minecraft:stone').pass).toBe(true)
    expect(testFilter(filter(false), 'minecraft:dirt').pass).toBe(false)
    expect(testFilter(filter(true), 'minecraft:stone').pass).toBe(false)
  })

  it('[TP-FILTER] 属性フィルターは読めないので通し、読めなかったことを返す', () => {
    expect(testFilter(stack('create:attribute_filter'), 'minecraft:stone')).toEqual({ pass: true, unknown: 'create:attribute_filter' })
    const inList = stack(
      'create:filter',
      nbt.compound({ Items: nbt.compound({ Items: nbt.list('compound', [stack('create:attribute_filter')]) }) }),
    )
    expect(testFilter(inList, 'minecraft:stone')).toEqual({ pass: true, unknown: 'create:attribute_filter' })
  })
})

describe('フィルターの読み方の抜け', () => {
  it('中の物の一覧がないリストフィルターは、中が空のときと同じ（create:filter だけを通す）', () => {
    // 1.18.2：tag はあるが Items がない
    const noItems = stack('create:filter', nbt.compound({ RespectNBT: nbt.byte(0) }))
    expect(testFilter(noItems, 'minecraft:stone')).toEqual({ pass: false, unknown: null })
    // 1.21.1：tag も components もない
    const bare = nbt.compound({ id: nbt.string('create:filter'), count: nbt.int(1) })
    expect(testFilter(bare, 'minecraft:stone').pass).toBe(false)
    expect(testFilter(bare, 'create:filter').pass).toBe(true)
    // 1.21.1：components に create:filter_items がない
    const named = nbt.compound({
      id: nbt.string('create:filter'),
      count: nbt.int(1),
      components: nbt.compound({ 'minecraft:custom_name': nbt.string('"stone"') }),
    })
    expect(testFilter(named, 'minecraft:stone').pass).toBe(false)
  })

  it('1.21.1 で create:filter_items_blacklist がなければ、通す一覧として読む', () => {
    const filter = nbt.compound({
      id: nbt.string('create:filter'),
      count: nbt.int(1),
      components: nbt.compound({
        'create:filter_items': nbt.list('compound', [
          nbt.compound({ slot: nbt.int(0), item: nbt.compound({ id: nbt.string('minecraft:stone'), count: nbt.int(1) }) }),
        ]),
      }),
    })
    expect(testFilter(filter, 'minecraft:stone').pass).toBe(true)
    expect(testFilter(filter, 'minecraft:dirt').pass).toBe(false)
  })
})

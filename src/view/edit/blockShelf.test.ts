import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { JsonValue } from '../../io/modpack/jarScanner'
import { BLUEPRINT_TAB, matchesFilter, shelfItems, shelfTabs, type ShelfModpack } from './blockShelf'

const NAMES: Record<string, [string | null, string | null]> = {
  'create:shaft': ['シャフト', 'Shaft'],
  'create:cogwheel': ['歯車', 'Cogwheel'],
  'minecraft:stone': ['石', 'Stone'],
  'astral:dust': [null, 'Dust'],
}

const pack: ShelfModpack = {
  mods: [
    { modId: 'create', name: 'Create', version: null, jar: 'create.jar' },
    { modId: 'astral', name: 'Astral', version: null, jar: 'astral.jar' },
  ],
  blockIds: () => ['astral:dust', 'create:cogwheel', 'create:shaft', 'minecraft:stone'],
  displayName: (id, lang) => NAMES[id.toString()]?.[lang === 'ja_jp' ? 0 : 1] ?? null,
  blockStateDefinition: (id): JsonValue =>
    id.path === 'shaft' ? { variants: { 'axis=x': { model: 'm' }, 'axis=y': { model: 'm' } } } : { variants: { '': { model: 'm' } } },
}

const state = (s: string, props: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(s), props)

describe('shelfTabs', () => {
  it('この設計図を先頭に、設計図で使っている Mod、残りの Mod を名前の順に並べる', () => {
    expect(shelfTabs(pack, new Set(['create'])).map((t) => [t.id, t.label])).toEqual([
      [BLUEPRINT_TAB, 'この設計図'],
      ['ns:create', 'Create'],
      ['ns:astral', 'Astral'],
      ['ns:minecraft', 'Minecraft'],
    ])
    expect(shelfTabs(null, new Set(['create'])).map((t) => t.id)).toEqual([BLUEPRINT_TAB])
  })
})

describe('shelfItems', () => {
  it('Mod のタブは、ブロック状態の定義の最初の組み合わせで、表示名の順', () => {
    expect(shelfItems('ns:create', pack, []).map((i) => i.state.key)).toEqual(['create:shaft[axis=x]', 'create:cogwheel'])
  })

  it('この設計図のタブは、設計図にある状態そのもの。Modpack がなくても出る', () => {
    const states = [state('create:shaft', { axis: 'z' }), state('minecraft:stone')]
    expect(shelfItems(BLUEPRINT_TAB, null, states).map((i) => i.state.key)).toEqual(['create:shaft[axis=z]', 'minecraft:stone'])
    expect(shelfItems('ns:create', null, states)).toEqual([])
  })

  it('日本語名・英語名・ID の一部で、すべての言葉が入っているものに絞り込む', () => {
    expect(shelfItems('ns:create', pack, [], 'シャフト').map((i) => i.id)).toEqual(['create:shaft'])
    expect(shelfItems('ns:create', pack, [], 'cog wheel').map((i) => i.id)).toEqual(['create:cogwheel'])
    expect(shelfItems('ns:create', pack, [], 'COG').map((i) => i.id)).toEqual(['create:cogwheel'])
    expect(shelfItems('ns:create', pack, [], 'stone')).toEqual([])
    const item = shelfItems('ns:astral', pack, [])[0]!
    expect(matchesFilter(item, '  ')).toBe(true)
    expect(matchesFilter(item, 'dust astral')).toBe(true)
  })
})

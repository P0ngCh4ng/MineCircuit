// 作り物の KubeJS（docs/create-throughput.md「KubeJS のスクリプトのレシピ」）。
// スクリプトが呼ぶ関数のうち、レシピとアイテムのタグに関わるものだけを本物と同じ意味で受け付け、その場でレシピ・タグに当てはめる。
// ほかの呼び出しは何もしない値（noop）を返し、名前を数える。スクリプトに渡すのはここで作った値だけにする（runScripts.ts）。

import { flattenItemTags, type ItemTagFiles } from '../itemTags'
import { readProcessingRecipe, PROCESSING_RECIPE_TYPES, type ProcessingRecipe, type ProcessingRecipeType } from '../recipes'
import type { ScriptError, ScriptRunInput, UnsupportedCall } from './scriptTypes'
import { isSvalInternalName } from './svalNames'
import { ScriptFluid, ScriptItem, parseItemString, toIngredients, toPlainJson, toResults, toScriptItems, toSingleId, withNamespace } from './scriptValues'

/** 呼ぶイベントの処理（登録したファイルと一緒に覚える） */
interface Handler {
  readonly path: string
  readonly fn: (event: unknown) => unknown
}

/** レシピの種類の名前（`create:milling`、`milling`）を短い名前にする。読む6つ以外は null */
function processingType(name: string): ProcessingRecipeType | null {
  const short = name.startsWith('create:') ? name.slice('create:'.length) : name
  return (PROCESSING_RECIPE_TYPES as readonly string[]).includes(short) ? (short as ProcessingRecipeType) : null
}

/** `createMilling` → `milling` */
function legacyBuilderType(name: string): ProcessingRecipeType | null {
  const m = /^create([A-Z]\w*)$/.exec(name)
  return m ? processingType(m[1][0].toLowerCase() + m[1].slice(1)) : null
}

/** レシピの読む6つ以外の種類を作る、よく使う呼び出し。何もしないが、再現しないものとしては数えない */
const OTHER_RECIPE_METHODS = new Set([
  'shaped',
  'shapeless',
  'smelting',
  'blasting',
  'smoking',
  'campfireCooking',
  'stonecutting',
  'smithing',
  'smithingTransform',
  'smithingTrim',
])

/** 何もしない値。呼んでも、どの項目を読んでも、自分を返す */
export const NOOP: unknown = (() => {
  const target = function noop() {}
  let proxy: unknown = null
  const handler: ProxyHandler<typeof target> = {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => ''
      if (key === Symbol.iterator) return function* empty() {}
      // ほかの記号（処理系が「new できない関数」の印に使うものなど）は持たない
      if (typeof key === 'symbol' || key === 'then' || isSvalInternalName(key)) return undefined
      if (key === 'toString' || key === 'valueOf' || key === 'toJSON') return () => ''
      if (key === 'length' || key === 'size') return 0
      return proxy
    },
    apply: () => proxy,
    construct: () => proxy as object,
    has: () => false,
    set: () => true,
    deleteProperty: () => true,
  }
  proxy = new Proxy(target, handler)
  return proxy
})()

/** 作り物の KubeJS の状態。1回の実行につき1つ作る */
export class FakeKubeJs {
  readonly recipes = new Map<string, ProcessingRecipe>()
  readonly itemTags: ItemTagFiles
  readonly errors: ScriptError[] = []
  added = 0
  removed = 0
  /** 置き換えたレシピの ID（同じレシピを何度置き換えても1つ） */
  readonly replacedIds = new Set<string>()

  private readonly modIds: ReadonlySet<string>
  private readonly unsupported = new Map<string, number>()
  private readonly recipeHandlers: Handler[] = []
  private readonly tagHandlers: Handler[] = []
  /** いま動かしているファイル（ID を作るのとエラーの場所に使う） */
  private currentPath = ''
  private readonly serial = new Map<string, number>()
  private flatTags: Record<string, string[]> | null = null
  /** スクリプトどうしで共有する `global` */
  private readonly sharedGlobal: Record<string, unknown> = Object.create(null) as Record<string, unknown>

  constructor(input: ScriptRunInput) {
    for (const r of input.recipes) this.recipes.set(r.id, r)
    this.itemTags = Object.fromEntries(Object.entries(input.itemTags).map(([k, v]) => [k, { replace: v.replace, values: [...v.values] }]))
    this.modIds = new Set(input.modIds)
  }

  /** 再現しなかった呼び出しを数える */
  note(name: string): void {
    this.unsupported.set(name, (this.unsupported.get(name) ?? 0) + 1)
  }

  unsupportedCalls(): UnsupportedCall[] {
    return [...this.unsupported.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
  }

  setCurrentPath(path: string): void {
    this.currentPath = path
  }

  /** 名前を数えて、何もしない値を返す */
  private unsupportedValue(name: string): unknown {
    this.note(name)
    return NOOP
  }

  // ---- 大域 ----

  /** スクリプトに見せる大域（JavaScript の組み込みを除く） */
  globals(): Record<string, unknown> {
    const register = (kind: 'recipes' | 'tags', fn: unknown): void => {
      if (typeof fn !== 'function') return
      const list = kind === 'recipes' ? this.recipeHandlers : this.tagHandlers
      list.push({ path: this.currentPath, fn: fn as Handler['fn'] })
    }
    // 1.19 からの `ServerEvents.recipes(fn)`・`ServerEvents.tags('item', fn)`。ほかのイベントは登録だけ受け付けて呼ばない
    const serverEvents = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'recipes') return (fn: unknown) => register('recipes', fn)
        if (key === 'tags') {
          return (type: unknown, fn: unknown) => {
            if (type === 'item' || type === 'minecraft:item' || type === 'items') register('tags', fn)
          }
        }
        return () => undefined
      },
    })
    // ほかのイベントの入れ物（StartupEvents など）。登録だけ受け付けて呼ばない
    const otherEvents = new Proxy(Object.create(null) as Record<string, unknown>, { get: () => () => undefined })
    const item = {
      of: (id: unknown, count?: unknown) => {
        const base = id instanceof ScriptItem ? id : typeof id === 'string' ? parseItemString(id) : (toScriptItems(id)[0] ?? null)
        if (!base) return new ScriptItem('minecraft:air')
        return typeof count === 'number' ? base.withCount(count) : base
      },
      empty: new ScriptItem('minecraft:air'),
      getEmpty: () => new ScriptItem('minecraft:air'),
      exists: () => true,
      isItem: (v: unknown) => v instanceof ScriptItem,
    }
    const ingredient = {
      of: (v: unknown, count?: unknown) => {
        if (v instanceof RegExp) this.note('Ingredient.of(/正規表現/)')
        const items = toScriptItems(v)
        if (items.length === 0) return new ScriptItem('minecraft:air')
        if (items.length === 1) return typeof count === 'number' ? items[0].withCount(count) : items[0]
        return items
      },
      all: new ScriptItem('#kubejs:all'),
      none: new ScriptItem('minecraft:air'),
      custom: () => this.unsupportedValue('Ingredient.custom'),
    }
    const fluid = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'of') return (id: unknown) => new ScriptFluid(String(id))
        if (typeof key === 'string') return () => new ScriptFluid(`minecraft:${key}`)
        return undefined
      },
    })
    const platform = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'isLoaded') return (id: unknown) => typeof id === 'string' && this.modIds.has(id)
        if (key === 'isClientEnvironment') return () => false
        if (key === 'isForge' || key === 'isFabric' || key === 'isNeoForge') return () => false
        return this.unsupportedValue(`Platform.${String(key)}`)
      },
    })
    const unsupportedGlobal = (name: string) =>
      new Proxy(function unsupported() {}, {
        get: (_t, key) => this.unsupportedValue(`${name}.${String(key)}`),
        apply: (_t, _this, args: unknown[]) => this.unsupportedValue(`${name}(${typeof args[0] === 'string' ? args[0] : ''})`),
      })
    const quiet = () => undefined
    return {
      onEvent: (name: unknown, fn: unknown) => {
        if (name === 'recipes') register('recipes', fn)
        else if (name === 'item.tags' || name === 'tags.items' || name === 'tags.item') register('tags', fn)
      },
      ServerEvents: serverEvents,
      StartupEvents: otherEvents,
      ClientEvents: otherEvents,
      PlayerEvents: otherEvents,
      BlockEvents: otherEvents,
      ItemEvents: otherEvents,
      EntityEvents: otherEvents,
      LevelEvents: otherEvents,
      NetworkEvents: otherEvents,
      CommonAddedEvents: otherEvents,
      JEIEvents: otherEvents,
      REIEvents: otherEvents,
      Item: item,
      Ingredient: ingredient,
      Fluid: fluid,
      // 1.21 の kubejs-create の確率付きの物
      CreateItem: { of: (id: unknown, chance?: unknown) => (item.of(id) as ScriptItem).withChance(chance ?? 1) },
      Platform: platform,
      console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
      global: this.sharedGlobal,
      // 1.18 の KubeJS の設定（settings.logAddedRecipes など）。読み書きだけ受け付ける
      settings: Object.create(null) as Record<string, unknown>,
      java: unsupportedGlobal('java'),
      Java: unsupportedGlobal('Java'),
      Utils: unsupportedGlobal('Utils'),
      JsonIO: unsupportedGlobal('JsonIO'),
      NBT: unsupportedGlobal('NBT'),
      Text: unsupportedGlobal('Text'),
      Component: unsupportedGlobal('Component'),
    }
  }

  // ---- イベントを呼ぶ ----

  /** 登録したタグのイベント、レシピのイベントの順に呼ぶ（ゲームもタグを先に読む） */
  fireEvents(): void {
    for (const h of this.tagHandlers) this.call(h, this.tagEvent())
    this.flatTags = flattenItemTags(this.itemTags)
    for (const h of this.recipeHandlers) this.call(h, this.recipeEvent())
  }

  private call(h: Handler, event: unknown): void {
    this.currentPath = h.path
    try {
      h.fn(event)
    } catch (e) {
      this.errors.push({ path: h.path, message: e instanceof Error ? e.message : String(e) })
    }
  }

  // ---- タグ ----

  private tagEvent(): unknown {
    const values = (v: unknown): string[] => {
      const out: string[] = []
      for (const x of Array.isArray(v) ? v : [v]) {
        if (typeof x === 'string' && (x.startsWith('/') || x.startsWith('@'))) {
          this.note(`タグの値 ${x.startsWith('/') ? '/正規表現/' : '@Mod'}`)
          continue
        }
        const id = toSingleId(x)
        if (id) out.push(id)
      }
      return out
    }
    const tagName = (t: unknown): string | null => (typeof t === 'string' ? withNamespace(t.replace(/^#/, '')) : null)
    const file = (tag: string) => (Object.hasOwn(this.itemTags, tag) ? this.itemTags[tag] : (this.itemTags[tag] = { replace: false, values: [] }))
    const add = (t: unknown, v: unknown) => {
      const tag = tagName(t)
      if (!tag) return
      const f = file(tag)
      this.itemTags[tag] = { replace: f.replace, values: [...new Set([...f.values, ...values(v)])] }
    }
    const remove = (t: unknown, v: unknown) => {
      const tag = tagName(t)
      if (!tag) return
      const drop = new Set(values(v))
      const f = file(tag)
      this.itemTags[tag] = { replace: f.replace, values: f.values.filter((x) => !drop.has(x)) }
    }
    const removeAll = (t: unknown) => {
      const tag = tagName(t)
      if (tag) this.itemTags[tag] = { replace: true, values: [] }
    }
    const removeAllTagsFrom = (v: unknown) => {
      const drop = new Set(values(v))
      for (const [tag, f] of Object.entries(this.itemTags)) this.itemTags[tag] = { replace: f.replace, values: f.values.filter((x) => !drop.has(x)) }
    }
    const get = (t: unknown) => ({
      add: (v: unknown) => add(t, v),
      remove: (v: unknown) => remove(t, v),
      removeAll: () => removeAll(t),
      getObjectIds: () => {
        const tag = tagName(t)
        return tag && Object.hasOwn(this.itemTags, tag) ? [...this.itemTags[tag].values] : []
      },
    })
    return this.eventObject('タグのイベント', { add, remove, removeAll, removeAllTagsFrom, get })
  }

  // ---- レシピ ----

  private nextId(): string {
    const n = (this.serial.get(this.currentPath) ?? 0) + 1
    this.serial.set(this.currentPath, n)
    return `kubejs:script/${this.currentPath.replace(/\.js$/i, '')}/${n}`
  }

  /** レシピを足し、`.processingTime(n)`・`.id(id)` で変えられる値を返す */
  private addRecipe(recipe: ProcessingRecipe): unknown {
    let current = recipe
    this.recipes.set(current.id, current)
    this.added++
    const builder: Record<string, unknown> = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'processingTime' || key === 'processing_time') {
          return (n: unknown) => {
            if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
              current = { ...current, duration: Math.floor(n) }
              this.recipes.set(current.id, current)
            }
            return builder
          }
        }
        if (key === 'id') {
          return (id: unknown) => {
            if (typeof id === 'string' && id !== '') {
              this.recipes.delete(current.id)
              current = { ...current, id: withNamespace(id).replace(/^#/, '') }
              this.recipes.set(current.id, current)
            }
            return builder
          }
        }
        if (key === 'then' || typeof key === 'symbol') return undefined
        // 熱（heatRequirement）など、処理時間と材料に関わらないもの
        return () => builder
      },
    })
    return builder
  }

  /** `.processingTime(n)` を呼ばないときの処理時間。kubejs-create の初期値（1802 の ProcessingRecipeJS、2001 の ProcessingRecipeSchema） */
  private static readonly DEFAULT_PROCESSING_TIME = 100

  private builderFor(type: ProcessingRecipeType): (outputs: unknown, inputs: unknown) => unknown {
    return (outputs, inputs) => {
      const { items, tags } = toIngredients(inputs)
      const duration = FakeKubeJs.DEFAULT_PROCESSING_TIME
      return this.addRecipe({ id: this.nextId(), type, items, tags, duration, results: toResults(outputs) })
    }
  }

  private recipeEvent(): unknown {
    // `event.recipes.create.milling(…)`
    const create = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined
        const type = processingType(key)
        return type ? this.builderFor(type) : NOOP
      },
    })
    // `event.recipes.createMilling(…)`・`event.recipes.create.milling(…)`。ほかの Mod の種類は何もしない
    const recipes = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (key === 'create') return create
        if (typeof key !== 'string') return undefined
        const type = legacyBuilderType(key)
        return type ? this.builderFor(type) : NOOP
      },
    })
    const custom = (json: unknown) => {
      const plain = toPlainJson(json)
      const given = typeof plain === 'object' && plain !== null && typeof (plain as { id?: unknown }).id === 'string' ? (plain as { id: string }).id : null
      const recipe = readProcessingRecipe(given ?? this.nextId(), plain)
      return recipe ? this.addRecipe(recipe) : NOOP
    }
    const remove = (filter: unknown) => {
      const match = this.filter(filter)
      if (!match) return
      for (const r of [...this.recipes.values()]) {
        if (match(r)) {
          this.recipes.delete(r.id)
          this.removed++
        }
      }
    }
    const replace = (which: 'input' | 'output') => (a: unknown, b: unknown, c?: unknown) => {
      // 2つの引数なら、すべてのレシピが相手（1.18 の古い書き方）
      const [filter, from, to] = c === undefined ? [{}, a, b] : [a, b, c]
      const match = this.filter(filter)
      const fromId = toSingleId(from)
      const toId = toSingleId(to)
      if (!match || !fromId || !toId) return
      for (const r of [...this.recipes.values()]) {
        if (!match(r)) continue
        const next = which === 'input' ? replaceInput(r, fromId, toId) : replaceOutput(r, fromId, toId)
        if (next !== r) {
          this.recipes.set(r.id, next)
          this.replacedIds.add(r.id)
        }
      }
    }
    const each = (filter: unknown, fn: unknown) => {
      const match = this.filter(filter)
      if (!match || typeof fn !== 'function') return
      for (const r of [...this.recipes.values()]) if (match(r)) (fn as (r: unknown) => unknown)(this.recipeView(r))
    }
    const methods: Record<string, unknown> = {
      recipes,
      custom,
      remove,
      replaceInput: replace('input'),
      replaceOutput: replace('output'),
      forEachRecipe: each,
      findRecipes: (filter: unknown) => {
        const match = this.filter(filter)
        return match ? [...this.recipes.values()].filter(match).map((r) => this.recipeView(r)) : []
      },
      containsRecipe: (filter: unknown) => {
        const match = this.filter(filter)
        return match ? [...this.recipes.values()].some(match) : false
      },
      countRecipes: (filter: unknown) => {
        const match = this.filter(filter)
        return match ? [...this.recipes.values()].filter(match).length : 0
      },
    }
    for (const name of OTHER_RECIPE_METHODS) methods[name] = () => NOOP
    return this.eventObject('レシピのイベント', methods)
  }

  /** `forEachRecipe` に渡すレシピ。ID と種類だけを読める */
  private recipeView(r: ProcessingRecipe): unknown {
    const known: Record<string, unknown> = {
      getId: () => r.id,
      getType: () => `create:${r.type}`,
      getMod: () => r.id.split(':')[0],
      id: r.id,
      type: `create:${r.type}`,
    }
    return new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (typeof key === 'string' && key in known) return known[key]
        if (typeof key === 'symbol' || key === 'then') return undefined
        return this.unsupportedValue(`レシピの ${key}`)
      },
    })
  }

  /** イベントの値。知らない項目は数えて何もしない値を返す */
  private eventObject(name: string, methods: Record<string, unknown>): unknown {
    return new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_t, key) => {
        if (typeof key === 'string' && Object.hasOwn(methods, key)) return methods[key]
        if (typeof key === 'symbol' || key === 'then') return undefined
        return this.unsupportedValue(`${name}の ${key}`)
      },
    })
  }

  // ---- レシピの条件 ----

  /** `event.remove` などの条件を、レシピを調べる関数にする。読めない条件なら null（何もしない） */
  filter(value: unknown): ((r: ProcessingRecipe) => boolean) | null {
    if (value === undefined || value === null) return () => true
    if (typeof value === 'string') {
      if (value === '*') return () => true
      const id = withNamespace(value)
      return (r) => r.id === id
    }
    if (value instanceof RegExp) return (r) => value.test(r.id)
    if (Array.isArray(value)) {
      const parts = value.map((v) => this.filter(v))
      if (parts.some((p) => p === null)) return null
      return (r) => parts.some((p) => p!(r))
    }
    if (typeof value !== 'object') return null
    const obj = value as Record<string, unknown>
    const parts: ((r: ProcessingRecipe) => boolean)[] = []
    for (const [key, v] of Object.entries(obj)) {
      const part = this.filterPart(key, v)
      if (!part) {
        this.note(`レシピの条件 ${key}`)
        return null
      }
      parts.push(part)
    }
    return (r) => parts.every((p) => p(r))
  }

  private filterPart(key: string, v: unknown): ((r: ProcessingRecipe) => boolean) | null {
    const any = (f: (x: unknown) => ((r: ProcessingRecipe) => boolean) | null) => {
      const list = (Array.isArray(v) ? v : [v]).map(f)
      if (list.some((p) => p === null)) return null
      return (r: ProcessingRecipe) => list.some((p) => p!(r))
    }
    switch (key) {
      case 'not': {
        const inner = this.filter(v)
        return inner ? (r) => !inner(r) : null
      }
      case 'or':
        return Array.isArray(v) ? this.filter(v) : null
      case 'id':
        return any((x) => (x instanceof RegExp ? (r) => x.test(r.id) : typeof x === 'string' ? (r) => r.id === withNamespace(x) : null))
      case 'mod':
        return any((x) => (typeof x === 'string' ? (r) => r.id.split(':')[0] === x : null))
      case 'type':
        return any((x) => {
          if (x instanceof RegExp) return (r) => x.test(`create:${r.type}`)
          if (typeof x !== 'string') return null
          const t = processingType(x)
          // 読む6つ以外の種類は、ここにあるどのレシピにも合わない
          return (r) => t !== null && r.type === t
        })
      case 'output':
        return any((x) => {
          const id = toSingleId(x)
          return id ? (r) => r.results.some((res) => this.itemMatches(res.item, id)) : null
        })
      case 'input':
        return any((x) => {
          const id = toSingleId(x)
          if (!id) return null
          if (id.startsWith('#')) {
            const tag = id.slice(1)
            return (r) => r.tags.includes(tag) || r.items.some((item) => this.itemMatches(item, id))
          }
          return (r) => r.items.includes(id) || r.tags.some((tag) => this.tagItems(tag).includes(id))
        })
      default:
        return null
    }
  }

  /** アイテムが、ID かタグ（`#` 付き）に合うか */
  private itemMatches(item: string, idOrTag: string): boolean {
    return idOrTag.startsWith('#') ? this.tagItems(idOrTag.slice(1)).includes(item) : item === idOrTag
  }

  private tagItems(tag: string): readonly string[] {
    this.flatTags ??= flattenItemTags(this.itemTags)
    return this.flatTags[tag] ?? []
  }
}

/** 材料の from（ID か `#` 付きのタグ）を to に置き換える。変わらなければ同じものを返す */
function replaceInput(r: ProcessingRecipe, from: string, to: string): ProcessingRecipe {
  const fromTag = from.startsWith('#') ? from.slice(1) : null
  const hit = fromTag ? r.tags.includes(fromTag) : r.items.includes(from)
  if (!hit) return r
  const items = fromTag ? [...r.items] : r.items.filter((x) => x !== from)
  const tags = fromTag ? r.tags.filter((x) => x !== fromTag) : [...r.tags]
  if (to.startsWith('#')) tags.push(to.slice(1))
  else items.push(to)
  return { ...r, items: [...new Set(items)], tags: [...new Set(tags)] }
}

/** できる物の from を to に置き換える（タグは扱わない） */
function replaceOutput(r: ProcessingRecipe, from: string, to: string): ProcessingRecipe {
  if (from.startsWith('#') || to.startsWith('#') || !r.results.some((x) => x.item === from)) return r
  return { ...r, results: r.results.map((x) => (x.item === from ? { ...x, item: to } : x)) }
}

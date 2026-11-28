// 物の通り道を、ブロックごとの置き方で、そのブロックのすべての状態について確かめる（docs/create-verification.md「2. 状態の組み合わせ」）。
// 真ん中に置いて6つの面にチェストを並べる置き方（createItemPathStates.test.ts）では物が流れないブロック
// （デポ・ベルトのファンネル・トンネル・上の機械など）を、物が流れる置き方（ベルトの上のトンネル、デポの上のプレスなど）に置く。
// 期待値はコードの式をなぞらず、「置き方ごとまわす・反転すると、物のつながりと物の動き（止まる時間も）が同じだけ動く」という性質で書く。
import { describe, expect, it } from 'vitest'
import type { CalcModpack, CalcResult } from '../../src/calc/calcPlugin'
import { planBeltConnection } from '../../src/calc/create/createBeltConnector'
import { recipeTypeId, type CreateRecipeKind } from '../../src/calc/create/createRecipeTypes'
import { runCreateStress } from '../../src/calc/create/createStressPlugin'
import { transformCreateBlockEntity, transformCreateState } from '../../src/calc/create/createTransform'
import { clockwise } from '../../src/calc/create/kineticBlocks'
import { CREATE_STRESS_PLUGIN_ID, ITEM_INPUT_PORT_KIND } from '../../src/calc/create/kineticGraph'
import type { VirtualPort } from '../../src/calc/virtualPort'
import { BlockState } from '../../src/domain/blockState'
import { transformPos, type BlockTransform } from '../../src/domain/blockTransform'
import { directionVector, type Direction } from '../../src/domain/direction'
import { nbt, type RawNbt } from '../../src/domain/nbt'
import { ResourceLocation } from '../../src/domain/resourceLocation'
import { addVec3, type Vec3 } from '../../src/domain/vec3'
import type { ProcessingRecipe, RecipeBook, RecipeResult } from '../../src/io/modpack/recipes'
import { blueprintFixture } from '../fixtures/blueprintFixture'
import { CATALOGS, stateCombinations, type Catalog } from './createBlockCatalog'
import { FLOWS_HERE, itemLinks, itemMoves, rpmSign, tracedBlocks } from './itemPathCompare'

/** 置き方の大きさ。まわす・反転する中心は [4, *, 4] なので、まわしても範囲を出ない */
const SIZE: Vec3 = [9, 7, 9]
const PIVOT: Vec3 = [4, 0, 4]
const BOX = { min: [0, 0, 0] as Vec3, max: [SIZE[0] - 1, SIZE[1] - 1, SIZE[2] - 1] as Vec3 }

const TRANSFORMS: readonly { name: string; t: BlockTransform }[] = [
  { name: '90°', t: { translate: [0, 0, 0], quarterTurns: 1, mirror: 'none', pivot: PIVOT } },
  { name: '180°', t: { translate: [0, 0, 0], quarterTurns: 2, mirror: 'none', pivot: PIVOT } },
  { name: 'x の反転', t: { translate: [0, 0, 0], quarterTurns: 0, mirror: 'x', pivot: PIVOT } },
  { name: 'z の反転', t: { translate: [0, 0, 0], quarterTurns: 0, mirror: 'z', pivot: PIVOT } },
]

const RPM = 64

// ---- レシピ（テスト用。Mod の数値ではなく、物が変わることだけを見る） ----

const out = (item: string): RecipeResult => ({ item, count: 1, chance: 1 })
const recipe = (id: string, type: CreateRecipeKind, items: string[], duration: number, result: string): ProcessingRecipe => ({
  id,
  type: recipeTypeId(type),
  items,
  tags: [],
  duration,
  results: [out(result)],
})
const BOOK: RecipeBook = {
  recipes: [
    recipe('test:pressing', 'pressing', ['minecraft:iron_ingot'], 0, 'create:iron_sheet'),
    recipe('test:compacting', 'compacting', ['minecraft:flint'], 0, 'minecraft:granite'),
    recipe('test:mixing', 'mixing', ['minecraft:andesite'], 0, 'create:andesite_alloy'),
    recipe('test:milling', 'milling', ['minecraft:wheat'], 150, 'create:wheat_flour'),
    recipe('test:crushing', 'crushing', ['minecraft:gravel'], 250, 'minecraft:flint'),
    recipe('test:cutting', 'cutting', ['minecraft:oak_log'], 50, 'minecraft:stripped_oak_log'),
    recipe('test:splashing', 'splashing', ['minecraft:gravel'], 0, 'minecraft:flint'),
  ],
  scriptsChangeRecipes: false,
  itemTags: {},
}
const PACK: CalcModpack = {
  hasNamespace: () => true,
  config: () => Promise.resolve(null),
  recipeBook: () => Promise.resolve(BOOK),
}

// ---- 置き方 ----

interface Cell {
  readonly pos: Vec3
  readonly state: BlockState
  readonly nbt?: RawNbt
}

/** 置き方1つ分。仮の動力源は rpm に、まわしたときの符号を掛ける */
interface Layout {
  readonly cells: readonly Cell[]
  readonly items: readonly { readonly pos: Vec3; readonly item: string }[]
  readonly sources: readonly { readonly pos: Vec3; readonly rpm: number }[]
}

const state = (id: string, props: Record<string, string> = {}): BlockState => new BlockState(ResourceLocation.parse(id), props)
const W = { waterlogged: 'false' }
const CHEST = state('minecraft:chest', { facing: 'north', type: 'single', ...W })
const CHEST_NBT = nbt.compound({ Items: nbt.list('compound') })
const chest = (pos: Vec3): Cell => ({ pos, state: CHEST, nbt: CHEST_NBT })
const DEPOT = state('create:depot')
const WATER = state('minecraft:water', { level: '0' })
/** 横向きの取り出すファンネル。後ろ（facing の反対）の入れ物から取り出し、真下に落とす */
const extractor = (pos: Vec3, facing: Direction): Cell => ({
  pos,
  state: state('create:andesite_funnel', { extracting: 'true', facing, powered: 'false', ...W }),
})

/** ベルト（z = 4 の上を x = 2〜6）。両端のプーリーのシャフトの軸は z */
function belt(z = 4): Cell[] {
  const fx = blueprintFixture({ size: SIZE })
    .place([2, 1, z], 'create:shaft', { axis: 'z', ...W })
    .place([6, 1, z], 'create:shaft', { axis: 'z', ...W })
  const plan = planBeltConnection(fx.toBlueprint(), [2, 1, z], [6, 1, z])
  if (plan === null || typeof plan === 'string') throw new Error(`ベルトを掛けられません：${plan}`)
  return plan.segments.map((s) => ({ pos: s.pos, state: s.after.state!, ...(s.after.blockEntity ? { nbt: s.after.blockEntity } : {}) }))
}
const BELT = belt()
const BELT_2 = belt(5)

/** ベルトの両端の先のチェストと、両端の物の入口・プーリーの動力源。回転数の符号で進む向きが変わる */
function beltLine(rpm: number, item: string, z = 4): Layout {
  return {
    cells: [...(z === 4 ? BELT : BELT_2), chest([1, 1, z]), chest([7, 1, z])],
    items: [
      { pos: [2, 1, z], item },
      { pos: [6, 1, z], item },
    ],
    sources: [{ pos: [2, 1, z], rpm }],
  }
}

const join = (...ls: Layout[]): Layout => ({
  cells: ls.flatMap((l) => l.cells),
  items: ls.flatMap((l) => l.items),
  sources: ls.flatMap((l) => l.sources),
})
const cells = (...cs: Cell[]): Layout => ({ cells: cs, items: [], sources: [] })
const items = (item: string, ...ps: Vec3[]): Layout => ({ cells: [], items: ps.map((pos) => ({ pos, item })), sources: [] })
const source = (pos: Vec3, rpm = RPM): Layout => ({ cells: [], items: [], sources: [{ pos, rpm }] })

/** 機械アームの生データ。取る点と置く点は、アームからの相対位置 */
function armNbt(take: Vec3, deposit: Vec3): RawNbt {
  return nbt.compound({
    InteractionPoints: nbt.list('compound', [
      nbt.compound({ Pos: nbt.intArray(take), Mode: nbt.string('TAKE') }),
      nbt.compound({ Pos: nbt.intArray(deposit), Mode: nbt.string('DEPOSIT') }),
    ]),
  })
}

interface LayoutDef {
  readonly name: string
  /** この置き方で状態をすべて変えて確かめるブロック */
  readonly ids: readonly string[]
  /** 状態を持たないので、置き方の中に置くだけで確かめるブロック（デポ） */
  readonly fixed?: readonly string[]
  /** 状態 s のブロックを置いた置き方。回転数（ベルトの向き）と生データの違いごとに1つ */
  readonly build: (s: BlockState) => Layout[]
  /** 物がどこかで止まる（機械で処理する・トンネルで待つ）はずなら true。どこかの状態で止まる時間が出ることを確かめる */
  readonly holds?: boolean
  /**
   * 反転したとき、仮の動力源をブロックの向きから見て同じ向きに回す理由（ふつうは、反転すると回る向きが逆になるとする）。
   * 回る向きで働きが変わり、その向きをブロックの facing から決めるブロックに使う
   */
  readonly mirrorKeepsFacingSpeed?: string
}

const BOTH = [RPM, -RPM]

const LAYOUTS: readonly LayoutDef[] = [
  {
    name: 'ベルトの上のベルトのファンネル（まわりにチェスト）',
    ids: ['create:andesite_belt_funnel', 'create:brass_belt_funnel'],
    build: (s) =>
      BOTH.map((rpm) =>
        join(
          beltLine(rpm, 'minecraft:cobblestone'),
          cells({ pos: [4, 2, 4], state: s }, chest([3, 2, 4]), chest([5, 2, 4]), chest([4, 2, 3]), chest([4, 2, 5])),
          // 後ろのチェストから押し出す物
          items('minecraft:stick', [3, 2, 4], [5, 2, 4], [4, 2, 3], [4, 2, 5]),
        ),
      ),
  },
  {
    name: 'デポの上のベルトのファンネル（まわりにチェスト）',
    ids: ['create:andesite_belt_funnel', 'create:brass_belt_funnel'],
    fixed: ['create:depot'],
    build: (s) => [
      join(
        cells({ pos: [4, 1, 4], state: DEPOT }, { pos: [4, 2, 4], state: s }, chest([3, 2, 4]), chest([5, 2, 4]), chest([4, 2, 3]), chest([4, 2, 5])),
        items('minecraft:cobblestone', [4, 1, 4]),
        items('minecraft:stick', [3, 2, 4], [5, 2, 4], [4, 2, 3], [4, 2, 5]),
      ),
    ],
  },
  {
    name: 'ベルトの上のトンネル（横にチェスト）',
    ids: ['create:andesite_tunnel', 'create:brass_tunnel'],
    holds: true,
    build: (s) =>
      BOTH.flatMap((rpm) =>
        // 真鍮のトンネルは、生データのない（等しく分ける）ものと、近い方へ出すもの（ScrollValue 4）
        [undefined, nbt.compound({ ScrollValue: nbt.int(4) })].map((be) =>
          join(
            beltLine(rpm, 'minecraft:cobblestone'),
            cells({ pos: [4, 2, 4], state: s, ...(be ? { nbt: be } : {}) }, chest([4, 1, 3]), chest([4, 1, 5])),
          ),
        ),
      ),
  },
  {
    name: '並んだ2本のベルトの上の真鍮のトンネル（組の両端の横にチェスト）',
    ids: ['create:brass_tunnel'],
    holds: true,
    build: (s) =>
      BOTH.map((rpm) =>
        join(
          beltLine(rpm, 'minecraft:cobblestone'),
          { ...beltLine(rpm, 'minecraft:cobblestone', 5), items: [] },
          cells({ pos: [4, 2, 4], state: s }, { pos: [4, 2, 5], state: s }, chest([4, 1, 3]), chest([4, 1, 6])),
        ),
      ),
  },
  {
    name: 'ベルトの上のプレス',
    ids: ['create:mechanical_press'],
    holds: true,
    build: (s) => BOTH.map((rpm) => join(beltLine(rpm, 'minecraft:iron_ingot'), cells({ pos: [4, 3, 4], state: s }), source([4, 3, 4]))),
  },
  {
    name: 'デポの上のプレス（デポから取り出すファンネル）',
    ids: ['create:mechanical_press'],
    fixed: ['create:depot'],
    holds: true,
    build: (s) => [
      join(
        cells({ pos: [4, 1, 4], state: DEPOT }, { pos: [4, 3, 4], state: s }, extractor([5, 1, 4], 'east'), chest([5, 0, 4])),
        items('minecraft:iron_ingot', [4, 1, 4]),
        source([4, 3, 4]),
      ),
    ],
  },
  {
    name: 'ベイスンの上のプレス・ミキサー（下のまわりにチェスト）',
    ids: ['create:basin', 'create:mechanical_mixer'],
    holds: true,
    build: (s) => {
      const machines: [BlockState, string][] =
        s.id.path === 'mechanical_mixer'
          ? [[s, 'minecraft:andesite']]
          : [
              [state('create:mechanical_press', { facing: 'north' }), 'minecraft:flint'],
              [state('create:mechanical_mixer'), 'minecraft:andesite'],
            ]
      const basins = s.id.path === 'basin' ? [s] : [state('create:basin', { facing: 'down' })]
      return machines.flatMap(([m, item]) =>
        basins.map((b) =>
          join(
            cells(
              { pos: [4, 1, 4], state: b },
              { pos: [4, 3, 4], state: m },
              chest([3, 0, 4]),
              chest([5, 0, 4]),
              chest([4, 0, 3]),
              chest([4, 0, 5]),
              // 下向きのベイスンから取り出す
              extractor([3, 1, 4], 'west'),
            ),
            items(item, [4, 1, 4]),
            source([4, 3, 4]),
          ),
        ),
      )
    },
  },
  {
    name: 'ベルトの上のデプロイヤー',
    ids: ['create:deployer'],
    holds: true,
    build: (s) => BOTH.map((rpm) => join(beltLine(rpm, 'minecraft:cobblestone'), cells({ pos: [4, 3, 4], state: s }), source([4, 3, 4]))),
  },
  {
    name: 'デプロイヤーの手の物を、2つ先のブレイズバーナーへ（6つの向きに置く）',
    ids: ['create:deployer', 'create:blaze_burner'],
    holds: true,
    build: (s) => {
      const deployer = s.id.path === 'deployer' ? s : state('create:deployer', { axis_along_first: 'false', facing: 'down' })
      const burner = s.id.path === 'blaze_burner' ? s : state('create:blaze_burner')
      const around: Vec3[] = [
        [2, 3, 4],
        [6, 3, 4],
        [4, 1, 4],
        [4, 5, 4],
        [4, 3, 2],
        [4, 3, 6],
      ]
      return [
        join(
          cells({ pos: [4, 3, 4], state: deployer }, ...around.map((pos) => ({ pos, state: burner }))),
          items('minecraft:coal', [4, 3, 4]),
          source([4, 3, 4]),
        ),
      ]
    },
  },
  {
    name: 'ベルトの上のスパウト（横に水）',
    ids: ['create:spout'],
    holds: true,
    build: (s) => BOTH.map((rpm) => join(beltLine(rpm, 'minecraft:bucket'), cells({ pos: [4, 3, 4], state: s }, { pos: [5, 3, 4], state: WATER }))),
  },
  {
    name: 'ベルトの端のアイテムドレイン（先にチェスト）',
    ids: ['create:item_drain'],
    holds: true,
    build: (s) =>
      BOTH.map((rpm) => ({
        cells: [...BELT, { pos: [1, 1, 4] as Vec3, state: s }, { pos: [7, 1, 4] as Vec3, state: s }, chest([0, 1, 4]), chest([8, 1, 4])],
        items: beltLine(rpm, 'minecraft:potion').items,
        sources: beltLine(rpm, 'minecraft:potion').sources,
      })),
  },
  {
    name: '石臼（取り出すファンネル）',
    ids: ['create:millstone'],
    holds: true,
    build: (s) => [
      join(cells({ pos: [4, 2, 4], state: s }, extractor([5, 2, 4], 'east'), chest([5, 1, 4])), items('minecraft:wheat', [4, 2, 4]), source([4, 2, 4])),
    ],
  },
  {
    name: '粉砕ホイールの組（下にチェスト）',
    ids: ['create:crushing_wheel', 'create:crushing_wheel_controller'],
    holds: true,
    build: (s) => {
      const wheel = s.id.path === 'crushing_wheel' ? s : state('create:crushing_wheel', { axis: 'z' })
      const controller = s.id.path === 'crushing_wheel_controller' ? s : state('create:crushing_wheel_controller', { valid: 'true' })
      return [
        join(
          cells({ pos: [3, 2, 4], state: wheel }, { pos: [5, 2, 4], state: wheel }, { pos: [4, 2, 4], state: controller }, chest([4, 1, 4])),
          items('minecraft:gravel', [4, 2, 4]),
          // 2つのホイールは逆に回す
          source([3, 2, 4], RPM),
          source([5, 2, 4], -RPM),
        ),
      ]
    },
  },
  {
    name: 'ソー（まわりにチェスト）',
    ids: ['create:mechanical_saw'],
    holds: true,
    build: (s) =>
      BOTH.map((rpm) =>
        join(
          cells({ pos: [4, 2, 4], state: s }, chest([3, 2, 4]), chest([5, 2, 4]), chest([4, 2, 3]), chest([4, 2, 5])),
          items('minecraft:oak_log', [4, 2, 4]),
          source([4, 2, 4], rpm),
        ),
      ),
  },
  {
    name: '機械アーム（デポからチェストへ、チェストからプレスの下のデポへ）',
    ids: ['create:mechanical_arm'],
    fixed: ['create:depot'],
    holds: true,
    build: (s) => [
      join(
        cells({ pos: [4, 1, 4], state: s, nbt: armNbt([-2, 0, 0], [2, 0, 0]) }, { pos: [2, 1, 4], state: DEPOT }, chest([6, 1, 4])),
        items('minecraft:cobblestone', [2, 1, 4]),
        source([4, 1, 4]),
      ),
      join(
        cells(
          { pos: [4, 1, 4], state: s, nbt: armNbt([0, 0, -2], [0, 0, 2]) },
          chest([4, 1, 2]),
          { pos: [4, 1, 6], state: DEPOT },
          { pos: [4, 3, 6], state: state('create:mechanical_press', { facing: 'east' }) },
          extractor([5, 1, 6], 'east'),
          chest([5, 0, 6]),
        ),
        items('minecraft:iron_ingot', [4, 1, 2]),
        source([4, 1, 4]),
        source([4, 3, 6]),
      ),
    ],
  },
  {
    name: '扇風機（6つの向きに、水・デポ・取り出すファンネル）',
    ids: ['create:encased_fan'],
    fixed: ['create:depot'],
    holds: true,
    mirrorKeepsFacingSpeed:
      '扇風機の押す・引くは、回転数を facing の向きから見た符号だけで決まる（EncasedFanBlockEntity.getAirFlowDirection。羽根の左右の形はない）。反転して回る向きが逆になると、ゲームでも押す・引くが入れ替わる',
    build: (s) => {
      const fan = s.id.path === 'encased_fan' ? s : state('create:encased_fan', { facing: 'east' })
      const c: Vec3 = [4, 3, 4]
      const parts: Cell[] = [{ pos: c, state: fan }]
      const depots: Vec3[] = []
      for (const d of ['east', 'west', 'north', 'south', 'up', 'down'] as const) {
        const v = directionVector(d)
        const depot = addVec3(c, [v[0] * 2, v[1] * 2, v[2] * 2])
        const side: Direction = d === 'up' || d === 'down' ? 'east' : clockwise(d)
        const funnel = addVec3(depot, directionVector(side))
        parts.push({ pos: addVec3(c, v), state: WATER }, { pos: depot, state: DEPOT }, extractor(funnel, side), chest(addVec3(funnel, [0, -1, 0])))
        depots.push(depot)
      }
      return BOTH.map((rpm) => join(cells(...parts), items('minecraft:gravel', ...depots), source(c, rpm)))
    },
  },
]

// ---- 計算と変換 ----

function ports(l: Layout): VirtualPort[] {
  return [
    ...l.items.map(
      (p, i): VirtualPort => ({
        id: `item-${i}`,
        pos: p.pos,
        pluginId: CREATE_STRESS_PLUGIN_ID,
        kind: ITEM_INPUT_PORT_KIND,
        params: { rate: 1 },
        items: { item: p.item },
      }),
    ),
    ...l.sources.map(
      (p, i): VirtualPort => ({
        id: `source-${i}`,
        pos: p.pos,
        pluginId: CREATE_STRESS_PLUGIN_ID,
        kind: 'rotation-source',
        params: { rpm: p.rpm, capacity: Number.MAX_SAFE_INTEGER },
      }),
    ),
  ]
}

async function run(l: Layout): Promise<CalcResult> {
  const fx = blueprintFixture({ size: SIZE })
  for (const c of l.cells) {
    if (c.nbt) fx.place(c.pos, c.state, c.nbt)
    else fx.place(c.pos, c.state)
  }
  return runCreateStress(fx.toBlueprint(), { pack: PACK, ports: ports(l), mode: 'saved' })
}

/**
 * 置き方ごとまわす・反転する。ブロックの状態と生データの中の相対位置も変え、動力源の回転数は同じ向きに回るよう符号を合わせる。
 * keepFacingSpeed なら、反転でも回る向きを逆にしない（LayoutDef.mirrorKeepsFacingSpeed）
 */
function transformLayout(l: Layout, t: BlockTransform, keepFacingSpeed = false): Layout {
  const flip = keepFacingSpeed && t.mirror !== 'none' ? -1 : 1
  const at = new Map(l.cells.map((c) => [c.pos.join(','), c.state]))
  return {
    cells: l.cells.map((c) => {
      const pos = transformPos(t, c.pos)
      const moved = transformCreateState(c.state, t) ?? c.state
      const be = c.nbt ? (transformCreateBlockEntity(c.state, c.nbt, t, c.pos, pos, BOX)?.nbt ?? c.nbt) : undefined
      return { pos, state: moved, ...(be ? { nbt: be } : {}) }
    }),
    items: l.items.map((p) => ({ ...p, pos: transformPos(t, p.pos) })),
    sources: l.sources.map((p) => ({ pos: transformPos(t, p.pos), rpm: p.rpm * rpmSign(at.get(p.pos.join(','))!, t) * flip })),
  }
}

const short = (ls: readonly string[]): string => (ls.length > 6 ? `${ls.slice(0, 6).join(' ')} …（${ls.length} 本）` : ls.join(' '))

function blocksOf(c: Catalog, def: LayoutDef): string[] {
  return def.ids.filter((id) => c.blocks[id])
}

for (const c of CATALOGS) {
  describe(`${c.name}：物の通り道の置き方ごとの状態の組み合わせ`, () => {
    it('たどるブロックは、真ん中に置く置き方か、どれかの置き方で確かめる', () => {
      const covered = new Set([...FLOWS_HERE, ...LAYOUTS.flatMap((d) => [...d.ids, ...(d.fixed ?? [])])])
      expect(tracedBlocks().filter((id) => c.blocks[id] && !covered.has(id))).toEqual([])
    })

    for (const def of LAYOUTS) {
      it(`${def.name}：すべての状態で、置き方ごとまわす・反転すると、物のつながりと物の動きも同じだけ動く`, { timeout: 600_000 }, async () => {
        const problems: string[] = []
        const flowing = new Map<string, number>()
        let held = false
        for (const id of blocksOf(c, def)) {
          flowing.set(id, 0)
          const states = stateCombinations(id, c.blocks[id]!)
          for (const s of states) {
            for (const layout of def.build(s)) {
              const before = await run(layout)
              const links = itemLinks(before)
              if (links.length) flowing.set(id, flowing.get(id)! + 1)
              if ((before.itemMoves ?? []).some((m) => m.hold > 0)) held = true
              for (const { name, t } of TRANSFORMS) {
                const after = await run(transformLayout(layout, t, def.mirrorKeepsFacingSpeed !== undefined))
                const wantLinks = itemLinks(before, t)
                const gotLinks = itemLinks(after)
                if (wantLinks.join(' ') !== gotLinks.join(' ')) {
                  problems.push(`${s.key}：${name} でつながりが [${short(wantLinks)}] でなく [${short(gotLinks)}]`)
                }
                const wantMoves = itemMoves(before, t)
                const gotMoves = itemMoves(after)
                if (wantMoves.join('\n') !== gotMoves.join('\n')) {
                  const missing = wantMoves.filter((m) => !gotMoves.includes(m))
                  const extra = gotMoves.filter((m) => !wantMoves.includes(m))
                  problems.push(`${s.key}：${name} で物の動きが違う。ない [${missing.slice(0, 3).join(' / ')}]、余る [${extra.slice(0, 3).join(' / ')}]`)
                }
              }
            }
          }
        }
        expect(problems.slice(0, 20)).toEqual([])
        // 物がどこにも行かないと、この確かめ方は効かない。どのブロックも、どこかの状態で物が流れること
        expect([...flowing].filter(([, n]) => n === 0).map(([id]) => id)).toEqual([])
        if (def.holds) expect(held, '物が止まる時間がどこにも出ない').toBe(true)
      })
    }
  })
}

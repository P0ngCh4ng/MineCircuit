// ゲームで測るための試験台（docs/verification.md「ゲームで測る（D）」）。
// 設計図はここでコードから作り、利用者に渡す .nbt は tests/verification/testRigsExport.test.ts が作業用のフォルダに書き出す。
// リポジトリには .nbt を入れない。どれも Create Astral（Create 0.5.1 Fabric、1.18.2）向け。
// ブロック状態は、ゲームが保存するのと同じ項目をすべて書く（Create Astral の説明画面の設計図のパレットで確かめた）。

import type { CalcResult } from '../../src/calc/calcPlugin'
import { planBeltConnection } from '../../src/calc/create/createBeltConnector'
import { CREATE_STRESS_PLUGIN_ID, ITEM_INPUT_PORT_KIND } from '../../src/calc/create/kineticGraph'
import type { VirtualPort } from '../../src/calc/virtualPort'
import { nbt, type RawNbt } from '../../src/domain/nbt'
import type { Vec3 } from '../../src/domain/vec3'
import { blueprintFixture, type BlueprintFixture } from './blueprintFixture'

export interface RigWatch {
  readonly pos: Vec3
  /** ゲームで見るブロックの呼び方（「プレス」など） */
  readonly label: string
}

export interface TestRig {
  /** ファイル名（.nbt を除く） */
  readonly id: string
  readonly issue: number
  readonly title: string
  /** 確かめる規則 ID */
  readonly rules: readonly string[]
  readonly build: () => BlueprintFixture
  /** 計算で使う仮の入出力（.nbt には入らない）。物の入口など */
  readonly ports?: readonly VirtualPort[]
  /** ゲームですること */
  readonly steps: readonly string[]
  /** 期待値の表に、計算のプローブの値を出すブロック */
  readonly watch: readonly RigWatch[]
  /** Modpack なし（内蔵の初期値）で計算したときに成り立つこと。向きと流れの確かめ。成り立たないことの一覧を返す */
  readonly check: (r: CalcResult) => string[]
}

/** 試験台の DataVersion（1.18.2） */
export const RIG_DATA_VERSION = 2975

const W = { waterlogged: 'false' }

function motor(rpm: number): RawNbt {
  return nbt.compound({ id: nbt.string('create:motor'), ScrollValue: nbt.int(rpm) })
}

function controller(rpm: number): RawNbt {
  return nbt.compound({ id: nbt.string('create:rotation_speed_controller'), ScrollValue: nbt.int(rpm) })
}

function rig(): BlueprintFixture {
  return blueprintFixture({ dataVersion: RIG_DATA_VERSION })
}

function rpmAt(r: CalcResult, pos: Vec3): number | null {
  return r.rotations?.find((x) => x.pos.join() === pos.join())?.rpm ?? null
}

/** pos の回転数が want でなければ、そのことを返す */
function expectRpm(r: CalcResult, pos: Vec3, want: number): string[] {
  const got = rpmAt(r, pos)
  return got === want ? [] : [`${pos.join(',')} の回転数が ${want} でなく ${got}`]
}

function overloaded(r: CalcResult, pos: Vec3): boolean {
  return r.rotations?.find((x) => x.pos.join() === pos.join())?.overloaded ?? false
}

function hasIssue(r: CalcResult, text: string): boolean {
  return r.issues.some((i) => i.message.includes(text))
}

/** 例1（create-stress.md）。水車・大歯車・小歯車・プレス2台。応力計は小歯車の北 */
function example1(): BlueprintFixture {
  return rig()
    .size([4, 4, 6])
    .place([1, 1, 1], 'create:water_wheel', { facing: 'south' })
    .place([1, 1, 2], 'create:large_cogwheel', { axis: 'z', ...W })
    .place([2, 2, 2], 'create:cogwheel', { axis: 'z', ...W })
    .place([2, 2, 3], 'create:mechanical_press', { facing: 'south' })
    .place([2, 2, 4], 'create:mechanical_press', { facing: 'south' })
    .place([2, 2, 1], 'create:stressometer', { facing: 'east', axis_along_first: 'false' })
}

/** 例2（create-stress.md）。モーター・応力計・速度コントローラー・大歯車・粉砕ホイール */
function example2(withMotor = true): BlueprintFixture {
  const fx = rig()
    .size([5, 4, 5])
    .place([2, 1, 1], 'create:stressometer', { facing: 'up', axis_along_first: 'true' })
    .place([3, 1, 1], 'create:rotation_speed_controller', { axis: 'x' }, controller(64))
    .place([3, 2, 1], 'create:large_cogwheel', { axis: 'z', ...W })
    .place([3, 2, 2], 'create:crushing_wheel', { axis: 'z' })
  return withMotor ? fx.place([1, 1, 1], 'create:creative_motor', { facing: 'east' }, motor(16)) : fx
}

/** 例5（create-stress.md）。ギアボックスと3本のシャフト */
function example5(): BlueprintFixture {
  return rig()
    .size([4, 3, 5])
    .place([0, 1, 2], 'create:creative_motor', { facing: 'east' }, motor(16))
    .place([1, 1, 2], 'create:gearbox', { axis: 'y' })
    .place([2, 1, 2], 'create:shaft', { axis: 'x', ...W })
    .place([1, 1, 1], 'create:shaft', { axis: 'z', ...W })
    .place([1, 1, 3], 'create:shaft', { axis: 'z', ...W })
}

const STRESS_STEPS = [
  'エンジニアのゴーグルを付け、応力計を見て、応力と容量を読む',
  'ゴーグルで見るブロックの回転数を読む',
]

const STRESS_RIGS: readonly TestRig[] = [
  {
    id: 'stress-1-water-wheel',
    issue: 110,
    title: '例1：水車と大歯車で加速し、プレスを回す',
    rules: ['ST-SOURCE-WATER-WHEEL', 'ST-LINK-LARGE-SMALL', 'ST-STEP-STRESS', 'ST-STEP-OVERLOAD'],
    build: example1,
    steps: [
      '水車の横（東か西）の上に水源を置き、水車の羽に水が流れるようにする',
      ...STRESS_STEPS,
      '過負荷（回転が止まり、ゴーグルに過負荷と出る）かを見る',
    ],
    watch: [
      { pos: [1, 1, 1], label: '水車' },
      { pos: [2, 2, 3], label: 'プレス' },
      { pos: [2, 2, 1], label: '応力計' },
    ],
    check: (r) => [...expectRpm(r, [1, 1, 1], 8), ...expectRpm(r, [2, 2, 3], -16), ...expectRpm(r, [2, 2, 1], -16)],
  },
  {
    id: 'stress-2-speed-controller',
    issue: 110,
    title: '例2：速度コントローラー',
    rules: ['ST-STEP-CONTROLLER', 'ST-LINK-CONTROLLER'],
    build: () => example2(),
    steps: ['速度コントローラーの目標が 64 になっているかを見る（スパナで右クリック。違えば 64 にする）', ...STRESS_STEPS],
    watch: [
      { pos: [3, 2, 2], label: '粉砕ホイール' },
      { pos: [2, 1, 1], label: '応力計' },
    ],
    check: (r) => [...expectRpm(r, [2, 1, 1], 16), ...expectRpm(r, [3, 2, 2], 64)],
  },
  {
    id: 'stress-3-direction-conflict',
    issue: 110,
    title: '例3：向きの衝突',
    rules: ['ST-STEP-SPEED'],
    build: () =>
      rig()
        .size([5, 3, 3])
        .place([1, 1, 1], 'create:creative_motor', { facing: 'east' }, motor(16))
        .place([2, 1, 1], 'create:shaft', { axis: 'x', ...W })
        .place([3, 1, 1], 'create:creative_motor', { facing: 'west' }, motor(16)),
    steps: [
      '置いた直後に、シャフトが壊れる（アイテムになって落ちる）かを見る',
      '壊れたら、シャフトを置き直し、右のモーターの回転数を −16 にしてから置くと回るかを見る',
    ],
    watch: [{ pos: [2, 1, 1], label: 'シャフト' }],
    check: (r) => (hasIssue(r, '向きがぶつかって') ? [] : ['向きの衝突が出ない']),
  },
  {
    id: 'stress-4-speed-conflict',
    issue: 110,
    title: '例4：速度の衝突（大歯車と小歯車を、かみ合わせとチェーンの2つの道でつなぐ）',
    rules: ['ST-STEP-RATIOS', 'ST-LINK-CHAIN', 'ST-LINK-LARGE-SMALL'],
    // 書類の例4 の形は、大歯車の横に小歯車があり、ゲームでは小歯車が外れる（PL-COG-LARGE-NEXT-TO-SMALL）。
    // そこで、斜めにかみ合う大歯車と小歯車（小歯車は −2 倍）を、別の道でも −1 倍でつなぐ。
    // 別の道：大歯車 → チェーンドライブ（1 倍）→ 小歯車どうしのかみ合わせ（−1 倍）→ シャフト → 小歯車
    build: () =>
      rig()
        .size([4, 4, 5])
        .place([1, 1, 0], 'create:creative_motor', { facing: 'south' }, motor(16))
        .place([1, 1, 1], 'create:large_cogwheel', { axis: 'z', ...W })
        .place([2, 2, 1], 'create:cogwheel', { axis: 'z', ...W })
        .place([1, 1, 2], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'true', part: 'start' })
        .place([2, 1, 2], 'create:encased_chain_drive', { axis: 'z', axis_along_first: 'true', part: 'end' })
        .place([2, 1, 3], 'create:cogwheel', { axis: 'z', ...W })
        .place([2, 2, 3], 'create:cogwheel', { axis: 'z', ...W })
        .place([2, 2, 2], 'create:shaft', { axis: 'z', ...W }),
    steps: ['置いた直後に、どれかのブロックが壊れるかを見る'],
    watch: [{ pos: [2, 2, 1], label: '小歯車' }],
    check: (r) => {
      const problems = hasIssue(r, '回転数がぶつかって') ? [] : ['速度の衝突が出ない']
      if (hasIssue(r, '向きがぶつかって')) problems.push('向きの衝突になる')
      if (r.issues.some((i) => i.message.includes('設置の規則'))) problems.push('ゲームで外れる置き方がある')
      return problems
    },
  },
  {
    id: 'stress-5-gearbox',
    issue: 110,
    title: '例5：ギアボックスの向き',
    rules: ['ST-FACE-GEARBOX', 'ST-FACE-OWN-SPEED'],
    build: example5,
    steps: [
      '東・北・南の3本のシャフトが回る向きを見る（シャフトの端を見て、時計回りか反時計回りか）',
      'ゴーグルでギアボックス自身の回転数を読む',
    ],
    watch: [
      { pos: [1, 1, 2], label: 'ギアボックス' },
      { pos: [2, 1, 2], label: '東のシャフト' },
      { pos: [1, 1, 1], label: '北のシャフト' },
      { pos: [1, 1, 3], label: '南のシャフト' },
    ],
    check: (r) => [
      ...expectRpm(r, [1, 1, 2], 16),
      ...expectRpm(r, [2, 1, 2], -16),
      ...expectRpm(r, [1, 1, 1], -16),
      ...expectRpm(r, [1, 1, 3], 16),
    ],
  },
  {
    id: 'stress-7-controller-faster-output',
    issue: 110,
    title: '未確認事項：速度コントローラーの出力側に、より速い動力源があるとき',
    rules: ['ST-STEP-CONTROLLER'],
    // 北を向いたモーターは回転数の符号が逆になるので、−128 にすると粉砕ホイールと同じ向きに 128 で回そうとする
    build: () => example2().place([3, 2, 3], 'create:creative_motor', { facing: 'north' }, motor(-128)),
    steps: [
      '速度コントローラーの目標が 64、南のモーターが −128 になっているかを見る',
      'ブロックが壊れるか、どの回転数で回るかを見る',
      ...STRESS_STEPS,
    ],
    watch: [
      { pos: [3, 2, 2], label: '粉砕ホイール' },
      { pos: [2, 1, 1], label: '応力計' },
    ],
    check: (r) => (hasIssue(r, '向きがぶつかって') ? ['向きの衝突になる（速さだけが違う形になっていない）'] : []),
  },
  {
    id: 'stress-8-controller-reverse',
    issue: 110,
    title: '未確認事項：速度コントローラーを大歯車の側から回したとき',
    rules: ['ST-STEP-CONTROLLER-REVERSE'],
    build: () => example2(false).place([3, 2, 3], 'create:creative_motor', { facing: 'north' }, motor(32)),
    steps: ['速度コントローラーの目標が 64、南のモーターが 32 になっているかを見る', 'コントローラーと応力計が、目標の 64 で回るかを見る', ...STRESS_STEPS],
    watch: [
      { pos: [3, 1, 1], label: '速度コントローラー' },
      { pos: [2, 1, 1], label: '応力計' },
      { pos: [3, 2, 2], label: '粉砕ホイール' },
    ],
    check: (r) => [...expectRpm(r, [3, 1, 1], 64)].filter(() => !overloaded(r, [3, 1, 1])),
  },
  {
    id: 'stress-9-gearbox-ring',
    issue: 110,
    title: '未確認事項：ギアボックスの輪',
    rules: ['ST-FACE-GEARBOX'],
    build: () =>
      rig()
        .size([5, 3, 5])
        .place([0, 1, 1], 'create:creative_motor', { facing: 'east' }, motor(16))
        .place([1, 1, 1], 'create:gearbox', { axis: 'y' })
        .place([3, 1, 1], 'create:gearbox', { axis: 'y' })
        .place([1, 1, 3], 'create:gearbox', { axis: 'y' })
        .place([3, 1, 3], 'create:gearbox', { axis: 'y' })
        .place([2, 1, 1], 'create:shaft', { axis: 'x', ...W })
        .place([2, 1, 3], 'create:shaft', { axis: 'x', ...W })
        .place([1, 1, 2], 'create:shaft', { axis: 'z', ...W })
        .place([3, 1, 2], 'create:shaft', { axis: 'z', ...W }),
    steps: ['置いた直後に、どれかのブロックが壊れるかを見る', '4本のシャフトが回る向きを見る'],
    watch: [
      { pos: [2, 1, 1], label: '北のシャフト' },
      { pos: [2, 1, 3], label: '南のシャフト' },
      { pos: [1, 1, 2], label: '西のシャフト' },
      { pos: [3, 1, 2], label: '東のシャフト' },
    ],
    check: (r) => (r.issues.some((i) => i.message.includes('ぶつかって')) ? ['輪で衝突が出る'] : []),
  },
]

function itemInput(pos: Vec3, item: string, rate: number): VirtualPort {
  return { id: `input-${item}`, pos, pluginId: CREATE_STRESS_PLUGIN_ID, kind: ITEM_INPUT_PORT_KIND, params: { rate }, items: { item } }
}

/** 回転数ごとに作る試験台の回転数 */
export const RIG_SPEEDS = [16, 64, 256] as const

/** ベルト10ブロック。北を向いたモーター（ベルトの南）が西の端のシャフトを回し、物は西から東へ進む */
function beltRig(rpm: number): BlueprintFixture {
  const fx = rig()
    .size([12, 3, 5])
    .place([1, 1, 3], 'create:creative_motor', { facing: 'north' }, motor(rpm))
    .place([1, 1, 2], 'create:shaft', { axis: 'z', ...W })
    .place([10, 1, 2], 'create:shaft', { axis: 'z', ...W })
  const plan = planBeltConnection(fx.toBlueprint(), [1, 1, 2], [10, 1, 2])
  if (plan === null || typeof plan === 'string') throw new Error(`ベルトを掛けられません：${plan}`)
  for (const s of plan.segments) fx.place(s.pos, s.after.state!, s.after.blockEntity ?? undefined)
  return fx
}

/** 石臼。下から上を向いたモーターで回す */
function millstoneRig(rpm: number): BlueprintFixture {
  return rig()
    .size([3, 3, 3])
    .place([1, 0, 1], 'create:creative_motor', { facing: 'up' }, motor(rpm))
    .place([1, 1, 1], 'create:millstone', {})
}

/** プレスと、2段下のデポ。東を向いたモーターで回す */
function pressRig(rpm: number): BlueprintFixture {
  return rig()
    .size([3, 4, 3])
    .place([0, 2, 1], 'create:creative_motor', { facing: 'east' }, motor(rpm))
    .place([1, 2, 1], 'create:mechanical_press', { facing: 'east' })
    .place([1, 0, 1], 'create:depot', W)
}

const THROUGHPUT_RIGS: readonly TestRig[] = RIG_SPEEDS.flatMap((rpm): TestRig[] => [
  {
    id: `throughput-belt-${rpm}rpm`,
    issue: 125,
    title: `ベルト 10 ブロック（${rpm} RPM）`,
    rules: ['TP-BELT-RATE'],
    build: () => beltRig(rpm),
    ports: [itemInput([1, 1, 2], 'minecraft:cobblestone', 1)],
    steps: [
      'ベルトの西の端（モーターのある端）に丸石を1個落とし、東の端に着くまでの秒数を計る（3回計って平均）。期待値は 10 ÷ 表の輸送量（ブロック/秒）',
    ],
    watch: [{ pos: [5, 1, 2], label: 'ベルト' }],
    check: (r) => {
      const toEast = (r.itemMoves ?? []).some((m) => m.to[0] > m.from[0])
      return toEast ? [] : ['ベルトが西から東へ流れない']
    },
  },
  {
    id: `throughput-millstone-${rpm}rpm`,
    issue: 125,
    title: `石臼で小麦を挽く（${rpm} RPM）`,
    rules: ['TP-MILLSTONE-TIME'],
    build: () => millstoneRig(rpm),
    ports: [itemInput([1, 1, 1], 'minecraft:wheat', 1)],
    steps: ['小麦 64 個を持って石臼を右クリックして入れ、全部が挽き終わる（ゴーグルで中身が空になる）までの秒数を計る。期待値は表の1個の時間 × 64'],
    watch: [{ pos: [1, 1, 1], label: '石臼' }],
    check: (r) => expectRpm(r, [1, 1, 1], rpm),
  },
  {
    id: `throughput-press-${rpm}rpm`,
    issue: 125,
    title: `プレスで鉄板を作る（${rpm} RPM）`,
    rules: ['TP-PRESS-TIME'],
    build: () => pressRig(rpm),
    ports: [itemInput([1, 0, 1], 'minecraft:iron_ingot', 1)],
    steps: ['鉄インゴット 64 個を持ってデポを右クリックして置き、全部が鉄板になるまでの秒数を計る。期待値は表の1個の時間 × 64'],
    watch: [{ pos: [1, 2, 1], label: 'プレス' }],
    check: (r) => expectRpm(r, [1, 2, 1], rpm),
  },
])

export const TEST_RIGS: readonly TestRig[] = [...STRESS_RIGS, ...THROUGHPUT_RIGS]

// docs/create-stress.md「ブロックの回転軸と『軸の口』」の表を、行ごとに確かめる（#237）。
// 期待値は表から書き写す（コードの式をなぞらない）。表の行のブロックを合わせると、計算で回るブロックの全部になることも調べる。
import { describe, expect, it } from 'vitest'
import { BlockState } from '../../src/domain/blockState'
import type { Direction } from '../../src/domain/direction'
import { ResourceLocation } from '../../src/domain/resourceLocation'
import { clockwise, isKineticBlock, kineticShape, type Axis, type CogKind } from '../../src/calc/create/kineticBlocks'
import { ALL_BLOCK_IDS } from './createBlockCatalog'

interface Case {
  readonly props: Record<string, string>
  readonly axis: Axis
  readonly faces: readonly Direction[]
  readonly cog?: CogKind
}

interface Row {
  readonly id: string
  /** 表の「ブロック」の列。`*_x` は、どれかの版にある名前のうち `_x` で終わるもの */
  readonly blocks: readonly string[]
  readonly cases: readonly Case[]
  /** ブロックごとに期待値を変える（同じ行で歯車の大きさが違う、など） */
  readonly adjust?: (block: string, c: Case) => Case
}

const X: Direction[] = ['east', 'west']
const Y: Direction[] = ['up', 'down']
const Z: Direction[] = ['south', 'north']

const ROWS: readonly Row[] = [
  {
    id: 'ST-AXIS-SHAFT',
    blocks: ['shaft', 'powered_shaft', '*_encased_shaft', 'metal_girder_encased_shaft', 'flywheel', 'crushing_wheel', 'clutch', 'gearshift'],
    cases: [
      { props: { axis: 'x', powered: 'false' }, axis: 'x', faces: X },
      { props: { axis: 'y', powered: 'false' }, axis: 'y', faces: Y },
    ],
  },
  { id: 'ST-AXIS-COGWHEEL', blocks: ['cogwheel'], cases: [{ props: { axis: 'z' }, axis: 'z', faces: Z, cog: 'small' }] },
  { id: 'ST-AXIS-LARGE-COGWHEEL', blocks: ['large_cogwheel'], cases: [{ props: { axis: 'y' }, axis: 'y', faces: Y, cog: 'large' }] },
  {
    id: 'ST-AXIS-ENCASED-COG',
    blocks: ['*_encased_cogwheel', '*_encased_large_cogwheel'],
    cases: [
      { props: { axis: 'x', top_shaft: 'true', bottom_shaft: 'false' }, axis: 'x', faces: ['east'] },
      { props: { axis: 'y', top_shaft: 'false', bottom_shaft: 'true' }, axis: 'y', faces: ['down'] },
      { props: { axis: 'z', top_shaft: 'true', bottom_shaft: 'true' }, axis: 'z', faces: Z },
      { props: { axis: 'z', top_shaft: 'false', bottom_shaft: 'false' }, axis: 'z', faces: [] },
    ],
    adjust: (block, c) => ({ ...c, cog: block.endsWith('_large_cogwheel') ? 'large' : 'small' }),
  },
  {
    id: 'ST-AXIS-GEARBOX',
    blocks: ['gearbox'],
    cases: [
      { props: { axis: 'y' }, axis: 'y', faces: [...X, ...Z] },
      { props: { axis: 'x' }, axis: 'x', faces: [...Y, ...Z] },
    ],
  },
  {
    id: 'ST-AXIS-CHAIN-DRIVE',
    blocks: ['encased_chain_drive', 'adjustable_chain_gearshift'],
    cases: [{ props: { axis: 'x', axis_along_first: 'false', part: 'none' }, axis: 'x', faces: X }],
  },
  { id: 'ST-AXIS-SPEED-CONTROLLER', blocks: ['rotation_speed_controller'], cases: [{ props: { axis: 'z' }, axis: 'z', faces: Z }] },
  {
    id: 'ST-AXIS-SEQUENCED-GEARSHIFT',
    blocks: ['sequenced_gearshift'],
    // 軸の両側に口があるが、待機中とみなして片側を切る（ST-FACE-SEQUENCED-GEARSHIFT）。軸だけを確かめ、面は正の側
    cases: [
      { props: { axis: 'x', vertical: 'true' }, axis: 'y', faces: ['up'] },
      { props: { axis: 'z', vertical: 'false' }, axis: 'z', faces: ['south'] },
    ],
  },
  {
    id: 'ST-AXIS-CREATIVE-MOTOR',
    blocks: ['creative_motor'],
    cases: [
      { props: { facing: 'west' }, axis: 'x', faces: ['west'] },
      { props: { facing: 'up' }, axis: 'y', faces: ['up'] },
    ],
  },
  { id: 'ST-AXIS-WATER-WHEEL', blocks: ['water_wheel'], cases: [{ props: { facing: 'north' }, axis: 'z', faces: Z }] },
  { id: 'ST-AXIS-LARGE-WATER-WHEEL', blocks: ['large_water_wheel'], cases: [{ props: { axis: 'x' }, axis: 'x', faces: X }] },
  {
    id: 'ST-AXIS-CRANK',
    blocks: ['hand_crank', '*_valve_handle', 'encased_fan', 'mechanical_drill'],
    cases: [
      { props: { facing: 'up' }, axis: 'y', faces: ['down'] },
      { props: { facing: 'east' }, axis: 'x', faces: ['west'] },
    ],
  },
  {
    id: 'ST-AXIS-BEARING',
    blocks: ['windmill_bearing', 'mechanical_bearing', 'clockwork_bearing'],
    cases: [{ props: { facing: 'north' }, axis: 'z', faces: ['south'] }],
  },
  {
    id: 'ST-AXIS-SAW',
    blocks: ['mechanical_saw'],
    cases: [
      { props: { facing: 'north', axis_along_first: 'false' }, axis: 'z', faces: ['south'] },
      { props: { facing: 'up', axis_along_first: 'true' }, axis: 'x', faces: X },
      { props: { facing: 'down', axis_along_first: 'false' }, axis: 'z', faces: Z },
    ],
  },
  {
    id: 'ST-AXIS-DIRECTIONAL',
    blocks: ['deployer', 'mechanical_piston', 'sticky_mechanical_piston', 'speedometer', 'stressometer', 'fluid_valve', 'gantry_carriage'],
    // facing の軸が x なら true で y、false で z。y なら true で x、false で z。z なら true で x、false で y
    cases: [
      { props: { facing: 'east', axis_along_first: 'true' }, axis: 'y', faces: Y },
      { props: { facing: 'west', axis_along_first: 'false' }, axis: 'z', faces: Z },
      { props: { facing: 'up', axis_along_first: 'true' }, axis: 'x', faces: X },
      { props: { facing: 'down', axis_along_first: 'false' }, axis: 'z', faces: Z },
      { props: { facing: 'south', axis_along_first: 'true' }, axis: 'x', faces: X },
      { props: { facing: 'north', axis_along_first: 'false' }, axis: 'y', faces: Y },
    ],
  },
  { id: 'ST-AXIS-PRESS', blocks: ['mechanical_press'], cases: [{ props: { facing: 'east' }, axis: 'x', faces: X }] },
  {
    id: 'ST-AXIS-CUCKOO-CLOCK',
    blocks: ['cuckoo_clock', 'mysterious_cuckoo_clock'],
    cases: [{ props: { facing: 'south' }, axis: 'z', faces: ['north'] }],
  },
  {
    id: 'ST-AXIS-EJECTOR',
    blocks: ['weighted_ejector', 'elevator_pulley'],
    // cw(north) = east
    cases: [
      { props: { facing: 'north' }, axis: 'x', faces: X },
      { props: { facing: 'east' }, axis: 'z', faces: Z },
    ],
  },
  {
    id: 'ST-AXIS-HOSE-PULLEY',
    blocks: ['hose_pulley'],
    cases: [
      { props: { facing: 'north' }, axis: 'x', faces: ['east'] },
      { props: { facing: 'south' }, axis: 'x', faces: ['west'] },
    ],
  },
  { id: 'ST-AXIS-ROPE-PULLEY', blocks: ['rope_pulley'], cases: [{ props: { axis: 'z' }, axis: 'z', faces: Z }] },
  { id: 'ST-AXIS-GANTRY-SHAFT', blocks: ['gantry_shaft'], cases: [{ props: { facing: 'up', powered: 'false' }, axis: 'y', faces: Y }] },
  {
    id: 'ST-AXIS-BELT',
    blocks: ['belt'],
    cases: [
      { props: { facing: 'north', slope: 'horizontal', part: 'start' }, axis: 'x', faces: X },
      { props: { facing: 'east', slope: 'sideways', part: 'end' }, axis: 'y', faces: Y },
      { props: { facing: 'east', slope: 'upward', part: 'pulley' }, axis: 'z', faces: Z },
      { props: { facing: 'east', slope: 'horizontal', part: 'middle' }, axis: 'z', faces: [] },
    ],
  },
  { id: 'ST-AXIS-MILLSTONE', blocks: ['millstone'], cases: [{ props: {}, axis: 'y', faces: ['down'], cog: 'small' }] },
  { id: 'ST-AXIS-TURNTABLE', blocks: ['turntable'], cases: [{ props: {}, axis: 'y', faces: ['down'] }] },
  {
    id: 'ST-AXIS-MIXER',
    blocks: ['mechanical_mixer', 'mechanical_arm', 'chain_conveyor'],
    cases: [{ props: {}, axis: 'y', faces: [], cog: 'small' }],
    adjust: (block, c) => (block === 'chain_conveyor' ? { ...c, faces: Y, cog: 'none' } : c),
  },
  {
    id: 'ST-AXIS-CRAFTER',
    blocks: ['mechanical_crafter', 'display_board'],
    cases: [{ props: { facing: 'east' }, axis: 'x', faces: [], cog: 'small' }],
  },
  { id: 'ST-AXIS-PUMP', blocks: ['mechanical_pump'], cases: [{ props: { facing: 'up' }, axis: 'y', faces: [], cog: 'small' }] },
  { id: 'ST-AXIS-BACKTANK', blocks: ['copper_backtank', 'netherite_backtank'], cases: [{ props: {}, axis: 'y', faces: ['up'] }] },
]

/** どれかの版にある Create のブロックの名前（`create:` を外したもの） */
const CREATE_PATHS = [...ALL_BLOCK_IDS].filter((id) => id.startsWith('create:')).map((id) => id.slice('create:'.length))

function expand(pattern: string): string[] {
  if (!pattern.startsWith('*')) return [pattern]
  const suffix = pattern.slice(1)
  // '*_encased_cogwheel' は '*_encased_large_cogwheel' を含まない（別に書く）
  return CREATE_PATHS.filter((p) => p.endsWith(suffix) && p !== suffix.slice(1))
}

describe('回転軸と軸の口の表（docs/create-stress.md）', () => {
  for (const row of ROWS) {
    it(`[${row.id}] ${row.blocks.join('・')}`, () => {
      const blocks = row.blocks.flatMap(expand)
      expect(blocks.length).toBeGreaterThanOrEqual(row.blocks.length)
      for (const block of blocks) {
        for (const c0 of row.cases) {
          const c = row.adjust ? row.adjust(block, c0) : c0
          const shape = kineticShape(block, new BlockState(ResourceLocation.parse(`create:${block}`), c.props))
          const label = `${block} ${JSON.stringify(c.props)}`
          expect(shape, label).not.toBeNull()
          expect(shape!.axis, label).toBe(c.axis)
          expect([...shape!.shaftFaces].sort(), label).toEqual([...c.faces].sort())
          expect(shape!.cog, label).toBe(c.cog ?? 'none')
        }
      }
    })
  }

  it('[ST-STEP-NODES] 回転軸を決めるブロック状態がなければ形が決まらない。軸が y に決まっているブロックだけは決まる', () => {
    const fixedY = ['millstone', 'turntable', 'mechanical_mixer', 'mechanical_arm', 'chain_conveyor', 'copper_backtank', 'netherite_backtank']
    const decided = CREATE_PATHS.filter((p) => isKineticBlock(p)).filter(
      (p) => kineticShape(p, new BlockState(ResourceLocation.parse(`create:${p}`), {})) !== null,
    )
    expect(decided.sort()).toEqual([...fixedY].sort())
  })

  it('[ST-LINK-CHAIN] つながる向き：axis_along_first=true なら（axis が x なら y、それ以外は x）、false なら（axis が z なら y、それ以外は z）', () => {
    const connection = (axis: string, alongFirst: string) =>
      kineticShape('encased_chain_drive', new BlockState(ResourceLocation.parse('create:encased_chain_drive'), { axis, axis_along_first: alongFirst, part: 'middle' }))
        ?.chain?.connectionAxis
    expect(connection('x', 'true')).toBe('y')
    expect(connection('y', 'true')).toBe('x')
    expect(connection('z', 'true')).toBe('x')
    expect(connection('x', 'false')).toBe('z')
    expect(connection('y', 'false')).toBe('z')
    expect(connection('z', 'false')).toBe('y')
  })

  it('[ST-AXIS-EJECTOR] cw(f) は上から見て時計回りに 90°。上下はそのまま', () => {
    expect((['north', 'east', 'south', 'west', 'up', 'down'] as const).map(clockwise)).toEqual(['east', 'south', 'west', 'north', 'up', 'down'])
  })

  it('表の行のブロックを合わせると、計算で回るブロックのすべてになる（ほかのブロックは回らない）', () => {
    const inTable = new Set(ROWS.flatMap((r) => r.blocks.flatMap(expand)))
    const kinetic = CREATE_PATHS.filter((p) => isKineticBlock(p))
    expect(kinetic.filter((p) => !inTable.has(p)).sort(), '表にないのに回る').toEqual([])
    expect([...inTable].filter((p) => !isKineticBlock(p)).sort(), '表にあるのに回らない').toEqual([])
  })
})

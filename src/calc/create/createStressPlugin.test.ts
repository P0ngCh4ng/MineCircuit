import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { CalcModpack } from '../calcPlugin'
import { MemoryFileSource } from '../../io/memoryFileSource'
import { Modpack } from '../../io/modpack/modpack'
import { createBuiltinRegistry } from '../builtinPlugins'
import { loadCreateConfig, parseTomlSubset, readCreateServerConfig } from './createConfig'
import { CreateValueResolver } from './createValueResolver'
import { createStressPlugin, runCreateStress, scriptAssumptions } from './createStressPlugin'

const TOML = `
# Create のサーバー設定
[kinetics]
  maxRotationSpeed = 128
  disableStress = false
  [kinetics.stats]
    mediumSpeed = 40.0
  [kinetics.stressValues.v1.impact]
    mechanical_press = 100.0
  [kinetics.stressValues.v2.impact]
    mechanical_press = 10.0 # コメント
    "crushing_wheel" = 2
  [kinetics.stressValues.v2.capacity]
    creative_motor = 1.0
`

/** ファイルの一覧から Modpack の代わりを作る */
function fakePack(files: Record<string, string>): CalcModpack {
  return {
    hasNamespace: (ns) => ns === 'create',
    config: async (path) => files[path] ?? null,
    list: async (dir) => {
      const names = new Set<string>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(dir)) continue
        const rest = path.slice(dir.length)
        const slash = rest.indexOf('/')
        names.add(slash < 0 ? rest : rest.slice(0, slash + 1))
      }
      return [...names].sort()
    },
  }
}

const pressLine = () =>
  blueprintFixture()
    .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(16) }))
    .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
    .toBlueprint()

describe('create-server.toml', () => {
  it('表の見出し・key = value・コメントを読む', () => {
    const toml = parseTomlSubset(TOML)
    expect(toml.get('kinetics.maxRotationSpeed')).toBe(128)
    expect(toml.get('kinetics.disableStress')).toBe(false)
    expect(toml.get('kinetics.stressValues.v2.impact.mechanical_press')).toBe(10)
    expect(toml.get('kinetics.stressValues.v2.impact.crushing_wheel')).toBe(2)
  })

  it('stressValues は番号が一番大きい版を使い、表にないブロックは内蔵の初期値、初期値もなければ 0', () => {
    const config = readCreateServerConfig(TOML, 'defaultconfigs/create-server.toml')
    expect(config.stressVersion).toBe(2)
    const values = new CreateValueResolver(config)
    expect(values.impact('mechanical_press')).toEqual({
      value: 10,
      source: 'modpack',
      note: 'defaultconfigs/create-server.toml',
    })
    // 古い形の設定ファイルには項目がないことがある。ゲームは初期値で補う
    expect(values.impact('mechanical_drill')).toEqual({ value: 4, source: 'builtin' })
    expect(values.capacity('large_water_wheel')).toEqual({ value: 128, source: 'builtin' })
    expect(values.impact('not_a_kinetic_block')).toEqual({ value: 0, source: 'builtin' })
    expect(values.capacity('creative_motor').value).toBe(1)
    expect(values.mediumSpeed().value).toBe(40)
    expect(values.maxRotationSpeed()).toMatchObject({ value: 128, source: 'modpack' })
  })

  it('古い形の defaultconfigs（項目が足りない、中速が別の場所）だけでも、足りない値は内蔵の初期値になる', async () => {
    // Create Astral の defaultconfigs/create-server.toml と同じ形
    const old = `
[kinetics]
	maxRotationSpeed = 256
	[kinetics.stressValues]
		[kinetics.stressValues.v2]
			[kinetics.stressValues.v2.impact]
				crushing_wheel = 12.0
			[kinetics.stressValues.v2.capacity]
				water_wheel = 16.0
		[kinetics.stressValues.stats]
			mediumSpeed = 30.0
`
    const values = new CreateValueResolver((await loadCreateConfig(fakePack({ 'defaultconfigs/create-server.toml': old }))).config)
    expect(values.impact('crushing_wheel')).toMatchObject({ value: 12, source: 'modpack' })
    expect(values.capacity('water_wheel')).toMatchObject({ value: 16, source: 'modpack' })
    expect(values.capacity('large_water_wheel')).toEqual({ value: 128, source: 'builtin' })
    expect(values.impact('elevator_pulley')).toEqual({ value: 4, source: 'builtin' })
    expect(values.mediumSpeed()).toEqual({ value: 30, source: 'builtin' })
  })

  it('設定がなければ内蔵の初期値', () => {
    const values = new CreateValueResolver(null)
    expect(values.impact('mechanical_press')).toEqual({ value: 8, source: 'builtin' })
    expect(values.capacity('water_wheel')).toEqual({ value: 32, source: 'builtin' })
    expect(values.maxRotationSpeed()).toEqual({ value: 256, source: 'builtin' })
  })

  it('saves/*/serverconfig を先に探し、なければ defaultconfigs を使う', async () => {
    const both = fakePack({
      'defaultconfigs/create-server.toml': TOML,
      'saves/World/serverconfig/create-server.toml': TOML,
    })
    expect(await loadCreateConfig(both)).toEqual({
      config: expect.objectContaining({ path: 'saves/World/serverconfig/create-server.toml' }),
      candidates: ['saves/World/serverconfig/create-server.toml'],
    })
    expect((await loadCreateConfig(fakePack({ 'defaultconfigs/create-server.toml': TOML }))).config?.path).toBe(
      'defaultconfigs/create-server.toml',
    )

    const saves = fakePack({
      'saves/B/serverconfig/create-server.toml': TOML,
      'saves/A/serverconfig/create-server.toml': TOML,
      'saves/C/level.dat': '',
    })
    const lookup = await loadCreateConfig(saves)
    expect(lookup.config?.path).toBe('saves/A/serverconfig/create-server.toml')
    expect(lookup.candidates).toHaveLength(2)

    expect((await loadCreateConfig(fakePack({}))).config).toBeNull()
    expect((await loadCreateConfig(null)).config).toBeNull()
  })

  it('io の Modpack（FileSource つき）から saves/*/serverconfig の設定を見つける', async () => {
    const source = new MemoryFileSource([
      ['saves/World 2/serverconfig/create-server.toml', new TextEncoder().encode(TOML)],
      ['saves/World 1/level.dat', new Uint8Array()],
    ])
    const lookup = await loadCreateConfig(new Modpack([], source))
    expect(lookup.config?.path).toBe('saves/World 2/serverconfig/create-server.toml')
    expect(lookup.config?.maxRotationSpeed).toBe(128)
  })
})

describe('Create の応力プラグイン', () => {
  it('内蔵のプラグインに登録してあり、Create のブロックがある設計図だけを計算する', () => {
    const registry = createBuiltinRegistry()
    expect(registry.get('create-stress')).not.toBeNull()
    const plugin = createStressPlugin()
    expect(plugin.supports(pressLine(), null)).toBe(true)
    expect(plugin.supports(blueprintFixture().place([0, 0, 0], 'minecraft:stone').toBlueprint(), null)).toBe(false)
    expect(plugin.portKinds.map((k) => k.kind)).toEqual(['rotation-source', 'rotation-load', 'item-input'])
  })

  it('Modpack がなくても内蔵の初期値で計算し、そのことを仮定に載せる', async () => {
    const result = await runCreateStress(pressLine(), { pack: null, ports: [] })
    expect(result.summary[0]).toEqual({
      label: '合計',
      value: { value: '使用 128 SU / 供給 262,144 SU', source: 'builtin' },
    })
    expect(result.assumptions.map((a) => a.message)).toContain('Modpack がないので、Create の内蔵の初期値を使った')
    const press = result.probes?.find((p) => p.pos.join() === '1,0,0')
    expect(press?.values.map((v) => v.label)).toEqual(['回転数', '応力', '処理時間', 'ネットワーク'])
    expect(press?.values[0].value).toEqual({ value: '16 RPM', source: 'blueprint' })
    expect(press?.values[1].value).toEqual({ value: '128 SU（8 SU/RPM）', source: 'builtin' })
    // Worker から送れる素のデータ
    expect(structuredClone(result)).toEqual(result)
  })

  it('プローブに回転のネットワークの番号を付ける（つながっていないブロックは別の番号）', async () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(16) }))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .place([0, 0, 2], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    const net = (pos: string) => result.probes?.find((p) => p.pos.join() === pos)?.network
    expect(net('0,0,0')).toBeTypeOf('number')
    expect(net('1,0,0')).toBe(net('0,0,0'))
    expect(net('2,0,0')).toBe(net('0,0,0'))
    expect(net('0,0,2')).toBeTypeOf('number')
    expect(net('0,0,2')).not.toBe(net('0,0,0'))
  })

  it('回るブロックごとの回転を出す。速さの段階は中速・高速で分け、過負荷は止まる前の回転数で印を付ける', async () => {
    const motor = (speed: number) => nbt.compound({ ScrollValue: nbt.int(speed) })
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, motor(16))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([0, 0, 2], 'create:creative_motor', { facing: 'east' }, motor(64))
      .place([1, 0, 2], 'create:shaft', { axis: 'x' })
      .place([0, 0, 4], 'create:creative_motor', { facing: 'west' }, motor(128))
      .place([0, 0, 6], 'create:shaft', { axis: 'y' })
      .toBlueprint()
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    const at = (pos: string) => result.rotations?.find((r) => r.pos.join() === pos)
    expect(at('1,0,0')).toEqual({ pos: [1, 0, 0], axis: 'x', rpm: 16, level: 'slow', overloaded: false })
    expect(at('1,0,2')).toMatchObject({ rpm: 64, level: 'medium' })
    // west 向きのモーターは符号が反転する
    expect(at('0,0,4')).toMatchObject({ rpm: -128, level: 'fast' })
    expect(at('0,0,6')).toMatchObject({ axis: 'y', rpm: 0, level: 'stopped', overloaded: false })

    // 設定で容量を小さくすると過負荷：回転数は止まる前の値、overloaded を立てる
    const pack = fakePack({ 'saves/World/serverconfig/create-server.toml': TOML })
    const over = await runCreateStress(pressLine(), { pack, ports: [] })
    expect(over.rotations?.find((r) => r.pos.join() === '1,0,0')).toMatchObject({ rpm: 16, overloaded: true })
  })

  it('設置の規則に合わない歯車を、問題に出す', async () => {
    const bp = blueprintFixture()
      .place([0, 0, 0], 'create:large_cogwheel', { axis: 'y' })
      .place([1, 0, 0], 'create:cogwheel', { axis: 'y' })
      .toBlueprint()
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    const placement = result.issues.filter((i) => i.message.startsWith('この位置は設置の規則に合いません'))
    expect(placement.map((i) => i.pos)).toEqual([[0, 0, 0], [1, 0, 0]])
  })

  it('Modpack の設定ファイルの値を使う', async () => {
    const pack = fakePack({ 'saves/World/serverconfig/create-server.toml': TOML })
    const result = await runCreateStress(pressLine(), { pack, ports: [] })
    expect(result.summary[0].value).toEqual({ value: '使用 160 SU / 供給 16 SU', source: 'modpack' })
    expect(result.issues.some((i) => i.message.startsWith('応力が足りません'))).toBe(true)
  })
})

describe('KubeJS のスクリプトの仮定（#145）', () => {
  const summary = { files: 3, added: 2, removed: 1, replaced: 0, unsupported: [], errors: [], failed: null }

  it('集めた数、再現しない呼び出し、エラーを仮定にする', () => {
    expect(
      scriptAssumptions({
        ...summary,
        unsupported: [{ name: 'Java.loadClass', count: 3 }],
        errors: [{ path: 'a.js', message: 'x is not defined' }],
      }),
    ).toEqual([
      'KubeJS のスクリプトのレシピは、アプリの中で作り物の KubeJS を使って集めた。ゲームと違うことがある（足す 2・消す 1・置き換える 0）',
      'KubeJS のスクリプトの呼び出しのうち、アプリで再現しないもの：Java.loadClass（3 回）',
      'KubeJS のスクリプトでエラーが起きた所は、その残りを飛ばした：a.js（x is not defined）',
    ])
    expect(scriptAssumptions({ ...summary, added: 0, removed: 0 })).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`, count: 1 }))
    expect(scriptAssumptions({ ...summary, added: 0, removed: 0, unsupported: many })[0]).toMatch(/n7（1 回）、ほか 2 件$/)
  })

  it('打ち切ったときは、スクリプトのレシピを使っていないことだけを出す', () => {
    expect(scriptAssumptions({ ...summary, failed: '20 秒で終わらなかったので打ち切った' })).toEqual([
      'KubeJS のスクリプトを使えなかった（20 秒で終わらなかったので打ち切った）。スクリプトのレシピは入っていない',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import type { CalcModpack } from '../calcPlugin'
import { createBuiltinRegistry } from '../builtinPlugins'
import { loadCreateConfig, parseTomlSubset, readCreateServerConfig } from './createConfig'
import { CreateValueResolver } from './createValueResolver'
import { createStressPlugin, runCreateStress } from './createStressPlugin'

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

  it('stressValues は番号が一番大きい版を使い、表にないブロックは 0', () => {
    const config = readCreateServerConfig(TOML, 'defaultconfigs/create-server.toml')
    expect(config.stressVersion).toBe(2)
    const values = new CreateValueResolver(config)
    expect(values.impact('mechanical_press')).toEqual({
      value: 10,
      source: 'modpack',
      note: 'defaultconfigs/create-server.toml',
    })
    expect(values.impact('mechanical_drill').value).toBe(0)
    expect(values.capacity('creative_motor').value).toBe(1)
    expect(values.mediumSpeed().value).toBe(40)
    expect(values.maxRotationSpeed()).toMatchObject({ value: 128, source: 'modpack' })
  })

  it('設定がなければ内蔵の初期値', () => {
    const values = new CreateValueResolver(null)
    expect(values.impact('mechanical_press')).toEqual({ value: 8, source: 'builtin' })
    expect(values.capacity('water_wheel')).toEqual({ value: 32, source: 'builtin' })
    expect(values.maxRotationSpeed()).toEqual({ value: 256, source: 'builtin' })
  })

  it('defaultconfigs を先に探し、なければ saves/*/serverconfig を探す', async () => {
    const both = fakePack({
      'defaultconfigs/create-server.toml': TOML,
      'saves/World/serverconfig/create-server.toml': '',
    })
    expect((await loadCreateConfig(both)).config?.path).toBe('defaultconfigs/create-server.toml')

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
})

describe('Create の応力プラグイン', () => {
  it('内蔵のプラグインに登録してあり、Create のブロックがある設計図だけを計算する', () => {
    const registry = createBuiltinRegistry()
    expect(registry.get('create-stress')).not.toBeNull()
    const plugin = createStressPlugin()
    expect(plugin.supports(pressLine(), null)).toBe(true)
    expect(plugin.supports(blueprintFixture().place([0, 0, 0], 'minecraft:stone').toBlueprint(), null)).toBe(false)
    expect(plugin.portKinds.map((k) => k.kind)).toEqual(['rotation-source', 'rotation-load'])
  })

  it('Modpack がなくても内蔵の初期値で計算し、そのことを仮定に載せる', async () => {
    const result = await runCreateStress(pressLine(), { pack: null, ports: [] })
    expect(result.summary[0]).toEqual({
      label: '合計',
      value: { value: '使用 128 SU / 供給 262,144 SU', source: 'builtin' },
    })
    expect(result.assumptions.map((a) => a.message)).toContain('Modpack がないので、Create の内蔵の初期値を使った')
    const press = result.probes?.find((p) => p.pos.join() === '1,0,0')
    expect(press?.values.map((v) => v.label)).toEqual(['回転数', '応力', 'ネットワーク'])
    expect(press?.values[0].value).toEqual({ value: '16 RPM', source: 'blueprint' })
    expect(press?.values[1].value).toEqual({ value: '128 SU（8 SU/RPM）', source: 'builtin' })
    // Worker から送れる素のデータ
    expect(structuredClone(result)).toEqual(result)
  })

  it('Modpack の設定ファイルの値を使う', async () => {
    const pack = fakePack({ 'saves/World/serverconfig/create-server.toml': TOML })
    const result = await runCreateStress(pressLine(), { pack, ports: [] })
    expect(result.summary[0].value).toEqual({ value: '使用 160 SU / 供給 16 SU', source: 'modpack' })
    expect(result.issues.some((i) => i.message.startsWith('応力が足りません'))).toBe(true)
  })
})

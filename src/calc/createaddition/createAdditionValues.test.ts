import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { CalcModpack } from '../calcPlugin'
import { CaValues, caProfile, loadCaValues } from './createAdditionValues'

function fakePack(files: Record<string, string>): CalcModpack {
  return { hasNamespace: () => true, config: async (path) => files[path] ?? null }
}

const NEW = blueprintFixture().dataVersion(3955).place([0, 0, 0], 'createaddition:alternator', { facing: 'east' }).toBlueprint()
const OLD = blueprintFixture().dataVersion(2975).place([0, 0, 0], 'createaddition:alternator', { facing: 'east' }).toBlueprint()

describe('Crafts & Additions の定数', () => {
  it('[CA-PROFILE] 1.18.2 までの設計図は Fabric 1.18.2 版、それより新しいものは 1.7.2 の初期値', () => {
    expect(caProfile(OLD)).toBe('fabric-1.18')
    expect(caProfile(NEW)).toBe('1.7')
    const fabric = new CaValues('fabric-1.18', null, null)
    const v17 = new CaValues('1.7', null, null)
    expect([fabric.value('rollingMillStress'), fabric.value('smallConnectorMaxInput'), fabric.value('smallConnectorWireLength')]).toEqual([16, 5000, 12])
    expect([v17.value('rollingMillStress'), v17.value('smallConnectorMaxInput'), v17.value('smallConnectorWireLength')]).toEqual([8, 1000, 16])
    expect(v17.get('feAtMaxRpm')).toEqual({ value: 480, source: 'builtin' })
    // 設定ファイルのパスが分からなければ、出どころの説明は付けない
    expect(new CaValues('1.7', new Map([['general.fe_at_max_rpm', 100]]), null).get('feAtMaxRpm')).toEqual({ value: 100, source: 'modpack' })
  })

  it('[CA-CONFIG-SEARCH] config/ の設定ファイルを先に使い、なければ defaultconfigs/ を使う。Fabric 版の項目名も読む', async () => {
    const toml = ['[general]', 'fe_at_max_rpm = 960', '[wires]', 'connector_max_input = 300', 'wire_length = "x"'].join('\n')
    const both = await loadCaValues(fakePack({ 'config/createaddition-common.toml': toml, 'defaultconfigs/createaddition-common.toml': '' }), NEW)
    expect(both.values.configPath).toBe('config/createaddition-common.toml')
    expect(both.values.get('feAtMaxRpm')).toEqual({ value: 960, source: 'modpack', note: 'config/createaddition-common.toml' })
    expect(both.values.value('smallConnectorMaxInput')).toBe(300)
    // 数でない値は使わず、初期値にする
    expect(both.values.get('smallConnectorWireLength')).toEqual({ value: 16, source: 'builtin' })
    expect(both.notes).toEqual(['Crafts & Additions の版は、設計図の Minecraft の版（DataVersion 3955）から 1.21.1 の 1.7.2とみなした'])

    const defaults = await loadCaValues(fakePack({ 'defaultconfigs/createaddition-common.toml': '[general]\nmax_stress = 1024' }), OLD)
    expect(defaults.values.configPath).toBe('defaultconfigs/createaddition-common.toml')
    expect(defaults.values.value('maxStress')).toBe(1024)
  })

  it('[CA-CONFIG-SEARCH] 設定ファイルがなければ、内蔵の初期値を使ったことを仮定に載せる', async () => {
    expect((await loadCaValues(fakePack({}), OLD)).notes[1]).toBe('Modpack に createaddition-common.toml がないので、Crafts & Additions の内蔵の初期値を使った')
    const none = await loadCaValues(null, OLD)
    expect(none.notes).toEqual([
      'Crafts & Additions の版は、設計図の Minecraft の版（DataVersion 2975）から Fabric 1.18.2 版（20230704a）とみなした',
      'Modpack がないので、Crafts & Additions の内蔵の初期値を使った',
    ])
    expect(none.values.configPath).toBeNull()
  })
})

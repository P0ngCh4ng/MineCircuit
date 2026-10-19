import { describe, expect, it } from 'vitest'
import { manifestVersion, modsFromFabricJson, modsFromToml, parseModsToml } from './modMetadata'

describe('parseModsToml', () => {
  it('[[mods]] の文字列の項目だけを読み、ほかの表は無視する', () => {
    const toml = [
      'modLoader="javafml" # コメント',
      'modId="not_in_mods"',
      '[[mods]]',
      "modId='first'",
      'displayName="First \\"Mod\\""',
      'version="1.0"',
      'description=\'\'\'',
      'modId="inside_multiline"',
      "'''",
      '[[dependencies.first]]',
      'modId="minecraft"',
      '[[mods]]',
      'modId = "second"',
    ].join('\n')
    expect(parseModsToml(toml)).toEqual([
      // 複数行の文字列（description）の中は読まない
      { modId: 'first', displayName: 'First "Mod"', version: '1.0' },
      { modId: 'second' },
    ])
  })
})

describe('modsFromToml', () => {
  it('${file.jarVersion} を MANIFEST.MF のバージョンに置き換える。なければ null', () => {
    const toml = '[[mods]]\nmodId="m"\nversion="${file.jarVersion}"\n'
    expect(modsFromToml(toml, 'm.jar', 'Implementation-Version: 3.4\n')[0].version).toBe('3.4')
    expect(modsFromToml(toml, 'm.jar', null)[0].version).toBeNull()
  })

  it('modId のない [[mods]] は捨てる', () => {
    expect(modsFromToml('[[mods]]\nversion="1"\n', 'm.jar', null)).toEqual([])
  })
})

describe('manifestVersion', () => {
  it('Implementation-Version を読む', () => {
    expect(manifestVersion('Manifest-Version: 1.0\r\nImplementation-Version: 6.0.4\r\n')).toBe('6.0.4')
    expect(manifestVersion('Manifest-Version: 1.0\n')).toBeNull()
  })
})

describe('modsFromFabricJson', () => {
  it('id・name・version を読み、読めなければ空', () => {
    expect(modsFromFabricJson('{"id":"f","version":"1"}', 'f.jar')).toEqual([
      { modId: 'f', name: 'f', version: '1', jar: 'f.jar' },
    ])
    expect(modsFromFabricJson('{', 'f.jar')).toEqual([])
    expect(modsFromFabricJson('[]', 'f.jar')).toEqual([])
  })
})

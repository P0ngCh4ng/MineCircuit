import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { fakeResourcePackZip } from '../../../tests/fixtures/fakeResourcePack'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { FileSource } from '../fileSource'
import { MemoryFileSource } from '../memoryFileSource'
import { isWantedJarEntry, scanJar, scanJarContent } from './jarScanner'
import { MemoryJarCache, ModpackLoader } from './modpackLoader'
import { MERGE_GAP, readZipPartially, ZipLayoutError, type RangeReader } from './partialZip'

/** 読んだ範囲を記録する RangeReader */
function recordingReader(bytes: Uint8Array): RangeReader & { reads: [number, number][]; bytesRead: () => number } {
  const reads: [number, number][] = []
  return {
    size: bytes.length,
    reads,
    bytesRead: () => reads.reduce((sum, [s, e]) => sum + (e - s), 0),
    async read(start, end) {
      const e = Math.min(end, bytes.length)
      reads.push([start, e])
      return bytes.slice(start, e)
    },
  }
}

/** 決まった種から作る、圧縮の効かないバイト列（クラスやテクスチャの代わり） */
function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

/** 一部だけ読んだ結果と、全体を読んだ結果（scanJar）を比べる */
async function expectSameAsWhole(name: string, bytes: Uint8Array): Promise<void> {
  const zip = await readZipPartially(recordingReader(bytes), isWantedJarEntry)
  expect(scanJarContent(name, { kind: 'entries', zip })).toEqual(scanJar(name, bytes))
}

function gearsJar(): Uint8Array {
  return fakeJar({
    forgeMods: [{ modId: 'gears', displayName: 'Gears', version: '1.0' }],
    manifestVersion: '1.0.0',
    lang: {
      gears: {
        ja_jp: { 'block.gears.gear': '歯車', 'item.gears.wrench': 'レンチ', 'gui.gears.tip': '説明' },
        en_us: { 'block.gears.gear': 'Gear' },
      },
    },
    blockStates: {
      'gears:gear': { variants: { 'axis=x': { model: 'gears:block/gear' } } },
      'gears:big/gear': { multipart: [] },
    },
    files: {
      'assets/gears/textures/block/gear.png': noise(200_000, 3),
      'assets/other/models/x.json': '{}',
      'assets/gears/lang/JA_JP.json': '{"block.gears.upper":"大文字"}',
      'assets/gears/blockstates/broken.json': '{ "variants": ',
    },
  })
}

/** zip を zip64 の形に書き換える（一覧の各項目に zip64 の追加情報を付け、zip64 の末尾の目印を足す） */
function toZip64(zip: Uint8Array): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let e = zip.length - 22
  while (view.getUint32(e, true) !== 0x06054b50) e--
  const count = view.getUint16(e + 10, true)
  const cdStart = view.getUint32(e + 16, true)
  const records: Uint8Array[] = []
  let pos = cdStart
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const compressed = view.getUint32(pos + 20, true)
    const original = view.getUint32(pos + 24, true)
    const offset = view.getUint32(pos + 42, true)
    const head = zip.slice(pos, pos + 46)
    const hv = new DataView(head.buffer)
    hv.setUint32(20, 0xffffffff, true)
    hv.setUint32(24, 0xffffffff, true)
    hv.setUint32(42, 0xffffffff, true)
    hv.setUint16(30, extraLength + 28, true)
    const extra = new Uint8Array(28)
    const ev = new DataView(extra.buffer)
    ev.setUint16(0, 1, true)
    ev.setUint16(2, 24, true)
    ev.setBigUint64(4, BigInt(original), true)
    ev.setBigUint64(12, BigInt(compressed), true)
    ev.setBigUint64(20, BigInt(offset), true)
    const name = zip.slice(pos + 46, pos + 46 + nameLength)
    const rest = zip.slice(pos + 46 + nameLength, pos + 46 + nameLength + extraLength + commentLength)
    // 元の追加情報の前に zip64 の追加情報を入れる（コメントの位置は変わらない）
    records.push(head, name, extra, rest)
    pos += 46 + nameLength + extraLength + commentLength
  }
  const cdLength = records.reduce((s, r) => s + r.length, 0)
  const zip64Eocd = new Uint8Array(56)
  const zv = new DataView(zip64Eocd.buffer)
  zv.setUint32(0, 0x06064b50, true)
  zv.setBigUint64(4, 44n, true)
  zv.setBigUint64(24, BigInt(count), true)
  zv.setBigUint64(32, BigInt(count), true)
  zv.setBigUint64(40, BigInt(cdLength), true)
  zv.setBigUint64(48, BigInt(cdStart), true)
  const locator = new Uint8Array(20)
  const lv = new DataView(locator.buffer)
  lv.setUint32(0, 0x07064b50, true)
  lv.setBigUint64(8, BigInt(cdStart + cdLength), true)
  lv.setUint32(16, 1, true)
  const eocd = zip.slice(e, e + 22)
  const eov = new DataView(eocd.buffer)
  eov.setUint16(8, 0xffff, true)
  eov.setUint16(10, 0xffff, true)
  eov.setUint32(12, 0xffffffff, true)
  eov.setUint32(16, 0xffffffff, true)
  const parts = [zip.slice(0, cdStart), ...records, zip64Eocd, locator, eocd]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** zip の末尾にコメントを付ける */
function withComment(zip: Uint8Array, comment: string): Uint8Array {
  const text = strToU8(comment)
  const out = new Uint8Array(zip.length + text.length)
  out.set(zip)
  out.set(text, zip.length)
  new DataView(out.buffer).setUint16(zip.length - 2, text.length, true)
  return out
}

describe('readZipPartially', () => {
  it('一部だけ読んでも、全体を読んだときと同じ結果になる', async () => {
    await expectSameAsWhole('gears.jar', gearsJar())
    await expectSameAsWhole('neo.jar', fakeJar({ neoforgeMods: [{ modId: 'neo', version: '2' }] }))
    await expectSameAsWhole('fab.jar', fakeJar({ fabricMod: { modId: 'fab', displayName: 'Fab', version: '0.1' } }))
    await expectSameAsWhole('empty-ish.jar', fakeJar())
    await expectSameAsWhole('pack.zip', fakeResourcePackZip({ lang: { create: { ja_jp: { 'block.create.shaft': 'シャフト' } } } }))
  })

  it('jar の中の jar も同じ結果になる', async () => {
    const inner = fakeJar({
      forgeMods: [{ modId: 'inner', displayName: 'Inner' }],
      lang: { inner: { en_us: { 'block.inner.x': 'X' } } },
    })
    await expectSameAsWhole('outer.jar', fakeJar({ forgeMods: [{ modId: 'outer' }], nestedJars: { 'inner.jar': inner } }))
  })

  it('無圧縮の項目と、名前が UTF-8 の項目も同じ結果になる', async () => {
    const bytes = zipSync({
      'META-INF/mods.toml': [strToU8('[[mods]]\nmodId="stored"\n'), { level: 0 }],
      'assets/日本/lang/ja_jp.json': strToU8('{"block.日本.石":"石"}'),
    })
    await expectSameAsWhole('stored.jar', bytes)
  })

  it('末尾にコメントがある zip も読む', async () => {
    await expectSameAsWhole('comment.jar', withComment(gearsJar(), 'コメント'.repeat(100)))
  })

  it('zip64 の形の zip も読む', async () => {
    const bytes = toZip64(gearsJar())
    // 作った zip64 を fflate が読めることを先に確かめる
    expect(scanJar('z64.jar', bytes).mods.map((m) => m.modId)).toEqual(['gears'])
    await expectSameAsWhole('z64.jar', bytes)
  })

  it('末尾・一覧・欲しい項目だけを読み、大きな読まないファイルは読まない', async () => {
    const big = noise(2_000_000, 7)
    const bytes = fakeJar({
      forgeMods: [{ modId: 'big' }],
      lang: { big: { en_us: { 'block.big.a': 'A' } } },
      files: { 'assets/big/textures/huge.png': big, 'com/example/Huge.class': noise(1_000_000, 9) },
      blockStates: { 'big:a': { variants: {} } },
    })
    const reader = recordingReader(bytes)
    const zip = await readZipPartially(reader, isWantedJarEntry)
    expect(zip.entries.map((e) => e.name).sort()).toEqual([
      'META-INF/mods.toml',
      'assets/big/blockstates/a.json',
      'assets/big/lang/en_us.json',
    ])
    expect(zip.names).toContain('assets/big/textures/huge.png')
    expect(reader.bytesRead()).toBeLessThan(bytes.length / 10)
    // 読む回数も少ない（末尾、欲しい項目のまとまり）
    expect(reader.reads.length).toBeLessThanOrEqual(4)
  })

  it('間の狭い項目はまとめて読み、広く離れた項目は分けて読む', async () => {
    const bytes = zipSync({
      'assets/a/lang/en_us.json': strToU8('{"block.a.x":"X"}'),
      'assets/a/lang/ja_jp.json': strToU8('{"block.a.x":"エックス"}'),
      'gap.bin': [noise(MERGE_GAP * 3, 2), { level: 0 }],
      'assets/a/blockstates/x.json': strToU8('{}'),
    })
    const reader = recordingReader(bytes)
    await readZipPartially(reader, isWantedJarEntry)
    // 末尾（一覧を含む）1回 + 前の2つをまとめて1回 + 後ろの1つで1回
    expect(reader.reads).toHaveLength(3)
    expect(reader.bytesRead()).toBeLessThan(bytes.length / 2)
  })

  it('zip でなければ ZipLayoutError を投げる（呼ぶ側は全体を読む方法に戻す）', async () => {
    await expect(readZipPartially(recordingReader(strToU8('jar ではない'.repeat(10))), isWantedJarEntry)).rejects.toThrow(
      ZipLayoutError,
    )
    await expect(readZipPartially(recordingReader(new Uint8Array(5)), isWantedJarEntry)).rejects.toThrow(ZipLayoutError)
  })

  it('読めたバイト数が足りなければ ZipLayoutError（読んでいる間にファイルが縮んだ）', async () => {
    const bytes = gearsJar()
    const reader: RangeReader = { size: bytes.length + 100, read: async (s, e) => bytes.slice(s, e) }
    await expect(readZipPartially(reader, isWantedJarEntry)).rejects.toThrow(ZipLayoutError)
  })
})

/** readRange を持たない FileSource（全体を読む方法） */
function withoutRange(source: MemoryFileSource): FileSource {
  return { list: (d) => source.list(d), read: (p) => source.read(p), stat: (p) => source.stat(p) }
}

describe('ModpackLoader（jar の一部だけを読む）', () => {
  const jars: [string, Uint8Array][] = [
    ['mods/a-gears.jar', gearsJar()],
    ['mods/b-z64.jar', toZip64(fakeJar({ fabricMod: { modId: 'z64' }, lang: { z64: { en_us: { 'block.z64.a': 'A' } } } }))],
    ['mods/c-broken.jar', strToU8('jar ではない'.repeat(20))],
    ['mods/d-prefixed.jar', new Uint8Array([...noise(100, 4), ...fakeJar({ forgeMods: [{ modId: 'prefixed' }] })])],
  ]

  function memory(): MemoryFileSource {
    const source = new MemoryFileSource()
    jars.forEach(([path, bytes], i) => source.add(path, bytes, { size: bytes.length, lastModified: i + 1 }))
    const pack = fakeResourcePackZip({ lang: { gears: { ja_jp: { 'block.gears.gear': 'パックの歯車' } } } })
    source.add('resourcepacks/ja.zip', pack, { size: pack.length, lastModified: 1 })
    return source
  }

  /** 読んだファイルを記録する FileSource */
  function recording(source: MemoryFileSource): FileSource & { whole: string[]; ranged: Set<string> } {
    const whole: string[] = []
    const ranged = new Set<string>()
    return {
      whole,
      ranged,
      list: (d) => source.list(d),
      stat: (p) => source.stat(p),
      read: (p) => {
        whole.push(p)
        return source.read(p)
      },
      readRange: (p, s, e) => {
        ranged.add(p)
        return source.readRange(p, s, e)
      },
    }
  }

  it('readRange があってもなくても、同じ Modpack になる（読めない jar のお知らせも同じ）', async () => {
    const partial = await new ModpackLoader(memory()).load()
    const whole = await new ModpackLoader(withoutRange(memory())).load()
    expect(partial.mods).toEqual(whole.mods)
    expect(partial.namespaces).toEqual(whole.namespaces)
    expect(partial.problems).toEqual(whole.problems)
    expect(partial.langPacks).toEqual(whole.langPacks)
    expect(partial.displayName(ResourceLocation.parse('gears:gear'), 'ja_jp')).toBe('パックの歯車')
    // zip でないものはどちらも読めない。zip の前に余計なデータがあるものは、どちらも中身を見つけられない
    expect(partial.problems.map((p) => p.jar)).toContain('c-broken.jar')
    expect(partial.mods.map((m) => m.modId)).toEqual(['gears', 'z64'])
  })

  it('readRange と stat があれば、一部だけ読む。読めなかったものだけ全体を読み直す', async () => {
    const source = recording(memory())
    await new ModpackLoader(source).load()
    expect([...source.ranged].sort()).toEqual([...jars.map(([p]) => p), 'resourcepacks/ja.zip'].sort())
    // zip でないものと、zip の前に余計なデータがあるもの（一覧の位置が合わない）
    expect(source.whole.sort()).toEqual(['mods/c-broken.jar', 'mods/d-prefixed.jar'])
  })

  it('stat がなければ、今までどおり全体を読む', async () => {
    const source = new MemoryFileSource(jars)
    const pack = await new ModpackLoader(source).load()
    expect(pack.mods.map((m) => m.modId)).toEqual(['gears', 'z64'])
  })

  it('保存した結果は今までと同じ鍵（大きさと更新時刻）で使い、2回目は保存したものを読まない', async () => {
    const cache = new MemoryJarCache()
    await new ModpackLoader(memory(), { cache }).load()
    expect([...cache.entries.keys()].every((k) => /\|\d+\|\d+$/.test(k))).toBe(true)
    const source = recording(memory())
    const pack = await new ModpackLoader(source, { cache }).load()
    expect(pack.mods.map((m) => m.modId)).toEqual(['gears', 'z64'])
    // 読めなかった jar は保存されないので、それだけ読み直す
    expect([...source.ranged]).toEqual(['mods/c-broken.jar'])
    expect(source.whole).toEqual(['mods/c-broken.jar'])
  })
})

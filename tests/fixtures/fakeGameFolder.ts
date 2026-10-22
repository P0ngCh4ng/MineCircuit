// テスト用の Minecraft 本体の jar と、ランチャーのゲームのフォルダ（versions/・libraries/・assets/）をコードで作る。
// 本物の本体の jar・モデル・テクスチャ・翻訳ファイルはリポジトリに入れない。中身は形だけ同じ偽物にする。

import { strToU8 } from 'fflate'
import type { FileContent } from '../../src/io/memoryFileSource'
import { fakeJar } from './fakeJar'

/** 偽の PNG（中身は読まない。資産として読めるかだけを見る） */
export const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** 偽の本体の jar。石のブロック状態・モデル・テクスチャと、英語の名前だけを持つ（本物と同じく ja_jp はない） */
export function fakeClientJar(stoneName = 'Stone'): Uint8Array {
  return fakeJar({
    lang: { minecraft: { en_us: { 'block.minecraft.stone': stoneName, 'block.minecraft.oak_log': 'Oak Log' } } },
    blockStates: {
      'minecraft:stone': { variants: { '': { model: 'minecraft:block/stone' } } },
      'minecraft:oak_log': { variants: { 'axis=y': { model: 'minecraft:block/oak_log' } } },
    },
    files: {
      'assets/minecraft/models/block/stone.json': JSON.stringify({
        parent: 'minecraft:block/cube_all',
        textures: { all: 'minecraft:block/stone' },
      }),
      'assets/minecraft/textures/block/stone.png': FAKE_PNG,
      'data/minecraft/recipes/stone.json': '{}',
      'net/minecraft/client/Main.class': new Uint8Array([0xca, 0xfe]),
    },
  })
}

/** 資産の索引で使う、偽の ja_jp.json のハッシュ（40 文字の 16 進数。本物の SHA-1 でなくてよい） */
export const FAKE_JA_JP_HASH = 'ab' + '0123456789abcdef0123456789abcdef012345'

/** 資産の索引（assets/indexes/<id>.json）と、ja_jp.json の中身（assets/objects/）のファイル */
export function fakeAssetIndexFiles(indexId: string, jaJp: Record<string, string>): [string, FileContent][] {
  const json = strToU8(JSON.stringify(jaJp))
  return [
    [
      `assets/indexes/${indexId}.json`,
      strToU8(
        JSON.stringify({
          objects: {
            'minecraft/lang/ja_jp.json': { hash: FAKE_JA_JP_HASH, size: json.length },
            'minecraft/sounds/ambient/cave/cave1.ogg': { hash: 'cd' + '0'.repeat(38), size: 1 },
          },
        }),
      ),
    ],
    [`assets/objects/${FAKE_JA_JP_HASH.slice(0, 2)}/${FAKE_JA_JP_HASH}`, json],
  ]
}

/** 版の情報（versions/<id>/<id>.json） */
export function fakeVersionJson(id: string, assetIndex: string): Uint8Array {
  return strToU8(JSON.stringify({ id, assetIndex: { id: assetIndex, url: 'https://example.invalid/' }, type: 'release' }))
}

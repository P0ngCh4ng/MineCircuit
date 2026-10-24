// KubeJS が足すブロック（docs/design.md「Modpack / ModpackLoader」の「KubeJS」）。
// Modpack によっては、jar ではなく KubeJS のスクリプトでブロックを登録し、資産を kubejs/assets/ に置いている
// （Create Astral の `createastral:` など）。スクリプトは実行せず、登録の呼び出し（`.create("<ns>:<path>")`）から
// namespace だけを読む。翻訳と見た目の資産は、kubejs/ をフォルダのリソースパックとして読む（langPacks.ts）。

import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'

/** KubeJS のフォルダ。中の `assets/<namespace>/` はリソースパックと同じ形 */
export const KUBEJS_DIR = 'kubejs'
/** ゲームの起動時に動き、ブロックやアイテムを登録するスクリプトのフォルダ */
export const KUBEJS_STARTUP_DIR = `${KUBEJS_DIR}/startup_scripts`

/** 深すぎるフォルダはたどらない */
const MAX_DEPTH = 8

/** `event.create("createastral:foo")`、`e.create('ns:path', 'basic')` など。ID は小文字の ResourceLocation */
const CREATE_CALL = /\.create\(\s*(["'`])([a-z0-9_.-]+):[a-z0-9_./-]+\1/g

/** スクリプトの文字列から、登録している ID の namespace を取り出す（名前順） */
export function registeredNamespaces(script: string): string[] {
  const out = new Set<string>()
  for (const m of script.matchAll(CREATE_CALL)) out.add(m[2])
  return [...out].sort()
}

/** KubeJS のスクリプトを読んだ結果 */
export interface KubeJsNamespaces {
  /** スクリプトで登録している namespace（名前順） */
  readonly namespaces: string[]
  /** 読めなかったスクリプト（`kubejs/startup_scripts/foo.js: 内容`）。読み込みは続ける */
  readonly problems: string[]
}

/**
 * kubejs/startup_scripts/ の .js（下のフォルダも含む）から、登録している namespace を集める。
 * フォルダがなければ空の結果を返す。
 */
export async function findKubeJsNamespaces(source: FileSource): Promise<KubeJsNamespaces> {
  const namespaces = new Set<string>()
  const problems: string[] = []
  const decoder = new TextDecoder('utf-8')

  const visit = async (dir: string, depth: number): Promise<void> => {
    let names: string[]
    try {
      names = await source.list(dir)
    } catch (e) {
      if (e instanceof FileNotFoundError) return
      throw e
    }
    for (const name of [...names].sort()) {
      if (isDirectoryEntry(name)) {
        if (depth < MAX_DEPTH) await visit(`${dir}/${name.slice(0, -1)}`, depth + 1)
        continue
      }
      if (!name.toLowerCase().endsWith('.js')) continue
      const path = `${dir}/${name}`
      try {
        for (const ns of registeredNamespaces(decoder.decode(await source.read(path)))) namespaces.add(ns)
      } catch (e) {
        problems.push(`${path}: 読めません（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }

  await visit(KUBEJS_STARTUP_DIR, 0)
  return { namespaces: [...namespaces].sort(), problems }
}

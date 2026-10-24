// Custom Machinery の機械の定義（docs/design.md「生データで見た目が変わるブロック」）。
// 機械は、データパックの `data/<ns>/machines/<パス>.json` に書く。Modpack では kubejs/data/ に置くことが多い。
// ここでは、機械の見た目（`appearance.block`）だけを読む。

import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'
import { parseLenientJson } from './jarScanner'
import { stripBom } from './modMetadata'

/** 深すぎるフォルダはたどらない */
const MAX_DEPTH = 8

/** データパックのフォルダ（`data/` を持つ）の場所。kubejs/ は data/ を直接持つ */
const KUBEJS_DATA_ROOT = 'kubejs'
const DATAPACKS_DIR = 'datapacks'

/** 機械の定義を読んだ結果 */
export interface MachineAppearances {
  /** 機械の ID（`createastral:distillery`）→ 見た目のブロック（`createastral:distillery_dummy`、`<id>[a=b]`） */
  readonly machines: Record<string, string>
  /** 読めなかった定義（`<パス>: 内容`）。読み込みは続ける */
  readonly problems: string[]
}

async function listOrNull(source: FileSource, dir: string): Promise<string[] | null> {
  try {
    return await source.list(dir)
  } catch (e) {
    if (e instanceof FileNotFoundError) return null
    throw e
  }
}

/** 機械の定義の JSON から、見た目のブロックを取り出す。書いていなければ null */
export function machineAppearanceBlock(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const appearance = (json as Record<string, unknown>).appearance
  if (typeof appearance !== 'object' || appearance === null) return null
  const block = (appearance as Record<string, unknown>).block
  return typeof block === 'string' && block !== '' ? block : null
}

/**
 * kubejs/data/ と datapacks/<パック>/data/ の `<ns>/machines/` から、機械の見た目を集める。
 * 同じ ID があれば、後に読んだもの（datapacks/ のもの）を使う。なければ空の結果を返す
 */
export async function readMachineAppearances(source: FileSource): Promise<MachineAppearances> {
  const machines: Record<string, string> = {}
  const problems: string[] = []
  const decoder = new TextDecoder('utf-8')

  const roots = [`${KUBEJS_DATA_ROOT}/data`]
  for (const pack of ((await listOrNull(source, DATAPACKS_DIR)) ?? []).filter(isDirectoryEntry).sort()) {
    roots.push(`${DATAPACKS_DIR}/${pack.slice(0, -1)}/data`)
  }

  const visit = async (dir: string, ns: string, prefix: string, depth: number): Promise<void> => {
    for (const name of ((await listOrNull(source, dir)) ?? []).sort()) {
      if (isDirectoryEntry(name)) {
        if (depth < MAX_DEPTH) await visit(`${dir}/${name.slice(0, -1)}`, ns, `${prefix}${name}`, depth + 1)
        continue
      }
      if (!name.toLowerCase().endsWith('.json')) continue
      const path = `${dir}/${name}`
      try {
        const block = machineAppearanceBlock(parseLenientJson(stripBom(decoder.decode(await source.read(path)))))
        if (block) machines[`${ns}:${prefix}${name.slice(0, -'.json'.length)}`] = block
      } catch {
        problems.push(`${path}: 機械の定義を JSON として読めません`)
      }
    }
  }

  for (const root of roots) {
    for (const nsDir of ((await listOrNull(source, root)) ?? []).filter(isDirectoryEntry).sort()) {
      const ns = nsDir.slice(0, -1)
      await visit(`${root}/${ns}/machines`, ns, '', 0)
    }
  }
  return { machines, problems }
}

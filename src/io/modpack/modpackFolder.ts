import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'

/**
 * 選んだフォルダが Modpack のフォルダか確かめた結果。
 *
 * - `ok`: `mods/` がある（CurseForge のプロファイルのフォルダ、`.minecraft` など）
 * - `mods-folder`: `mods/` の中身そのものを選んだらしい（一番上に .jar があり、`mods/` がない）
 * - `no-mods`: `mods/` がない
 */
export type ModpackFolderCheck =
  | { kind: 'ok'; jarCount: number }
  | { kind: 'mods-folder' }
  | { kind: 'no-mods' }

/** Mod の jar を置くフォルダの名前 */
export const MODS_DIR = 'mods'

function isJar(name: string): boolean {
  return !isDirectoryEntry(name) && name.toLowerCase().endsWith('.jar')
}

/** フォルダに `mods/` があるか確かめ、jar の数を数える */
export async function checkModpackFolder(source: FileSource): Promise<ModpackFolderCheck> {
  const top = await source.list('')
  if (!top.includes(`${MODS_DIR}/`)) {
    return top.some(isJar) ? { kind: 'mods-folder' } : { kind: 'no-mods' }
  }
  try {
    const mods = await source.list(MODS_DIR)
    return { kind: 'ok', jarCount: mods.filter(isJar).length }
  } catch (e) {
    if (e instanceof FileNotFoundError) return { kind: 'no-mods' }
    throw e
  }
}

/** 確かめた結果のうち、登録できないものを画面に出す文にする */
export function describeFolderProblem(check: Exclude<ModpackFolderCheck, { kind: 'ok' }>): string {
  switch (check.kind) {
    case 'mods-folder':
      return 'mods フォルダの中が選ばれました。mods フォルダが入っている1つ上のフォルダ（プロファイルのフォルダ）を選んでください。'
    case 'no-mods':
      return '選んだフォルダに mods フォルダがありません。CurseForge なら、プロファイルのフォルダ（Instances の中の Modpack 名のフォルダ）を選んでください。'
  }
}

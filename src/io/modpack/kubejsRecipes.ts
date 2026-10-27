// KubeJS のレシピ（docs/create-throughput.md「レシピ」）。
// kubejs/data/ のレシピ JSON を読み、kubejs/server_scripts/ のスクリプトがレシピを変えているかを調べる。

import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'
import { parseLenientJson } from './jarScanner'
import { KUBEJS_DIR } from './kubejs'
import { RECIPE_PATH, readProcessingRecipe, type ProcessingRecipe } from './recipes'

export const KUBEJS_DATA_DIR = `${KUBEJS_DIR}/data`
export const KUBEJS_SERVER_DIR = `${KUBEJS_DIR}/server_scripts`

/** スクリプトがレシピを変えているか（KubeJS 6 の `ServerEvents.recipes`、KubeJS 5 以前の `onEvent('recipes'`） */
const RECIPE_EVENT = /ServerEvents\s*\.\s*recipes|onEvent\s*\(\s*['"]recipes['"]/

/** フォルダをたどる深さ */
const MAX_DEPTH = 8

/** kubejs/ のレシピを読んだ結果 */
export interface KubeJsRecipes {
  readonly recipes: ProcessingRecipe[]
  readonly scriptsChangeRecipes: boolean
  readonly problems: string[]
}

/** kubejs/data/<namespace>/recipes/ のレシピと、kubejs/server_scripts/ のスクリプトがレシピを変えているかを読む */
export async function readKubeJsRecipes(source: FileSource): Promise<KubeJsRecipes> {
  const recipes: ProcessingRecipe[] = []
  const problems: string[] = []
  const decoder = new TextDecoder('utf-8')
  let scriptsChangeRecipes = false

  const visit = async (dir: string, depth: number, file: (path: string) => Promise<void>): Promise<void> => {
    let names: string[]
    try {
      names = await source.list(dir)
    } catch (e) {
      if (e instanceof FileNotFoundError) return
      throw e
    }
    for (const name of [...names].sort()) {
      const path = `${dir}/${isDirectoryEntry(name) ? name.slice(0, -1) : name}`
      if (isDirectoryEntry(name)) {
        if (depth < MAX_DEPTH) await visit(path, depth + 1, file)
        continue
      }
      try {
        await file(path)
      } catch (e) {
        problems.push(`${path}: 読めません（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
  }

  await visit(KUBEJS_DATA_DIR, 0, async (path) => {
    const m = RECIPE_PATH.exec(path.slice(KUBEJS_DIR.length + 1))
    if (!m) return
    const recipe = readProcessingRecipe(`${m[1]}:${m[2]}`, parseLenientJson(decoder.decode(await source.read(path))))
    if (recipe) recipes.push(recipe)
  })
  await visit(KUBEJS_SERVER_DIR, 0, async (path) => {
    if (scriptsChangeRecipes || !path.toLowerCase().endsWith('.js')) return
    if (RECIPE_EVENT.test(decoder.decode(await source.read(path)))) scriptsChangeRecipes = true
  })
  return { recipes, scriptsChangeRecipes, problems }
}

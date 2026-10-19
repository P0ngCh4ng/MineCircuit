import type { Blueprint } from '../../domain/blueprint'
import { BlueprintReadError, type BlueprintReader } from './blueprintReader'
import { NbtBlueprintReader } from './nbtBlueprintReader'

/** 使える読み込みの一覧。.schem や .litematic に対応したら、ここに足す */
export const blueprintReaders: readonly BlueprintReader[] = [new NbtBlueprintReader()]

/** 開けるファイルの拡張子。ファイルを選ぶ画面の accept に使う */
export const blueprintFileExtensions: readonly string[] = ['.nbt']

/** ファイル名に合う読み込みを返す。ないときは null */
export function findBlueprintReader(fileName: string, readers: readonly BlueprintReader[] = blueprintReaders): BlueprintReader | null {
  return readers.find((r) => r.canRead(fileName)) ?? null
}

/**
 * ファイル名から形式を選んで設計図を読む。
 * 対応していない形式と、形式が違う中身は BlueprintReadError（message は画面に出せる）。
 */
export async function readBlueprint(
  fileName: string,
  data: ArrayBuffer | Uint8Array,
  readers: readonly BlueprintReader[] = blueprintReaders,
): Promise<Blueprint> {
  const reader = findBlueprintReader(fileName, readers)
  if (!reader) {
    throw new BlueprintReadError(
      `"${fileName}" は開けない形式です。構造物 NBT（${blueprintFileExtensions.join('、')}）のファイルを選んでください。`,
    )
  }
  return reader.read(fileName, data)
}

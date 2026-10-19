// Minecraft のバージョンと DataVersion の対応。
// 上のバーのバージョンの表示と、新規の設計図の DataVersion（docs/design.md「BlueprintWriter」）で使う。

/** Minecraft のバージョン1つ分 */
export interface MinecraftVersion {
  /** "1.18.2" */
  readonly name: string
  /** そのバージョンの正式版の DataVersion */
  readonly dataVersion: number
}

/**
 * 工業 Mod の Modpack でよく使うバージョン（古い順）。
 * 値は各バージョンの正式版の DataVersion。Minecraft Wiki の「Data version」による。
 */
export const MINECRAFT_VERSIONS: readonly MinecraftVersion[] = [
  { name: '1.16.5', dataVersion: 2586 },
  { name: '1.17.1', dataVersion: 2730 },
  { name: '1.18.2', dataVersion: 2975 },
  { name: '1.19.2', dataVersion: 3120 },
  { name: '1.19.3', dataVersion: 3218 },
  { name: '1.19.4', dataVersion: 3337 },
  { name: '1.20.1', dataVersion: 3465 },
  { name: '1.20.2', dataVersion: 3578 },
  { name: '1.20.4', dataVersion: 3700 },
  { name: '1.20.6', dataVersion: 3839 },
  { name: '1.21.1', dataVersion: 3955 },
  { name: '1.21.4', dataVersion: 4189 },
]

/** 名前（"1.20.1"）からバージョンを探す。一覧になければ null */
export function findMinecraftVersion(name: string): MinecraftVersion | null {
  return MINECRAFT_VERSIONS.find((v) => v.name === name) ?? null
}

/** DataVersion がどのバージョン以降のものか。一覧の一番古いものより前なら null */
export function minecraftVersionOf(dataVersion: number): MinecraftVersion | null {
  let found: MinecraftVersion | null = null
  for (const v of MINECRAFT_VERSIONS) if (dataVersion >= v.dataVersion) found = v
  return found
}

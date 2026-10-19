import type { NbtDocument } from '../../domain/nbt'
import { gunzip, gzip, isGzip } from './gzip'
import { NbtParseError, readNbt } from './NbtReader'
import { writeNbt } from './NbtWriter'

export { NbtParseError, readNbt } from './NbtReader'
export { NbtWriteError, writeNbt } from './NbtWriter'
export { gunzip, gzip, isGzip } from './gzip'

/** NBT ファイルを読んだ結果。compressed は元のファイルが gzip だったか */
export interface NbtFile extends NbtDocument {
  compressed: boolean
}

/** NBT ファイルのバイト列を読む。gzip なら展開してから読む */
export async function parseNbtFile(bytes: Uint8Array): Promise<NbtFile> {
  const compressed = isGzip(bytes)
  let raw = bytes
  if (compressed) {
    try {
      raw = await gunzip(bytes)
    } catch {
      throw new NbtParseError('gzip の展開に失敗しました。ファイルが壊れていないか確かめてください。')
    }
  }
  return { ...readNbt(raw), compressed }
}

/** NBT ファイルのバイト列を作る。設計図（.nbt）は gzip で圧縮するので、既定は圧縮する */
export async function serializeNbtFile(doc: NbtDocument, options: { compress?: boolean } = {}): Promise<Uint8Array> {
  const raw = writeNbt({ name: doc.name, root: doc.root })
  return options.compress === false ? raw : gzip(raw)
}

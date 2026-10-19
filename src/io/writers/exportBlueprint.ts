// 設計図の書き出しの手順。ファイルの中身を作り、読み直して元と一致するか確かめ、一致したときだけ保存する
// （docs/design.md「BlueprintWriter」）。画面の「書き出し（.nbt）」はこれを呼ぶ。

import type { Blueprint } from '../../domain/blueprint'
import type { FileSink, SaveResult } from '../fileSink'
import { readBlueprint } from '../readers/readBlueprint'
import { BlueprintReadError } from '../readers/blueprintReader'
import { BlueprintWriteError, type BlueprintWriter } from './blueprintWriter'
import { compareBlueprints } from './compareBlueprints'
import { NbtBlueprintWriter } from './nbtBlueprintWriter'

export interface ExportOptions {
  /** 既定は NbtBlueprintWriter */
  writer?: BlueprintWriter
  /** 保存先を選ぶ画面に最初に出す名前。省略すると exportFileName() */
  fileName?: string
}

export interface ExportResult {
  status: SaveResult
  fileName: string
  /** 書き出したファイルの大きさ（バイト、gzip 済み） */
  byteLength: number
}

/**
 * 設計図を書き出して sink に保存する。
 * 書き出した直後に読み直し、配置・状態・生データ・エンティティ・知らない項目が元と一致しなければ、
 * 保存せずに BlueprintWriteError を投げる（message は画面に出せる日本語）。
 */
export async function exportBlueprint(bp: Blueprint, sink: FileSink, options: ExportOptions = {}): Promise<ExportResult> {
  const writer = options.writer ?? new NbtBlueprintWriter()
  const fileName = options.fileName ?? exportFileName(bp.name, writer.extension)
  const bytes = await writer.write(bp)
  await verifyWritten(bp, bytes, writer)
  const status = await sink.save(fileName, bytes)
  return { status, fileName, byteLength: bytes.length }
}

/**
 * 書き出したファイル bytes を読み直し、bp と一致するか確かめる。
 * 読めないときや一致しないときは BlueprintWriteError を投げる。
 */
export async function verifyWritten(bp: Blueprint, bytes: Uint8Array, writer: BlueprintWriter): Promise<void> {
  let reread: Blueprint
  try {
    reread = await readBlueprint(`check${writer.extension}`, bytes)
  } catch (e) {
    if (e instanceof BlueprintReadError) {
      throw new BlueprintWriteError(`書き出したファイルを読み直せませんでした。ファイルは保存していません。${e.message}`)
    }
    throw e
  }
  const diffs = compareBlueprints(bp, reread)
  if (diffs.length > 0) {
    throw new BlueprintWriteError(
      `書き出したファイルを読み直すと、元の設計図と一致しませんでした。ファイルは保存していません。${diffs.join(' ')}`,
    )
  }
}

/** 書き出すファイルの名前。元の拡張子を extension に置き換える（"mill.nbt" → "mill.nbt"、"mill" → "mill.nbt"） */
export function exportFileName(name: string, extension: string): string {
  const base = name.replace(/\.(nbt|schem|schematic|litematic)$/i, '')
  return `${base === '' ? 'blueprint' : base}${extension}`
}

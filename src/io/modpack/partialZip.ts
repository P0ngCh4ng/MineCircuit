// zip（jar）の必要な部分だけを読む（docs/design.md「Modpack / ModpackLoader」の jar の読み方）。
// zip は末尾にファイルの一覧（central directory）を持つので、末尾 → 一覧 → 欲しい項目の順に、その範囲だけを読む。
// 展開（inflate）はここでは行わない。圧縮されたままのバイト列を集め、Worker に渡して展開する（jarScanner.ts）。
//
// 結果は fflate の unzipSync（ファイル全体を読んで filter で選ぶ）と同じになるよう、fflate と同じ読み方をする。
// 想定と違う形の zip（壊れている、末尾が見つからない、など）は ZipLayoutError を投げる。
// 呼ぶ側はそのとき、ファイル全体を読む方法に戻す（fflate が同じ zip で出すエラーをそのまま使えるように）。

/** ファイルの一部を読む方法 */
export interface RangeReader {
  /** ファイルの大きさ（バイト） */
  readonly size: number
  /** start 以上 end 未満のバイトを返す。end が大きさを超えたら末尾まで */
  read(start: number, end: number): Promise<Uint8Array>
}

/** zip の項目1つ分。中身は圧縮されたまま */
export interface CompressedZipEntry {
  readonly name: string
  /** 圧縮の方式。0 は無圧縮、8 は deflate */
  readonly compression: number
  /** 展開したあとの大きさ */
  readonly originalSize: number
  /** 圧縮されたままの中身 */
  readonly data: Uint8Array
}

/**
 * zip から取り出したもの。structured clone で Worker に送れる素のデータ。
 * names は zip にあるすべての項目の名前（namespace を数えるため）。entries は欲しい項目だけ。どちらも zip の一覧の順
 */
export interface ExtractedZip {
  readonly names: string[]
  readonly entries: CompressedZipEntry[]
}

/** 想定と違う形の zip。呼ぶ側はファイル全体を読む方法に戻す */
export class ZipLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLayoutError'
  }
}

/** 末尾の目印（end of central directory）の大きさ */
const EOCD_SIZE = 22
/** 末尾の目印を探す範囲。目印とコメント（最大 65535 バイト）の分（fflate と同じ） */
const EOCD_SEARCH = 65558
/** zip64 の目印の位置を書いた部分（locator）の大きさ */
const ZIP64_LOCATOR_SIZE = 20
/** zip64 の末尾の目印のうち、使う部分の大きさ */
const ZIP64_EOCD_SIZE = 56
/** 項目の前に付く見出し（local file header）の固定部分の大きさ */
const LOCAL_HEADER_SIZE = 30
/** 間がこれより狭い項目は、まとめて1回で読む。読む回数を減らすため */
export const MERGE_GAP = 64 * 1024

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50

/** 読んだバイト列と、それがファイルのどこからか */
class Chunk {
  constructor(
    readonly start: number,
    readonly bytes: Uint8Array,
  ) {}

  get end(): number {
    return this.start + this.bytes.length
  }

  contains(pos: number, length: number): boolean {
    return pos >= this.start && pos + length <= this.end
  }

  b2(pos: number): number {
    const i = pos - this.start
    return this.bytes[i] | (this.bytes[i + 1] << 8)
  }

  b4(pos: number): number {
    const i = pos - this.start
    const d = this.bytes
    return (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0
  }

  b8(pos: number): number {
    return this.b4(pos) + this.b4(pos + 4) * 4294967296
  }
}

const utf8 = new TextDecoder('utf-8')

/** 項目の名前。フラグの 11 ビット目があれば UTF-8、なければ 1 バイト 1 文字（fflate と同じ） */
function decodeName(bytes: Uint8Array, flags: number): string {
  if (flags & 2048) return utf8.decode(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i += 16384) {
    out += String.fromCharCode(...bytes.subarray(i, i + 16384))
  }
  return out
}

async function readChunk(reader: RangeReader, start: number, end: number): Promise<Chunk> {
  const clampedEnd = Math.min(end, reader.size)
  if (start < 0 || clampedEnd < start) throw new ZipLayoutError(`zip の範囲がファイルの外です: ${start}〜${end}`)
  const bytes = await reader.read(start, clampedEnd)
  if (bytes.length !== clampedEnd - start) {
    throw new ZipLayoutError('読めたバイト数が足りません（読んでいる間にファイルが変わったかもしれません）')
  }
  return new Chunk(start, bytes)
}

/** pos から length バイトを、手元の chunk から取るか、なければ読む */
async function chunkFor(reader: RangeReader, have: Chunk, pos: number, length: number): Promise<Chunk> {
  if (have.contains(pos, length)) return have
  return readChunk(reader, pos, pos + length)
}

interface WantedEntry {
  readonly name: string
  readonly compression: number
  readonly compressedSize: number
  readonly originalSize: number
  readonly offset: number
}

/** 一覧の中の項目1つ分。fflate の zh と同じ読み方 */
interface DirectoryRecord {
  readonly compression: number
  readonly compressedSize: number
  readonly originalSize: number
  readonly name: string
  readonly next: number
  readonly offset: number
}

function readRecord(cd: Chunk, pos: number, zip64: boolean): DirectoryRecord {
  if (!cd.contains(pos, 46)) throw new ZipLayoutError('ファイルの一覧が途中で切れています')
  const nameLength = cd.b2(pos + 28)
  const nameStart = pos + 46
  if (!cd.contains(nameStart, nameLength)) throw new ZipLayoutError('ファイルの一覧が途中で切れています')
  const name = decodeName(cd.bytes.subarray(nameStart - cd.start, nameStart - cd.start + nameLength), cd.b2(pos + 8))
  const extraStart = nameStart + nameLength
  const next = extraStart + cd.b2(pos + 30) + cd.b2(pos + 32)
  const compressedSize32 = cd.b4(pos + 20)
  if (zip64 && compressedSize32 === 4294967295) {
    // zip64 の追加情報（ID 1）から大きさと位置を読む
    let b = extraStart
    for (;;) {
      if (!cd.contains(b, 4)) throw new ZipLayoutError('zip64 の追加情報が見つかりません')
      if (cd.b2(b) === 1) break
      b += 4 + cd.b2(b + 2)
    }
    if (!cd.contains(b, 28)) throw new ZipLayoutError('zip64 の追加情報が途中で切れています')
    return {
      compression: cd.b2(pos + 10),
      compressedSize: cd.b8(b + 12),
      originalSize: cd.b8(b + 4),
      name,
      next,
      offset: cd.b8(b + 20),
    }
  }
  return {
    compression: cd.b2(pos + 10),
    compressedSize: compressedSize32,
    originalSize: cd.b4(pos + 24),
    name,
    next,
    offset: cd.b4(pos + 42),
  }
}

/** 欲しい項目を、間の狭いものどうしでまとめた読む範囲 */
function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.start - last.end <= MERGE_GAP) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  return merged
}

/**
 * zip の一覧を読み、wanted が true を返す項目の中身（圧縮されたまま）を集める。
 * 読むのは、末尾の目印・ファイルの一覧・欲しい項目だけ。
 * 想定と違う形なら ZipLayoutError を投げる（呼ぶ側はファイル全体を読む方法に戻す）。
 */
export async function readZipPartially(reader: RangeReader, wanted: (name: string) => boolean): Promise<ExtractedZip> {
  const size = reader.size
  if (!Number.isSafeInteger(size) || size < EOCD_SIZE) throw new ZipLayoutError('zip として小さすぎます')

  // 末尾の目印を探す。zip64 の locator（目印の 20 バイト前）も一緒に読んでおく
  const tail = await readChunk(reader, Math.max(0, size - EOCD_SEARCH - ZIP64_LOCATOR_SIZE), size)
  let e = size - EOCD_SIZE
  while (tail.b4(e) !== EOCD_SIGNATURE) {
    if (e === 0 || size - e > EOCD_SEARCH) throw new ZipLayoutError('zip の末尾の目印が見つかりません')
    e--
    if (e < tail.start) throw new ZipLayoutError('zip の末尾の目印が見つかりません')
  }

  let count = tail.b2(e + 8)
  if (count === 0) return { names: [], entries: [] }
  let cdStart = tail.b4(e + 16)
  let cdEnd = e
  let zip64 = cdStart === 4294967295 || count === 65535
  if (zip64) {
    if (!tail.contains(e - 12, 4)) throw new ZipLayoutError('zip64 の目印の位置が読めません')
    const ze = tail.b4(e - 12)
    const z = await chunkFor(reader, tail, ze, ZIP64_EOCD_SIZE)
    zip64 = z.contains(ze, 4) && z.b4(ze) === ZIP64_EOCD_SIGNATURE
    if (zip64) {
      count = z.b4(ze + 32)
      cdStart = z.b4(ze + 48)
      cdEnd = ze
    }
  }
  if (cdStart > cdEnd) throw new ZipLayoutError('ファイルの一覧の位置がおかしいです')

  // ファイルの一覧を読む
  const cd = await chunkFor(reader, tail, cdStart, cdEnd - cdStart)
  const names: string[] = []
  const wantedEntries: WantedEntry[] = []
  const offsets: number[] = []
  let pos = cdStart
  for (let i = 0; i < count; i++) {
    const r = readRecord(cd, pos, zip64)
    pos = r.next
    names.push(r.name)
    offsets.push(r.offset)
    if (wanted(r.name)) {
      wantedEntries.push({
        name: r.name,
        compression: r.compression,
        compressedSize: r.compressedSize,
        originalSize: r.originalSize,
        offset: r.offset,
      })
    }
  }
  if (wantedEntries.length === 0) return { names, entries: [] }

  // 欲しい項目の範囲。項目は並んで入っているので、次の項目の始まり（なければ一覧の始まり）までを読む
  const sortedOffsets = [...new Set(offsets)].sort((a, b) => a - b)
  const nextOffset = (offset: number): number => {
    let lo = 0
    let hi = sortedOffsets.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sortedOffsets[mid] <= offset) lo = mid + 1
      else hi = mid
    }
    const next = lo < sortedOffsets.length ? sortedOffsets[lo] : cdStart
    return next > offset ? next : size
  }
  const spans = wantedEntries.map((w) => {
    // 見出しの名前と追加情報は最大 65535 バイトずつ。それより先は読まない
    const limit = w.offset + LOCAL_HEADER_SIZE + 2 * 65535 + w.compressedSize
    return { start: w.offset, end: Math.min(nextOffset(w.offset), limit, size) }
  })
  const chunks: Chunk[] = []
  for (const span of mergeSpans(spans)) {
    if (span.end > span.start) chunks.push(await readChunk(reader, span.start, span.end))
  }
  const chunkAt = (pos: number, length: number): Chunk | null => chunks.find((c) => c.contains(pos, length)) ?? null

  const entries: CompressedZipEntry[] = []
  for (const w of wantedEntries) {
    if (w.offset + LOCAL_HEADER_SIZE > size) throw new ZipLayoutError(`${w.name}: 項目の見出しがファイルの外です`)
    const header = chunkAt(w.offset, LOCAL_HEADER_SIZE) ?? (await readChunk(reader, w.offset, w.offset + LOCAL_HEADER_SIZE))
    // 中身の始まり。fflate の slzh と同じく、見出しの名前と追加情報の長さを足す
    const dataStart = w.offset + LOCAL_HEADER_SIZE + header.b2(w.offset + 26) + header.b2(w.offset + 28)
    // ファイルの末尾を超える分は、fflate と同じく切り詰める（展開で失敗する）
    const available = Math.max(0, Math.min(w.compressedSize, size - dataStart))
    const body = chunkAt(dataStart, available) ?? (await readChunk(reader, dataStart, dataStart + available))
    const from = dataStart - body.start
    entries.push({
      name: w.name,
      compression: w.compression,
      originalSize: w.originalSize,
      data: body.bytes.subarray(from, from + available),
    })
  }
  return { names, entries }
}

/** Worker へ移せるバッファの一覧（重なりなし）。entries の data は同じバッファを共有していることがある */
export function extractedZipTransfer(zip: ExtractedZip): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const e of zip.entries) {
    if (e.data.buffer instanceof ArrayBuffer) buffers.add(e.data.buffer)
  }
  return [...buffers]
}

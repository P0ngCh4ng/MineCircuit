// 書き出しの前のお知らせと、書き出しの結果の文（docs/design.md「ゲームとの行き来」）。

import { BlueprintWriteError } from '../../io/writers/blueprintWriter'
import type { ExportResult } from '../../io/writers/exportBlueprint'
import type { ExportSummary } from '../../io/writers/exportSummary'

/** 内訳を書く ID の数の上限。これより多いときは「ほか n 種類」 */
const MAX_LISTED_IDS = 5

/** 生データのないブロックのお知らせ。なければ null */
export function missingBlockEntityNotice(summary: ExportSummary): string | null {
  const missing = summary.missingBlockEntities
  if (missing.length === 0) return null
  const listed = missing
    .slice(0, MAX_LISTED_IDS)
    .map((m) => `${m.id}（${m.count.toLocaleString('ja-JP')} 個）`)
    .join('、')
  const rest = missing.length > MAX_LISTED_IDS ? `、ほか ${missing.length - MAX_LISTED_IDS} 種類` : ''
  return (
    `生データ（nbt）のないブロックが ${summary.missingBlockEntityCount.toLocaleString('ja-JP')} 個あります：${listed}${rest}。` +
    'アプリで置いたブロックです。ゲームに持ち込むと、中身や設定は初期の値になります。'
  )
}

/** 書き出しの前に知らせること。なければ空 */
export function exportNotices(summary: ExportSummary, missingModsNotice: string | null): string[] {
  return [missingBlockEntityNotice(summary), missingModsNotice].filter((n): n is string => n !== null)
}

/** 書き出しの結果の文 */
export function exportResultMessage(result: ExportResult): string {
  if (result.status === 'cancelled') return '書き出しをやめました。ファイルは保存していません。'
  const kb = Math.max(1, Math.round(result.byteLength / 1024)).toLocaleString('ja-JP')
  return `"${result.fileName}"（${kb} KB）を書き出しました。`
}

/** 書き出せなかったときの文 */
export function exportErrorMessage(e: unknown): string {
  if (e instanceof BlueprintWriteError) return e.message
  const detail = e instanceof Error ? e.message : String(e)
  return `書き出せませんでした（${detail}）。ファイルは保存していません。保存先を変えて、もう一度書き出してください。`
}

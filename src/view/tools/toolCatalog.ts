import type { ToolId } from './tool'

/** ツールバーに並べる1つ分の情報 */
export interface ToolInfo {
  readonly id: ToolId
  /** 画面に出す名前 */
  readonly label: string
  /** 切り替えのキー（大文字）。キーがないツールは null */
  readonly key: string | null
  /** 説明（ボタンの title に出す） */
  readonly description: string
  /** 区切りの後に置くなら true（編集のツールの前） */
  readonly groupStart?: boolean
}

/** ツールバーの並び順。docs/ui.md「ツール」 */
export const TOOL_CATALOG: readonly ToolInfo[] = [
  { id: 'select', label: '選択', key: 'V', description: 'ブロックの情報を右パネルに出す' },
  { id: 'measure', label: '計測', key: 'M', description: '2つのブロックの距離を測る' },
  { id: 'connect', label: 'つながり', key: 'C', description: '隣り合う同じ種類のブロックをまとめて強調する' },
  { id: 'probe', label: 'プローブ', key: null, description: '回転数と応力を見る' },
  { id: 'port', label: '仮の入出力', key: null, description: 'ブロックの面に仮の動力源や負荷を置く' },
  { id: 'place', label: '置く', key: 'B', description: 'ブロックを置く・置き換える', groupStart: true },
  { id: 'erase', label: '消す', key: 'E', description: 'ブロックを消す' },
  { id: 'pick', label: 'スポイト', key: 'I', description: 'クリックしたブロックを「置くブロック」にする' },
]

/** ツールの情報を返す */
export function toolInfo(id: ToolId): ToolInfo {
  const info = TOOL_CATALOG.find((t) => t.id === id)
  if (!info) throw new Error(`ツールの情報がありません: ${id}`)
  return info
}

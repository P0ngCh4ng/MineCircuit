import type { ConnectToolDef } from '../../calc/connectTool'
import { connectTools } from '../edit/placementRules'
import type { CoreToolId, ToolId } from './tool'

/** ツールバーに並べる1つ分の情報 */
export interface ToolInfo {
  readonly id: ToolId
  /** 画面に出す名前 */
  readonly label: string
  /** 切り替えのキー（大文字）。キーがないツールは null */
  readonly key: string | null
  /** 説明（ボタンの title に出す） */
  readonly description: string
  /** ボタンの絵（SVG の path。viewBox 0 0 20 20） */
  readonly icon: readonly string[]
  /** 区切りの後に置くなら true（編集のツールの前） */
  readonly groupStart?: boolean
}

/** 内蔵のツールの並び順。docs/ui.md「ツール」 */
export const CORE_TOOLS: readonly (ToolInfo & { readonly id: CoreToolId })[] = [
  { id: 'select', label: '選択', key: 'V', description: 'ブロックの情報を右パネルに出す', icon: ['M5 3l10 6.5-4.6 1.1L8.6 15z'] },
  {
    id: 'measure',
    label: '計測',
    key: 'M',
    description: '2つのブロックの距離を測る',
    icon: ['M3 14L14 3l3 3L6 17z', 'M7 10l1.5 1.5M9.5 7.5L11 9M12 5l1.5 1.5'],
  },
  {
    id: 'network',
    label: 'ネットワーク',
    key: 'C',
    description: 'クリックしたブロックと、回転でつながったブロックを強調する',
    icon: [
      'M5 5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15 5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10 15m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
      'M7.5 5h5M6.3 7.2l2.4 5.6M13.7 7.2l-2.4 5.6',
    ],
  },
  {
    id: 'sameBlock',
    label: '同じブロック',
    key: 'S',
    description: '隣り合う同じ種類のブロックをまとめて強調する',
    icon: ['M2.5 7.5h5v5h-5zM12.5 7.5h5v5h-5zM7.5 2.5h5v5h-5z', 'M7.5 10h5'],
  },
  { id: 'probe', label: 'プローブ', key: 'P', description: '回転数と応力を見る', icon: ['M12 3l5 5-7 7-3 1 1-3z', 'M4 16l-1.5 1.5'] },
  {
    id: 'port',
    label: '仮の入出力',
    key: 'O',
    description: 'ブロックの面に仮の動力源や負荷を置く',
    icon: ['M9 4.5h8v11H9z', 'M2 10h5M5 7.5L7.5 10 5 12.5'],
  },
  {
    id: 'place',
    label: '置く',
    key: 'B',
    description: 'ブロックを置く・置き換える。ドラッグで一直線に置く',
    icon: ['M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z', 'M10 7v6M7 10h6'],
    groupStart: true,
  },
  { id: 'erase', label: '消す', key: 'E', description: 'ブロックを消す', icon: ['M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z', 'M7.5 7.5l5 5M12.5 7.5l-5 5'] },
  {
    id: 'pick',
    label: 'スポイト',
    key: 'I',
    description: 'クリックしたブロックを「置くブロック」にする',
    icon: ['M13.5 3.5l3 3-2 2-3-3z', 'M11.5 5.5l-7 7-1 4 4-1 7-7'],
  },
]

/**
 * ツールバーの並び（#266）。内蔵のツールのあとに、計算プラグインのつなぐツールを足す。
 * id が重なるものは足さず、キーが重なるものはキーなしで足す
 */
export function buildToolCatalog(plugins: readonly ConnectToolDef[]): ToolInfo[] {
  const out: ToolInfo[] = [...CORE_TOOLS]
  for (const t of plugins) {
    if (out.some((o) => o.id === t.id)) continue
    const key = t.key && !out.some((o) => o.key?.toLowerCase() === t.key?.toLowerCase()) ? t.key : null
    out.push({ id: t.id, label: t.label, key, description: t.description, icon: t.icon })
  }
  return out
}

/** ツールバーの並び順。docs/ui.md「ツール」 */
export const TOOL_CATALOG: readonly ToolInfo[] = buildToolCatalog(connectTools())

/** ツールの情報を返す */
export function toolInfo(id: ToolId): ToolInfo {
  const info = TOOL_CATALOG.find((t) => t.id === id)
  if (!info) throw new Error(`ツールの情報がありません: ${id}`)
  return info
}

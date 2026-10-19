// 開いている設計図で使っている Mod と、読み込んだ Modpack に足りない Mod。
// 左パネルの「使っているMod」と、書き出しの前のお知らせ（docs/design.md「ゲームとの行き来」）で使う。

import { computed, type ComputedRef } from 'vue'
import { MissingModDetector, type NamespaceUsage } from '../../analysis/missingModDetector'
import { useDocumentSession } from '../document/documentSession'
import { useModpackContentStore } from '../stores/modpackContent'

const detector = new MissingModDetector()

export interface MissingMods {
  /** 使っている namespace とブロック数。足りないものが先。設計図がなければ空 */
  readonly usage: ComputedRef<NamespaceUsage[]>
  /** Modpack にない namespace（名前順）。Modpack がなければ空 */
  readonly missingNamespaces: ComputedRef<string[]>
  /** 書き出しの前に出すお知らせ。足りない Mod がなければ null */
  readonly exportNotice: ComputedRef<string | null>
}

/** 足りない Mod の書き出し前のお知らせ。missing が空なら null */
export function missingModsNotice(missing: readonly NamespaceUsage[]): string | null {
  if (missing.length === 0) return null
  const list = missing.map((u) => `${u.namespace}（${u.blockCount.toLocaleString()} 個）`).join('、')
  return `Modpack にない Mod のブロックがあります：${list}。この Modpack のゲームに読み込むと、これらのブロックは置かれません。`
}

/** 部品の setup の中で呼ぶ */
export function useMissingMods(): MissingMods {
  const session = useDocumentSession()
  const content = useModpackContentStore()

  const usage = computed(() => {
    void session.version.value
    const bp = session.current.value?.blueprint
    return bp ? detector.usage(bp, content.pack) : []
  })
  const missing = computed(() => usage.value.filter((u) => u.missing))

  return {
    usage,
    missingNamespaces: computed(() => missing.value.map((u) => u.namespace).sort()),
    exportNotice: computed(() => missingModsNotice(missing.value)),
  }
}

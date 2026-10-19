<script setup lang="ts">
// 上のバーの、開いている設計図の情報
import { computed } from 'vue'
import { useBlueprintStats } from '../analysis/useBlueprintStats'
import { minecraftVersionLabel, summarizeBlueprint } from './blueprintSummary'
import { useDocumentSession } from './documentSession'

const session = useDocumentSession()
const stats = useBlueprintStats()

const summary = computed(() => {
  const doc = session.current.value
  return doc && stats.value ? summarizeBlueprint(doc.blueprint, stats.value) : null
})

const fileName = computed(() => session.current.value?.fileName ?? null)

function count(n: number): string {
  return n.toLocaleString('ja-JP')
}

const facts = computed(() => {
  const s = summary.value
  const edits = session.editCount.value
  return [
    { key: 'size', label: '寸法', title: '幅 × 高さ × 奥行き', value: s ? s.size.join(' × ') : '–' },
    { key: 'blocks', label: 'ブロック', title: '空きでないブロックの数', value: s ? count(s.blockCount) : '–' },
    { key: 'kinds', label: '種類', title: 'ブロックの ID の種類の数', value: s ? count(s.kindCount) : '–' },
    {
      key: 'nbt',
      label: 'nbt付き',
      title: '生データ（ブロックエンティティ）を持つブロックの数',
      value: s ? count(s.blockEntityCount) : '–',
    },
    { key: 'entities', label: 'エンティティ', title: '額縁・防具立てなどの数', value: s ? count(s.entityCount) : '–' },
    {
      key: 'version',
      label: 'バージョン',
      title: 'ファイルの DataVersion から推定した Minecraft のバージョン',
      value: s ? minecraftVersionLabel(s.dataVersion) : '–',
    },
    { key: 'edits', label: '編集', title: '元に戻せる編集の回数', value: s ? (edits > 0 ? `${count(edits)} 回` : 'なし') : '–' },
  ]
})
</script>

<template>
  <div class="facts-wrap">
    <span class="file-name" :title="fileName ?? undefined">{{ fileName ?? '設計図を開いていません' }}</span>
    <dl class="facts" aria-label="設計図の情報">
      <div v-for="f in facts" :key="f.key" :data-fact="f.key">
        <dt>{{ f.label }}</dt>
        <dd :title="f.title">{{ f.value }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.facts-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  min-width: 0;
}

.file-name {
  max-width: 24ch;
  overflow: hidden;
  font-weight: bold;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
}

.facts div {
  display: flex;
  gap: 4px;
  align-items: baseline;
}

dt {
  font-size: 11px;
  opacity: 0.7;
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>

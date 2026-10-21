<script setup lang="ts">
// 右パネルの「選択中のブロック」（#12）。docs/ui.md「全体の配置」。
// 選択ツールで選んだブロックの名前・ID・位置・ブロック状態と、生データ（nbt）のツリーを出す。
// 名前は Modpack を読み込んでいれば表示名、なければ ID。
import { computed } from 'vue'
import { useDocumentSession } from '../document/documentSession'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import { nbtTreeNode } from './nbtTree'
import NbtTreeItem from './NbtTreeItem.vue'
import BlockSettingsEditor from './BlockSettingsEditor.vue'

const session = useDocumentSession()
const tools = useToolStore()
const content = useModpackContentStore()

const detail = computed(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  const pos = tools.selectedPos
  if (!bp || !pos) return null
  const state = bp.get(pos)
  const id = state?.id.toString() ?? null
  const blockEntity = bp.blockEntityAt(pos)
  return {
    pos,
    state,
    id,
    name: id ? content.displayName(id) : null,
    properties: state ? Object.entries(state.properties) : [],
    // リージョンが2つ以上あるときだけ、どのリージョンかを出す
    region: bp.regions.length > 1 ? (bp.locate(pos)?.region.name ?? null) : null,
    tree: blockEntity ? nbtTreeNode('', blockEntity) : null,
  }
})

const posText = computed(() => {
  const p = detail.value?.pos
  return p ? `${p[0]}, ${p[1]}, ${p[2]}（段 ${p[1] + 1}）` : ''
})
</script>

<template>
  <section class="block-detail" aria-labelledby="block-detail-heading">
    <div class="head">
      <h2 id="block-detail-heading">選択中のブロック</h2>
      <button v-if="tools.selectedPos" type="button" class="clear" title="Esc" @click="tools.setSelected(null)">
        選択の解除
      </button>
    </div>

    <p v-if="!detail" class="note">
      選択ツール（V）でブロックをクリックすると、ここに ID・位置・ブロック状態・生データ（nbt）が出ます。
    </p>

    <template v-else>
      <div v-if="detail.id" class="title">
        <div class="name" data-detail="name">{{ detail.name ?? detail.id }}</div>
        <div v-if="detail.name" class="id" data-detail="id">{{ detail.id }}</div>
      </div>
      <p v-else class="note">この位置にはブロックがありません。</p>

      <dl class="kv">
        <dt>位置</dt>
        <dd data-detail="pos">{{ posText }}</dd>
        <template v-if="detail.region">
          <dt>リージョン</dt>
          <dd data-detail="region">{{ detail.region }}</dd>
        </template>
        <template v-for="[k, v] in detail.properties" :key="k">
          <dt :data-prop="k">{{ k }}</dt>
          <dd :data-prop-value="k">{{ v }}</dd>
        </template>
      </dl>
      <p v-if="detail.state && detail.properties.length === 0" class="note">ブロック状態の項目はありません。</p>

      <BlockSettingsEditor v-if="detail.state" :pos="detail.pos" />

      <div v-if="detail.tree" class="nbt">
        <div class="nbt-head">
          生データ（nbt）
          <span class="chip" title="設計図ファイルに保存されている値">設計図から</span>
        </div>
        <ul v-if="detail.tree.children && detail.tree.children.length > 0" class="tree">
          <NbtTreeItem v-for="(child, i) in detail.tree.children" :key="i" :node="child" :depth="0" />
        </ul>
        <p v-else class="note">生データは空です。</p>
      </div>
      <p v-else-if="detail.state" class="note">このブロックには生データ（nbt）がありません。</p>
    </template>
  </section>
</template>

<style scoped>
.block-detail {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
}

h2 {
  flex: 1;
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.clear {
  padding: 1px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.name {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.id {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  opacity: 0.7;
  overflow-wrap: anywhere;
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
  font-size: 12px;
}

.kv dt {
  opacity: 0.7;
}

.kv dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.nbt {
  display: grid;
  gap: 4px;
}

.nbt-head {
  font-size: 12px;
  font-weight: 600;
}

.chip {
  margin-left: 4px;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 10px;
  font-weight: normal;
  opacity: 0.8;
}

.tree {
  margin: 0;
  padding: 0;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  line-height: 1.5;
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.75;
}
</style>

<script setup lang="ts">
// 右パネルの「選択範囲」（#130）。docs/ui.md「右パネル『選択範囲』」。
// 2つ以上のブロックが入る範囲を選んでいるときに出す（1つのときは BlockDetail）。
// 範囲の座標と大きさ（数を打って直せる）だけを出す。範囲の操作は、範囲の近くに浮かぶツールバー（SelectionToolbar。#160）に置く。
import { computed } from 'vue'
import { boxSize } from '../../domain/box'
import { useDocumentSession } from '../document/documentSession'
import { useToolStore } from '../stores/toolStore'
import { displayCoordinate, editBoxCoordinate, type BoxField } from './selectionModel'

const session = useDocumentSession()
const tools = useToolStore()

const AXES = [
  { axis: 0, label: 'x' },
  { axis: 1, label: '段' },
  { axis: 2, label: 'z' },
] as const

const box = computed(() => tools.selectionBox)

const size = computed(() => {
  const b = box.value
  if (!b) return ''
  const [x, y, z] = boxSize(b)
  return `${x} × ${y} × ${z}（${x * y * z} マス）`
})

function onCoordinate(field: BoxField, axis: number, event: Event): void {
  const input = event.target as HTMLInputElement
  const bp = session.current.value?.blueprint
  const b = box.value
  if (!bp || !b) return
  const next = editBoxCoordinate(b, field, axis, input.valueAsNumber, bp.size)
  if (next) tools.setSelectionBox(next)
  else input.value = String(displayCoordinate(b[field], axis))
}
</script>

<template>
  <section class="selection-panel" aria-labelledby="selection-panel-heading" data-testid="selection-panel">
    <div class="head">
      <h2 id="selection-panel-heading">選択範囲</h2>
      <button type="button" class="small" title="Esc" @click="tools.setSelected(null)">選択の解除</button>
    </div>

    <template v-if="box">
      <table class="coords">
        <thead>
          <tr>
            <th></th>
            <th v-for="a in AXES" :key="a.axis" scope="col">{{ a.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in ['min', 'max'] as const" :key="field">
            <th scope="row">{{ field === 'min' ? '最小' : '最大' }}</th>
            <td v-for="a in AXES" :key="a.axis">
              <input
                type="number"
                step="1"
                :data-coord="`${field}-${a.axis}`"
                :aria-label="`${field === 'min' ? '最小' : '最大'}の${a.label}`"
                :value="displayCoordinate(box[field], a.axis)"
                @change="onCoordinate(field, a.axis, $event)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <dl class="kv">
        <dt>大きさ</dt>
        <dd data-selection="size">{{ size }}</dd>
      </dl>
    </template>
  </section>
</template>

<style scoped>
.selection-panel {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
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

button {
  padding: 2px 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button.small {
  padding: 1px 8px;
  font-size: 11px;
}

.coords {
  border-collapse: collapse;
}

.coords th {
  padding: 0 4px;
  font-weight: normal;
  opacity: 0.7;
  text-align: left;
}

.coords td {
  padding: 1px 2px;
}

.coords input {
  width: 4.5em;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
}

.kv dt {
  opacity: 0.7;
}

.kv dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>

<script setup lang="ts">
// 右パネルの「選択範囲」（#130）。docs/ui.md「右パネル『選択範囲』」「まとめて変える」。
// 2つ以上のブロックが入る範囲を選んでいるときに出す（1つのときは BlockDetail）。
// 範囲の座標と大きさ（数を打って直せる）、中のブロックの数と多い種類、消す・塗る・置き換えのボタン。
import { computed, ref } from 'vue'
import { boxSize } from '../../domain/box'
import { useDocumentSession } from '../document/documentSession'
import { useRegionActions } from '../edit/regionActions'
import { useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import { displayCoordinate, editBoxCoordinate, selectionStats, TOP_KINDS, type BoxField } from './selectionModel'

const session = useDocumentSession()
const tools = useToolStore()
const brush = useBrushStore()
const content = useModpackContentStore()
const actions = useRegionActions()

const AXES = [
  { axis: 0, label: 'x' },
  { axis: 1, label: '段' },
  { axis: 2, label: 'z' },
] as const

const onlyEmpty = ref(true)
const keepOrientation = ref(true)
/** 「置き換える物」に選んだ状態の key。範囲の中になければ一番多い状態を使う */
const fromKey = ref<string | null>(null)

const box = computed(() => tools.selectionBox)

const size = computed(() => {
  const b = box.value
  if (!b) return ''
  const [x, y, z] = boxSize(b)
  return `${x} × ${y} × ${z}（${x * y * z} マス）`
})

const stats = computed(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  const b = box.value
  return bp && b ? selectionStats(bp, b) : null
})

const topKinds = computed(() =>
  (stats.value?.kinds ?? []).slice(0, TOP_KINDS).map((k) => ({ ...k, name: content.displayName(k.id) ?? k.id })),
)

const fromState = computed(() => {
  const states = stats.value?.states ?? []
  return states.find((s) => s.state.key === fromKey.value)?.state ?? states[0]?.state ?? null
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

function onFrom(event: Event): void {
  fromKey.value = (event.target as HTMLSelectElement).value
}

function replace(): void {
  const from = fromState.value
  if (from) actions.replace(from, keepOrientation.value)
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
        <dt>ブロック</dt>
        <dd data-selection="count">{{ stats?.blockCount ?? 0 }} 個</dd>
      </dl>

      <ol v-if="topKinds.length > 0" class="kinds" aria-label="多い種類">
        <li v-for="k in topKinds" :key="k.id" :data-kind="k.id">
          <span class="kind-name" :title="k.id">{{ k.name }}</span>
          <span class="kind-count">{{ k.count }}</span>
        </li>
      </ol>
      <p v-else class="note">範囲の中にブロックはありません。</p>

      <div class="group">
        <button type="button" data-action="erase" title="Delete" @click="actions.erase()">消す</button>
      </div>

      <div class="group">
        <button type="button" data-action="fill" title="F" @click="actions.fill(onlyEmpty)">置くブロックで塗る</button>
        <label class="check">
          <input v-model="onlyEmpty" type="checkbox" data-option="only-empty" />
          空きだけ
        </label>
      </div>
      <p class="note">
        置くブロック：<span data-selection="brush">{{ brush.state?.key ?? 'まだ選んでいません' }}</span>
      </p>

      <fieldset class="replace">
        <legend>置き換え</legend>
        <label class="field">
          置き換える物
          <select data-option="replace-from" :value="fromState?.key ?? ''" :disabled="!fromState" @change="onFrom">
            <option v-for="s in stats?.states ?? []" :key="s.state.key" :value="s.state.key">
              {{ s.state.key }}（{{ s.count }}）
            </option>
          </select>
        </label>
        <div class="field">
          置く物
          <span class="mono" data-selection="replace-to">{{ brush.state?.key ?? '置くブロックを選んでください' }}</span>
        </div>
        <label class="check">
          <input v-model="keepOrientation" type="checkbox" data-option="keep-orientation" />
          向きを引き継ぐ
        </label>
        <p class="note">生データは消えます。</p>
        <div>
          <button type="button" data-action="replace" :disabled="!fromState" @click="replace">置き換え</button>
        </div>
      </fieldset>
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

button:disabled {
  cursor: default;
  opacity: 0.5;
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

.kinds {
  display: grid;
  gap: 1px;
  margin: 0;
  padding-left: 1.5em;
}

.kinds li > span {
  display: inline-block;
}

.kind-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.kind-count {
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.replace {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 6px 8px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
}

.replace legend {
  padding: 0 4px;
  font-weight: 600;
}

.field {
  display: grid;
  gap: 2px;
}

.field select {
  max-width: 100%;
  font: inherit;
}

.mono {
  font-family: ui-monospace, monospace;
  overflow-wrap: anywhere;
}

.note {
  margin: 0;
  line-height: 1.5;
  opacity: 0.75;
}
</style>

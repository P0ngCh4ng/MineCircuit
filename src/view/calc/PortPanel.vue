<script setup lang="ts">
// 右パネルの仮の入出力（#70）。置く種類の選択と、置いた仮の入出力の一覧（値の変更と削除）。
// 仮の入出力のツールを使っている間と、1つ以上置いている間だけ出す。
import { computed, ref } from 'vue'
import type { PortItemParamDef, PortParamDef, VirtualPort } from '../../calc/virtualPort'
import { DIRECTIONS, isDirection } from '../../domain/direction'
import { useCalcStore } from '../stores/calcStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import {
  FACE_LABELS,
  findPortKind,
  itemCandidates,
  parsePortNumber,
  portKindKey,
  withPortFace,
  withPortItem,
  withPortLabel,
  withPortParam,
} from './portModel'
import { formatPos } from './probeModel'
import { useJumpTo } from './useProbeTool'

const tools = useToolStore()
const store = usePortStore()
const calc = useCalcStore()
const content = useModpackContentStore()
const jumpTo = useJumpTo()

const active = computed(() => tools.activeToolId === 'port')
const visible = computed(() => active.value || store.ports.length > 0)

function kindLabel(port: VirtualPort): string {
  return findPortKind(store.options, port)?.def.label ?? port.kind
}

/** 入力欄に出す数値の定義。プラグインが知らない種類なら、params のキーをそのまま出す */
function paramDefs(port: VirtualPort): readonly PortParamDef[] {
  const option = findPortKind(store.options, port)
  if (option) return option.def.params
  return Object.keys(port.params).map((key) => ({ key, label: key, defaultValue: 0 }))
}

function onKindChange(e: Event): void {
  store.setPlaceKey((e.target as HTMLSelectElement).value)
}

function onParamChange(port: VirtualPort, def: PortParamDef, e: Event): void {
  const input = e.target as HTMLInputElement
  const value = parsePortNumber(input.value)
  // 数でない、または省略できない値を空にしたときは元に戻す
  if (value === undefined || (value === null && !def.optional)) {
    input.value = port.params[def.key]?.toString() ?? ''
    return
  }
  store.update(withPortParam(port, def.key, value))
}

/** アイテムの欄の定義（#127） */
function itemDefs(port: VirtualPort): readonly PortItemParamDef[] {
  return findPortKind(store.options, port)?.def.itemParams ?? []
}

/**
 * アイテムの欄に打っている途中の文字（`<port の id>/<欄>` → 文字）。候補（datalist）は打っている文字で絞る。
 * 打つたびに候補が変わって画面を描き直すので、途中の文字を持っておかないと、欄が元の値に戻ってしまう
 */
const itemDrafts = ref<Record<string, string>>({})
const itemText = ref('')
const candidates = computed(() => itemCandidates(content.pack, itemText.value))

function itemDraftKey(port: VirtualPort, def: PortItemParamDef): string {
  return `${port.id}/${def.key}`
}

function onItemInput(port: VirtualPort, def: PortItemParamDef, e: Event): void {
  const text = (e.target as HTMLInputElement).value
  itemDrafts.value = { ...itemDrafts.value, [itemDraftKey(port, def)]: text }
  itemText.value = text
}

/** 候補の名前を選んだときは、その ID にする。名前と ID の両方を打てる */
function itemIdOf(text: string): string {
  const t = text.trim()
  return candidates.value.find((c) => c.name === t)?.id ?? t
}

function onItemChange(port: VirtualPort, def: PortItemParamDef, e: Event): void {
  const { [itemDraftKey(port, def)]: _done, ...rest } = itemDrafts.value
  itemDrafts.value = rest
  store.update(withPortItem(port, def.key, itemIdOf((e.target as HTMLInputElement).value)))
}

function onFace2DChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  store.setFace2D(isDirection(value) ? value : 'auto')
}

function onFaceChange(port: VirtualPort, e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  if (isDirection(value)) store.update(withPortFace(port, value))
}

function onLabelChange(port: VirtualPort, e: Event): void {
  store.update(withPortLabel(port, (e.target as HTMLInputElement).value))
}

function selectPort(port: VirtualPort): void {
  store.select(port.id)
  jumpTo(port.pos)
}
</script>

<template>
  <section v-if="visible" class="port-panel" aria-label="仮の入出力" data-testid="port-panel">
    <h2>仮の入出力</h2>
    <template v-if="active">
      <p v-if="store.options.length === 0" class="empty">仮の入出力を受け付ける計算プラグインがありません。</p>
      <template v-else>
        <label class="kind">
          置く種類
          <select :value="store.placeKey ?? ''" data-testid="port-kind" @change="onKindChange">
            <option v-for="o in store.options" :key="portKindKey(o.pluginId, o.def.kind)" :value="portKindKey(o.pluginId, o.def.kind)">
              {{ o.pluginLabel }}：{{ o.def.label }}
            </option>
          </select>
        </label>
        <p v-if="store.placeOption?.def.description" class="hint">{{ store.placeOption.def.description }}</p>
        <label class="kind">
          2Dで置く面
          <select :value="store.face2D" data-testid="port-face-2d" @change="onFace2DChange">
            <option value="auto">自動（軸と隣の空きから）</option>
            <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ FACE_LABELS[d] }}</option>
          </select>
        </label>
        <p class="hint">
          ブロックの面をクリックすると置きます。2D表示では、上で選んだ面に置きます（下の一覧で直せます）。ブロックを消すと、そのブロックの仮の入出力も消えます。
        </p>
      </template>
    </template>
    <p v-if="!calc.hasBlueprint" class="empty">設計図を開くと置けます。</p>

    <p v-if="store.ports.length === 0" class="empty">まだ置いていません。</p>
    <ul v-else class="ports">
      <li
        v-for="port in store.ports"
        :key="port.id"
        class="port"
        :class="{ selected: store.selectedId === port.id }"
        :data-port="port.id"
        :data-kind="port.kind"
      >
        <div class="head">
          <button type="button" class="pos" :title="`${formatPos(port.pos)} へ移る`" @click="selectPort(port)">
            {{ formatPos(port.pos) }}
          </button>
          <span class="kind-name">{{ kindLabel(port) }}</span>
          <button type="button" data-action="remove-port" @click="store.remove(port.id)">消す</button>
        </div>
        <div class="fields">
          <label>
            面
            <select :value="port.face" data-field="face" @change="onFaceChange(port, $event)">
              <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ FACE_LABELS[d] }}</option>
            </select>
          </label>
          <label v-for="def in paramDefs(port)" :key="def.key">
            {{ def.label }}
            <input
              type="number"
              :data-param="def.key"
              :value="port.params[def.key] ?? ''"
              :min="def.min"
              :max="def.max"
              :placeholder="def.optional ? '使わない' : undefined"
              @change="onParamChange(port, def, $event)"
            />
            <span v-if="def.unit" class="unit">{{ def.unit }}</span>
          </label>
          <label v-for="def in itemDefs(port)" :key="`item-${def.key}`">
            {{ def.label }}
            <input
              type="text"
              list="port-item-candidates"
              :data-item="def.key"
              :value="itemDrafts[itemDraftKey(port, def)] ?? port.items?.[def.key] ?? ''"
              :placeholder="content.pack ? '名前か ID（minecraft:wheat）' : 'ID（minecraft:wheat）'"
              @input="onItemInput(port, def, $event)"
              @change="onItemChange(port, def, $event)"
            />
          </label>
          <label>
            メモ
            <input type="text" data-field="label" :value="port.label ?? ''" placeholder="外の水車列 など" @change="onLabelChange(port, $event)" />
          </label>
        </div>
      </li>
    </ul>
    <datalist id="port-item-candidates">
      <option v-for="c in candidates" :key="c.id" :value="c.name">{{ c.id }}</option>
    </datalist>
    <p class="note">
      仮の入出力は設計図（.nbt）には書き込みません。別の設計図を開くと消えます。
      <button v-if="store.ports.length > 0" type="button" data-action="clear-ports" @click="store.clear()">すべて消す</button>
    </p>
  </section>
</template>

<style scoped>
.port-panel {
  font-size: 13px;
  margin-bottom: 16px;
}

h2 {
  font-size: 14px;
  margin: 0 0 8px;
}

.kind {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.kind select {
  max-width: 100%;
}

.hint,
.empty,
.note {
  opacity: 0.75;
  margin: 4px 0;
}

.ports {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.port {
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
  border-left: 4px solid #2e9d4f;
  border-radius: 4px;
  padding: 4px 6px;
}

.port[data-kind='rotation-load'] {
  border-left-color: #c77c14;
}

.port[data-kind^='item-'] {
  border-left-color: #2f6fd0;
}

.port.selected {
  outline: 2px solid #8a4fd8;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kind-name {
  flex: 1;
}

.pos {
  font: inherit;
  font-family: ui-monospace, monospace;
  padding: 0 2px;
  cursor: pointer;
}

.fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  margin-top: 4px;
}

.fields label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fields input[type='number'] {
  width: 7em;
}

.fields input[type='text'] {
  flex: 1;
  min-width: 0;
}

.unit {
  opacity: 0.7;
}
</style>

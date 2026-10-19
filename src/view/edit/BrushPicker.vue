<script setup lang="ts">
// 左パネルの「置くブロック」（#18）。docs/ui.md「編集」。
// 設計図にあるブロックから選ぶか、ID を入力して選ぶ。スポイト（I）で表示中のブロックから取ることもできる。
import { computed, ref } from 'vue'
import type { BlockState } from '../../domain/blockState'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import { blockColorCss } from '../viewport/blockColor'
import { blueprintBlockStates, BrushInputError, parseBlockStateInput } from './brushInput'

const session = useDocumentSession()
const brush = useBrushStore()
const content = useModpackContentStore()
const tools = useToolStore()

const input = ref('')
const inputError = ref<string | null>(null)

/** 設計図にあるブロック状態。開く・編集のたびに集め直す */
const states = computed<BlockState[]>(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  return bp ? blueprintBlockStates(bp) : []
})

function label(state: BlockState): string {
  const name = content.displayName(state.id.toString())
  const props = Object.entries(state.properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const base = name ?? state.id.toString()
  return props ? `${base}（${props}）` : base
}

const current = computed(() => {
  const s = brush.state
  if (!s) return null
  return {
    key: s.key,
    name: content.displayName(s.id.toString()),
    id: s.id.toString(),
    color: blockColorCss(s.id.toString()),
    props: Object.entries(s.properties),
  }
})

/** 一覧で選んでいるもの。置くブロックが一覧にないときは空 */
const selectedKey = computed(() => {
  const key = brush.state?.key
  return key && states.value.some((s) => s.key === key) ? key : ''
})

function use(state: BlockState): void {
  brush.setFromBlock(state)
  inputError.value = null
  // 選んだらすぐ置けるように、置くツールにする
  tools.setTool('place')
}

function onSelect(e: Event): void {
  const key = (e.target as HTMLSelectElement).value
  const state = states.value.find((s) => s.key === key)
  if (state) use(state)
}

function onSubmit(): void {
  try {
    const state = parseBlockStateInput(input.value)
    if (!state) {
      inputError.value = 'ID を入力してください。例：create:shaft[axis=y]'
      return
    }
    use(state)
    input.value = ''
  } catch (e) {
    if (!(e instanceof BrushInputError)) throw e
    inputError.value = e.message
  }
}
</script>

<template>
  <section class="brush-picker" aria-labelledby="brush-heading">
    <h2 id="brush-heading">置くブロック</h2>

    <div v-if="current" class="current" data-testid="brush-current" :title="current.key">
      <span class="swatch" :style="{ background: current.color }" aria-hidden="true"></span>
      <span class="name">
        {{ current.name ?? current.id }}
        <small v-if="current.name">{{ current.id }}</small>
        <small v-for="[k, v] in current.props" :key="k" class="prop">{{ k }}={{ v }}</small>
      </span>
    </div>
    <p v-else class="note">まだ選んでいません。下の一覧から選ぶか、ID を入力します。</p>
    <p v-if="current" class="note">R で水平に回す、Shift+R で縦にする。</p>

    <label class="field">
      <span>設計図にあるブロック</span>
      <select data-testid="brush-select" :value="selectedKey" :disabled="states.length === 0" @change="onSelect">
        <option value="" disabled>{{ states.length === 0 ? '（ブロックがありません）' : '選んでください' }}</option>
        <option v-for="s in states" :key="s.key" :value="s.key">{{ label(s) }}</option>
      </select>
    </label>

    <form class="field" @submit.prevent="onSubmit">
      <label for="brush-id">ID を入力</label>
      <div class="row">
        <input
          id="brush-id"
          v-model="input"
          data-testid="brush-input"
          type="text"
          list="brush-id-list"
          placeholder="create:shaft[axis=y]"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="inputError !== null"
          @input="inputError = null"
        />
        <button type="submit">使う</button>
      </div>
      <datalist id="brush-id-list">
        <option v-for="s in states" :key="s.key" :value="s.key"></option>
      </datalist>
      <p v-if="inputError" class="error" role="alert">{{ inputError }}</p>
    </form>
  </section>
</template>

<style scoped>
.brush-picker {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.current {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: Canvas;
}

.swatch {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  border: 1px solid var(--line);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.name small {
  display: block;
  font-size: 10px;
  opacity: 0.65;
}

.field {
  display: grid;
  gap: 3px;
  font-size: 11px;
}

.field > span,
.field > label {
  opacity: 0.75;
}

.row {
  display: flex;
  gap: 4px;
}

select,
input {
  min-width: 0;
  font: inherit;
  font-size: 12px;
}

input {
  flex: 1;
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.75;
}

.error {
  margin: 0;
  color: #c62828;
  font-size: 11px;
  line-height: 1.5;
}
</style>

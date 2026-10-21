<script setup lang="ts">
// 左パネルの「置くブロック」（#18、#71）。docs/ui.md「編集」。
// 設計図にあるブロックから選ぶか、ID を入力して選ぶ。スポイト（I）で表示中のブロックから取ることもできる。
// Modpack を読んでいれば、jar にあるブロックを日本語名・英語名・ID の一部から探して選べ、
// ブロック状態の定義（#27）から向きなどの状態を選べる。
import { computed, nextTick, ref } from 'vue'
import { blockCatalogFor, type BlockCatalogEntry, type BlockCatalogResult } from '../../analysis/blockCatalog'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { initialPropertiesFor, propertyValueOptionsFor } from '../../edit/orientationOptions'
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
/** 検索結果で選んでいる行 */
const active = ref(0)

/** 設計図にあるブロック状態。開く・編集のたびに集め直す */
const states = computed<BlockState[]>(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  return bp ? blueprintBlockStates(bp) : []
})

/** Modpack から探した結果。Modpack がない・入力が空・"[" を含む（ID と状態の入力）ときは null */
const results = computed<BlockCatalogResult | null>(() => {
  const pack = content.pack
  const text = input.value.trim()
  if (!pack || text === '' || text.includes('[')) return null
  return blockCatalogFor(pack).search(text)
})

const activeDescendant = computed(() =>
  results.value && results.value.entries.length > 0 ? `brush-result-${active.value}` : undefined,
)

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

/**
 * 置くブロックの状態を選ぶ欄。ブロック状態の定義から読んだ取りうる値を出す（値が1つだけの property は出さない）。
 * 今の値が一覧にないとき（定義と違う設計図など）は、その値も入れる。定義にない property は上に表示するだけ。
 */
const propertyChoices = computed(() => {
  const s = brush.state
  if (!s) return []
  const options = propertyValueOptionsFor(content.pack, s.id)
  if (!options) return []
  return Object.entries(options)
    .filter(([name, values]) => values.length > 1 || s.properties[name] === undefined)
    .map(([name, values]) => {
      const value = s.properties[name] ?? ''
      return { name, value, values: value === '' || values.includes(value) ? [...values] : [value, ...values] }
    })
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

/** 検索結果から選ぶ。状態はブロック状態の定義の最初の組み合わせにする */
function useEntry(entry: BlockCatalogEntry): void {
  const id = ResourceLocation.parse(entry.id)
  use(new BlockState(id, initialPropertiesFor(content.pack, id)))
  input.value = ''
  active.value = 0
}

function onProperty(name: string, e: Event): void {
  const s = brush.state
  if (!s) return
  const value = (e.target as HTMLSelectElement).value
  brush.setFromBlock(new BlockState(s.id, { ...s.properties, [name]: value }))
}

function onInput(): void {
  inputError.value = null
  active.value = 0
}

function onKeydown(e: KeyboardEvent): void {
  const count = results.value?.entries.length ?? 0
  if (e.key === 'ArrowDown' && count > 0) {
    e.preventDefault()
    active.value = (active.value + 1) % count
  } else if (e.key === 'ArrowUp' && count > 0) {
    e.preventDefault()
    active.value = (active.value - 1 + count) % count
  } else if (e.key === 'Escape' && input.value !== '') {
    e.preventDefault()
    input.value = ''
    onInput()
    return
  } else {
    return
  }
  // 選んだ行が見えるようにする
  void nextTick(() => document.getElementById(`brush-result-${active.value}`)?.scrollIntoView?.({ block: 'nearest' }))
}

function onSubmit(): void {
  const hit = results.value?.entries[active.value]
  if (hit) {
    useEntry(hit)
    return
  }
  try {
    const state = parseBlockStateInput(input.value)
    if (!state) {
      inputError.value = content.pack
        ? '名前か ID を入力してください。例：モーター、create:shaft[axis=y]'
        : 'ID を入力してください。例：create:shaft[axis=y]'
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
    <p v-else class="note">
      まだ選んでいません。下の一覧から選ぶか、{{ content.pack ? '名前か ID で探します' : 'ID を入力します' }}。
    </p>

    <div v-if="propertyChoices.length > 0" class="props" data-testid="brush-props">
      <label v-for="p in propertyChoices" :key="p.name" class="prop-field">
        <span>{{ p.name }}</span>
        <select :value="p.value" :data-prop="p.name" @change="onProperty(p.name, $event)">
          <option v-if="p.value === ''" value="" disabled>選んでください</option>
          <option v-for="v in p.values" :key="v" :value="v">{{ v }}</option>
        </select>
      </label>
    </div>
    <p v-if="current" class="note">R で水平に回す、Shift+R で縦にする。</p>

    <label class="field">
      <span>設計図にあるブロック</span>
      <select data-testid="brush-select" :value="selectedKey" :disabled="states.length === 0" @change="onSelect">
        <option value="" disabled>{{ states.length === 0 ? '（ブロックがありません）' : '選んでください' }}</option>
        <option v-for="s in states" :key="s.key" :value="s.key">{{ label(s) }}</option>
      </select>
    </label>

    <form class="field" @submit.prevent="onSubmit">
      <label for="brush-id">{{ content.pack ? '名前か ID で探す' : 'ID を入力' }}</label>
      <div class="row">
        <input
          id="brush-id"
          v-model="input"
          data-testid="brush-input"
          type="text"
          :list="content.pack ? undefined : 'brush-id-list'"
          :placeholder="content.pack ? 'モーター、create:shaft[axis=y]' : 'create:shaft[axis=y]'"
          spellcheck="false"
          autocomplete="off"
          :role="content.pack ? 'combobox' : undefined"
          :aria-expanded="content.pack ? results !== null : undefined"
          :aria-controls="content.pack ? 'brush-results' : undefined"
          :aria-activedescendant="activeDescendant"
          :aria-invalid="inputError !== null"
          @input="onInput"
          @keydown="onKeydown"
        />
        <button type="submit">使う</button>
      </div>
      <datalist v-if="!content.pack" id="brush-id-list">
        <option v-for="s in states" :key="s.key" :value="s.key"></option>
      </datalist>
      <template v-if="results">
        <ul
          v-if="results.entries.length > 0"
          id="brush-results"
          class="results"
          role="listbox"
          aria-label="Modpack のブロック"
          data-testid="brush-results"
        >
          <li
            v-for="(entry, i) in results.entries"
            :id="`brush-result-${i}`"
            :key="entry.id"
            role="option"
            :aria-selected="i === active"
            :class="{ active: i === active }"
            :data-id="entry.id"
            @mousedown.prevent
            @mouseenter="active = i"
            @click="useEntry(entry)"
          >
            <span class="swatch small" :style="{ background: blockColorCss(entry.id) }" aria-hidden="true"></span>
            <span class="name">
              {{ entry.ja ?? entry.en ?? entry.id }}
              <small>{{ entry.ja && entry.en ? `${entry.en}・` : '' }}{{ entry.id }}</small>
            </span>
          </li>
        </ul>
        <p class="note" data-testid="brush-results-summary">
          <template v-if="results.total === 0">
            「{{ input.trim() }}」に合うブロックは Modpack にありません。Enter で ID として使います。
          </template>
          <template v-else-if="results.total > results.entries.length">
            {{ results.total }} 件のうち {{ results.entries.length }} 件を出しています。言葉を足して絞り込みます。
          </template>
          <template v-else>{{ results.total }} 件。↑↓ で選び、Enter で使います。</template>
        </p>
      </template>
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

.swatch.small {
  width: 14px;
  height: 14px;
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

.props {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 4px 8px;
}

.prop-field {
  display: grid;
  gap: 2px;
  font-size: 11px;
}

.prop-field > span {
  opacity: 0.75;
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

.results {
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: Canvas;
}

.results li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  cursor: pointer;
}

.results li.active {
  background: color-mix(in srgb, Highlight 22%, transparent);
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

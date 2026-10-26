<script setup lang="ts">
// 左パネルの「置くブロック」（#18、#71、#114）。docs/ui.md「編集」。
// ブロックの絵（アイコン）を並べた棚から選ぶ。棚に並べるものは「Mod」の欄で選ぶ（「この設計図」と、Modpack を読んでいれば Mod ごと）。
// 「ブロック」の欄で絞り込み、ID と状態（create:shaft[axis=y]）は Enter でそのまま使う。
// スポイト（I）で表示中のブロックから取ることもできる。状態（向きなど）はブロック状態の定義（#27）から選ぶ。
import { computed, ref, watch } from 'vue'
import { BlockState } from '../../domain/blockState'
import { propertyValueOptionsFor } from '../../edit/orientationOptions'
import { useDocumentSession } from '../document/documentSession'
import { useBlockIconStore } from '../stores/blockIconStore'
import { useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import { blockColorCss } from '../viewport/blockColor'
import { blockAbbreviation } from '../viewport/layerGrid2D'
import { BLUEPRINT_TAB, shelfItems, shelfTabs, type ShelfItem } from './blockShelf'
import { blueprintBlockStates, BrushInputError, parseBlockStateInput } from './brushInput'

const session = useDocumentSession()
const brush = useBrushStore()
const content = useModpackContentStore()
const tools = useToolStore()
const icons = useBlockIconStore()

const input = ref('')
const inputError = ref<string | null>(null)
const tabId = ref(BLUEPRINT_TAB)

/** 設計図にあるブロック状態。開く・編集のたびに集め直す */
const states = computed<BlockState[]>(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  return bp ? blueprintBlockStates(bp) : []
})

const tabs = computed(() => shelfTabs(content.pack, new Set(states.value.map((s) => s.id.namespace))))

// 選んでいたものがなくなったら（Modpack を外した）、この設計図に戻す。設計図が空なら最初の Mod にする
watch(
  tabs,
  (list) => {
    if (!list.some((t) => t.id === tabId.value)) tabId.value = BLUEPRINT_TAB
    if (tabId.value === BLUEPRINT_TAB && states.value.length === 0 && list.length > 1) tabId.value = list[1]!.id
  },
  { immediate: true },
)

/** 選んでいる Mod（または「この設計図」） */
const currentTab = computed(() => tabs.value.find((t) => t.id === tabId.value) ?? tabs.value[0]!)

// Mod の欄。入力中は候補を出し、選んだら欄に名前を戻す
const modQuery = ref('')
const modOpen = ref(false)
const modActive = ref(0)

/** Mod の候補。名前か namespace に、空白で区切った言葉がすべて入っているもの */
const modOptions = computed(() => {
  const terms = modQuery.value.toLowerCase().split(/\s+/).filter((t) => t !== '')
  return tabs.value.filter((t) => terms.every((term) => t.label.toLowerCase().includes(term) || t.id.toLowerCase().includes(term)))
})

function openMods(e: FocusEvent): void {
  modOpen.value = true
  modQuery.value = ''
  modActive.value = 0
  // 今の名前を選んだ状態にして、そのまま打ち替えられるようにする
  ;(e.target as HTMLInputElement).select()
}

function chooseMod(id: string): void {
  tabId.value = id
  modOpen.value = false
  modQuery.value = ''
}

function onModInput(e: Event): void {
  modQuery.value = (e.target as HTMLInputElement).value
  modOpen.value = true
  modActive.value = 0
}

function onModKeydown(e: KeyboardEvent): void {
  const count = modOptions.value.length
  if (e.key === 'ArrowDown' && count > 0) {
    e.preventDefault()
    modOpen.value = true
    modActive.value = (modActive.value + 1) % count
  } else if (e.key === 'ArrowUp' && count > 0) {
    e.preventDefault()
    modActive.value = (modActive.value - 1 + count) % count
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = modOptions.value[modActive.value]
    if (hit) chooseMod(hit.id)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    modOpen.value = false
    modQuery.value = ''
  }
}

/** 今の Mod の中身（絞り込んだあと）。"[" を含む入力は ID の入力なので絞り込まない */
const items = computed<ShelfItem[]>(() => {
  const text = input.value.trim()
  return shelfItems(tabId.value, content.pack, states.value, text.includes('[') ? '' : text)
})

// 棚に並べるブロックのアイコンを頼む
watch(items, (list) => void icons.request(list.map((i) => i.state)), { immediate: true })

function itemName(item: ShelfItem): string {
  return item.ja ?? item.en ?? item.id
}

/** マウスを重ねたときの説明。名前と ID。この設計図では状態も */
function itemTitle(item: ShelfItem): string {
  const props = Object.entries(item.state.properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const id = props && tabId.value === BLUEPRINT_TAB ? `${item.id}（${props}）` : item.id
  return [item.ja, item.en, id].filter((v) => v !== null).join('\n')
}

const current = computed(() => {
  const s = brush.state
  if (!s) return null
  return {
    key: s.key,
    name: content.displayName(s.id.toString()),
    id: s.id.toString(),
    color: blockColorCss(s.id.toString()),
    icon: icons.iconOf(s.key) ?? null,
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

// 置くブロックの今の状態のアイコンも頼む（状態を変えたとき）
watch(
  () => brush.state,
  (s) => {
    if (s) void icons.request([s])
  },
  { immediate: true },
)

function use(state: BlockState): void {
  brush.setFromBlock(state)
  inputError.value = null
  // 選んだらすぐ置けるように、置くツールにする
  tools.setTool('place')
}

function onProperty(name: string, e: Event): void {
  const s = brush.state
  if (!s) return
  const value = (e.target as HTMLSelectElement).value
  brush.setFromBlock(new BlockState(s.id, { ...s.properties, [name]: value }))
}

function onInput(): void {
  inputError.value = null
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && input.value !== '') {
    e.preventDefault()
    input.value = ''
    onInput()
  }
}

/** Enter：ID と状態の入力ならそれを使う。絞り込んだ結果が1つだけならそれを使う */
function onSubmit(): void {
  const text = input.value.trim()
  const asId = text.includes('[') || (text.includes(':') && items.value.length === 0) || !content.pack
  if (!asId && items.value.length === 1) {
    use(items.value[0]!.state)
    input.value = ''
    return
  }
  if (!asId && items.value.length > 1) {
    inputError.value = `${items.value.length} 件あります。棚から選ぶか、言葉を足して絞り込みます。`
    return
  }
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
      <img v-if="current.icon" class="icon" :src="current.icon" alt="" />
      <span v-else class="swatch" :style="{ background: current.color }" aria-hidden="true"></span>
      <span class="name">
        {{ current.name ?? current.id }}
        <small v-if="current.name">{{ current.id }}</small>
        <small v-for="[k, v] in current.props" :key="k" class="prop">{{ k }}={{ v }}</small>
      </span>
    </div>
    <p v-else class="note">まだ選んでいません。下の棚から選びます。</p>

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

    <div class="field mod-field">
      <label for="brush-mod">Mod</label>
      <input
        id="brush-mod"
        data-testid="shelf-mod"
        type="text"
        role="combobox"
        spellcheck="false"
        autocomplete="off"
        :value="modOpen ? modQuery : currentTab.label"
        :placeholder="currentTab.label"
        :aria-expanded="modOpen"
        aria-controls="brush-mods"
        :aria-activedescendant="modOpen && modOptions.length > 0 ? `brush-mod-${modActive}` : undefined"
        @focus="openMods"
        @blur="modOpen = false"
        @input="onModInput"
        @keydown="onModKeydown"
      />
      <ul v-if="modOpen" id="brush-mods" class="mods" role="listbox" aria-label="Mod" data-testid="shelf-mods">
        <li
          v-for="(t, i) in modOptions"
          :id="`brush-mod-${i}`"
          :key="t.id"
          role="option"
          :aria-selected="i === modActive"
          :class="{ active: i === modActive, current: t.id === tabId }"
          :data-tab="t.id"
          @mousedown.prevent
          @mouseenter="modActive = i"
          @click="chooseMod(t.id)"
        >
          {{ t.label }}
          <small v-if="t.id.startsWith('ns:') && t.id.slice(3) !== t.label">{{ t.id.slice(3) }}</small>
        </li>
        <li v-if="modOptions.length === 0" class="empty">「{{ modQuery.trim() }}」に合う Mod はありません</li>
      </ul>
    </div>

    <form class="field" @submit.prevent="onSubmit">
      <label for="brush-id">{{ content.pack ? 'ブロック（絞り込む、または ID を入力）' : 'ID を入力' }}</label>
      <div class="row">
        <input
          id="brush-id"
          v-model="input"
          data-testid="brush-input"
          type="text"
          :list="content.pack ? undefined : 'brush-id-list'"
          :placeholder="content.pack ? 'シャフト、create:shaft[axis=y]' : 'create:shaft[axis=y]'"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="inputError !== null"
          @input="onInput"
          @keydown="onKeydown"
        />
        <button type="submit">使う</button>
      </div>
      <datalist v-if="!content.pack" id="brush-id-list">
        <option v-for="s in states" :key="s.key" :value="s.key"></option>
      </datalist>
      <p v-if="inputError" class="error" role="alert">{{ inputError }}</p>
    </form>

    <div class="shelf" role="listbox" :aria-label="currentTab.label" data-testid="shelf">
      <button
        v-for="item in items"
        :key="item.state.key"
        type="button"
        role="option"
        class="cell"
        :class="{ on: item.state.key === brush.state?.key }"
        :aria-selected="item.state.key === brush.state?.key"
        :aria-label="itemName(item)"
        :title="itemTitle(item)"
        :data-key="item.state.key"
        @click="use(item.state)"
      >
        <img v-if="icons.iconOf(item.state.key)" :src="icons.iconOf(item.state.key)!" alt="" />
        <span v-else class="fallback" :style="{ background: blockColorCss(item.id) }">{{ blockAbbreviation(item.id) }}</span>
      </button>
    </div>
    <p class="note" data-testid="shelf-summary">
      <template v-if="items.length === 0 && input.trim() !== ''">
        「{{ input.trim() }}」に合うブロックは「{{ currentTab.label }}」にありません。ID なら Enter で使います。
      </template>
      <template v-else-if="items.length === 0">「{{ currentTab.label }}」にブロックはありません。</template>
      <template v-else>{{ items.length }} 件。クリックで選びます。</template>
    </p>
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

.icon {
  flex: none;
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
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

.mod-field {
  position: relative;
}

.mods {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 240px;
  margin: 2px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: Canvas;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
}

.mods li {
  padding: 4px 6px;
  font-size: 12px;
  cursor: pointer;
}

.mods li small {
  margin-left: 6px;
  font-size: 10px;
  opacity: 0.65;
}

.mods li.current {
  font-weight: 600;
}

.mods li.active {
  background: color-mix(in srgb, Highlight 22%, transparent);
}

.mods li.empty {
  cursor: default;
  opacity: 0.75;
}

.shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 3px;
  max-height: 320px;
  overflow-y: auto;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: Canvas;
}

.cell {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 1px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  cursor: pointer;
}

.cell:hover {
  border-color: var(--line);
}

.cell.on {
  border-color: Highlight;
  background: color-mix(in srgb, Highlight 22%, transparent);
}

.cell img {
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
}

.fallback {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 3px;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-shadow: 0 0 2px #000;
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

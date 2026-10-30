<script setup lang="ts">
// 範囲のツールバー（#160）。docs/ui.md「範囲のツールバー」。
// 2つ以上のブロックが入る範囲を選んでいるとき、選んだ範囲の近くに浮かべる。2D表示と3D表示の両方がこの部品を置く。
// 範囲の操作（消す・塗る・置き換え・回す・反転・コピー・切り取り・複製・貼り付け・全体を選ぶ）のボタンと、置き換えのフォームを持つ。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isSingleCell } from '../../domain/box'
import { useDocumentSession } from '../document/documentSession'
import { useClipboardActions } from '../edit/clipboardActions'
import { useRegionActions } from '../edit/regionActions'
import { useBrushStore } from '../stores/brushStore'
import { usePasteStore } from '../stores/pasteStore'
import { useToolStore } from '../stores/toolStore'
import { selectionStats } from './selectionModel'
import { toolbarPosition, type ScreenRect } from './toolbarPosition'

const props = defineProps<{
  /** 選んだ範囲が表示部分の中で占める長方形。範囲が見えなければ null */
  rect: ScreenRect | null
  /** 表示部分の大きさ（CSS ピクセル） */
  viewWidth: number
  viewHeight: number
}>()

const session = useDocumentSession()
const tools = useToolStore()
const brush = useBrushStore()
const paste = usePasteStore()
const actions = useRegionActions()
const clipboard = useClipboardActions()

const onlyEmpty = ref(true)
const keepOrientation = ref(true)
/** 置き換えのフォームを開いている */
const replaceOpen = ref(false)
/** 「置き換える物」に選んだ状態の key。範囲の中になければ一番多い状態を使う */
const fromKey = ref<string | null>(null)

const box = computed(() => tools.selectionBox)
/** 2つ以上のマスの範囲を選んでいて、貼り付けの見本を出していないときに出す */
const shown = computed(() => box.value !== null && !isSingleCell(box.value) && !paste.active && props.rect !== null)

const stats = computed(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  const b = box.value
  return bp && b && shown.value ? selectionStats(bp, b) : null
})

const fromState = computed(() => {
  const states = stats.value?.states ?? []
  return states.find((s) => s.state.key === fromKey.value)?.state ?? states[0]?.state ?? null
})

// 範囲を選び直したら、置き換えのフォームは閉じる
watch(box, (next, prev) => {
  if (!next || !prev || next.min.join() !== prev.min.join() || next.max.join() !== prev.max.join()) replaceOpen.value = false
})

/** ツールバー自身の大きさ。位置を決めるのに使う */
const root = ref<HTMLElement | null>(null)
const ownWidth = ref(0)
const ownHeight = ref(0)
let observer: ResizeObserver | null = null

function measure(): void {
  ownWidth.value = root.value?.offsetWidth ?? 0
  ownHeight.value = root.value?.offsetHeight ?? 0
}

watch(root, (el) => {
  observer?.disconnect()
  if (el && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(el)
  }
  measure()
})

onMounted(measure)
onBeforeUnmount(() => observer?.disconnect())

const style = computed(() => {
  const r = props.rect
  if (!r) return {}
  const { left, top } = toolbarPosition(r, ownWidth.value, ownHeight.value, props.viewWidth, props.viewHeight)
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
})

function onFrom(event: Event): void {
  fromKey.value = (event.target as HTMLSelectElement).value
}

function replace(): void {
  const from = fromState.value
  if (from && actions.replace(from, keepOrientation.value)) replaceOpen.value = false
}
</script>

<template>
  <div
    v-if="shown"
    ref="root"
    class="selection-toolbar"
    role="toolbar"
    aria-label="範囲の操作"
    data-testid="selection-toolbar"
    :style="style"
    @pointerdown.stop
    @click.stop
    @wheel.stop
  >
    <div class="row">
      <span class="count" data-selection="count" title="範囲の中のブロックの数">{{ stats?.blockCount ?? 0 }} 個</span>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-action="erase" title="範囲の中を消す（Delete）" @click="actions.erase()">消す</button>
      <button type="button" data-action="fill" title="範囲を置くブロックで塗る（F）" @click="actions.fill(onlyEmpty)">塗る</button>
      <label class="check" title="空いているマスだけを塗る">
        <input v-model="onlyEmpty" type="checkbox" data-option="only-empty" />
        空きだけ
      </label>
      <button
        type="button"
        data-action="replace-open"
        :aria-expanded="replaceOpen"
        title="ある状態を置くブロックに変える"
        @click="replaceOpen = !replaceOpen"
      >
        置き換え…
      </button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-action="rotate-right" title="上から見て右回りに 90°（R。Ctrl+R で上書き）" @click="actions.rotate(1, false)">
        右に回す
      </button>
      <button type="button" data-action="rotate-left" title="上から見て左回りに 90°（Shift+R）" @click="actions.rotate(3, false)">左に回す</button>
      <button type="button" data-action="mirror-x" title="x の向きを逆にする（東と西を入れ替える）" @click="actions.mirror('x')">x 軸で反転</button>
      <button type="button" data-action="mirror-z" title="z の向きを逆にする（北と南を入れ替える）" @click="actions.mirror('z')">z 軸で反転</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-action="copy" title="Ctrl+C" @click="clipboard.copy()">コピー</button>
      <button type="button" data-action="cut" title="Ctrl+X" @click="clipboard.cut()">切り取り</button>
      <button type="button" data-action="duplicate" title="Ctrl+D" @click="clipboard.duplicate()">複製</button>
      <button
        type="button"
        data-action="paste"
        :disabled="!paste.clip"
        :title="paste.clip ? 'Ctrl+V' : 'コピーか切り取りをすると貼り付けられます（Ctrl+V）'"
        @click="clipboard.paste()"
      >
        貼り付け
      </button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-action="select-all" title="設計図全体を選ぶ（Ctrl+A）" @click="actions.selectAll()">全体を選ぶ</button>
    </div>

    <fieldset v-if="replaceOpen" class="replace" data-testid="replace-form">
      <legend>置き換え</legend>
      <label class="field">
        置き換える物
        <select data-option="replace-from" :value="fromState?.key ?? ''" :disabled="!fromState" @change="onFrom">
          <option v-for="s in stats?.states ?? []" :key="s.state.key" :value="s.state.key">{{ s.state.key }}（{{ s.count }}）</option>
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
  </div>
</template>

<style scoped>
.selection-toolbar {
  position: absolute;
  z-index: 3;
  display: grid;
  gap: 6px;
  /* 幅を置いた位置によらず決める（位置を決めると幅が変わり、また位置を決め直す、を繰り返さない） */
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100% - 16px);
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
  font-size: 12px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.count {
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  white-space: nowrap;
}

.sep {
  align-self: stretch;
  width: 1px;
  margin: 2px 2px;
  background: var(--line);
}

button {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.5;
}

button[aria-expanded='true'] {
  background: color-mix(in srgb, CanvasText 10%, transparent);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
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

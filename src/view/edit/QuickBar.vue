<script setup lang="ts">
// 表示部分の下の中央に浮かぶクイックバー（docs/ui.md「クイックバー」。#197）。
// 左に最近のブロック（クリックか 1〜9 で選ぶ。右クリックで固定）、右に操作のボタン、右端の「…」で操作の出し入れと並べ替え。
import { computed, inject, ref, watch } from 'vue'
import { useBlockIconStore } from '../stores/blockIconStore'
import { useBrushStore } from '../stores/brushStore'
import { useModpackContentStore } from '../stores/modpackContent'
import { useQuickBarStore } from '../stores/quickBarStore'
import { blockColorCss } from '../viewport/blockColor'
import { blockAbbreviation } from '../viewport/layerGrid2D'
import { QUICK_ACTION_RUNNER } from './quickActions'
import { basicBlocks } from './placementRules'
import { QUICK_ACTIONS, type QuickActionId, type QuickActionInfo, type QuickSlot } from './quickBarModel'

const bar = useQuickBarStore()
const brush = useBrushStore()
const content = useModpackContentStore()
const icons = useBlockIconStore()
const runner = inject(QUICK_ACTION_RUNNER, null)

const menuOpen = ref(false)
/** Modpack がないときの名前。基本の部品はアプリで書いた短い名前（#162） */
const basicNames = new Map(basicBlocks().map((b) => [b.state.id.toString(), b.name]))

// マスのアイコンを頼む
watch(
  () => bar.slots,
  (slots) => void icons.request(slots.map((s) => s.state)),
  { immediate: true },
)

const shown = computed<QuickActionInfo[]>(() =>
  bar.actions.flatMap((id) => QUICK_ACTIONS.filter((a) => a.id === id)),
)

function isCurrent(slot: QuickSlot): boolean {
  return brush.state?.id.toString() === slot.state.id.toString()
}

function nameOf(slot: QuickSlot): string | null {
  const id = slot.state.id.toString()
  return content.displayName(id) ?? basicNames.get(id) ?? null
}

function slotName(slot: QuickSlot): string {
  return nameOf(slot) ?? slot.state.id.toString()
}

function slotTitle(slot: QuickSlot, index: number): string {
  const id = slot.state.id.toString()
  const props = Object.entries(slot.state.properties)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  return [
    nameOf(slot),
    props ? `${id}（${props}）` : id,
    `${index + 1} キーで選ぶ。右クリックで${slot.pinned ? '固定を外す' : '固定する'}`,
  ]
    .filter((v) => v !== null)
    .join('\n')
}

function enabled(id: QuickActionId): boolean {
  return runner?.enabled(id) ?? false
}

function position(id: QuickActionId): number {
  return bar.actions.indexOf(id)
}
</script>

<template>
  <div class="quick-bar" role="toolbar" aria-label="クイックバー" data-testid="quick-bar">
    <div class="slots" role="group" aria-label="最近のブロック">
      <button
        v-for="(slot, i) in bar.slots"
        :key="slot.state.id.toString()"
        type="button"
        class="slot"
        :class="{ on: isCurrent(slot), pinned: slot.pinned }"
        :aria-pressed="isCurrent(slot)"
        :aria-label="`${i + 1}：${slotName(slot)}${slot.pinned ? '（固定）' : ''}`"
        :title="slotTitle(slot, i)"
        :data-slot="i"
        :data-key="slot.state.key"
        @click="bar.choose(i)"
        @contextmenu.prevent="bar.pin(i)"
      >
        <img v-if="icons.iconOf(slot.state.key)" :src="icons.iconOf(slot.state.key)!" alt="" />
        <span v-else class="fallback" :style="{ background: blockColorCss(slot.state.id.toString()) }">
          {{ blockAbbreviation(slot.state.id.toString()) }}
        </span>
        <span class="number" aria-hidden="true">{{ i + 1 }}</span>
        <span v-if="slot.pinned" class="pin" aria-hidden="true">●</span>
      </button>
      <span v-if="bar.slots.length === 0" class="empty">棚から選んだブロックがここに並びます</span>
    </div>
    <div v-if="shown.length > 0" class="actions" role="group" aria-label="操作">
      <button
        v-for="a in shown"
        :key="a.id"
        type="button"
        :data-action="`quick-${a.id}`"
        :title="a.title"
        :disabled="!enabled(a.id)"
        @click="runner?.run(a.id)"
      >
        {{ a.label }}
      </button>
    </div>
    <div class="menu-wrap">
      <button
        type="button"
        class="menu-button"
        data-action="quick-menu"
        title="バーに出す操作を選ぶ・並べ替える"
        aria-label="バーに出す操作を選ぶ"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        …
      </button>
      <div v-if="menuOpen" class="menu" role="dialog" aria-label="バーに出す操作" data-testid="quick-menu">
        <p class="menu-title">バーに出す操作</p>
        <ul>
          <li v-for="a in QUICK_ACTIONS" :key="a.id">
            <label>
              <input type="checkbox" :data-toggle="a.id" :checked="position(a.id) >= 0" @change="bar.toggle(a.id)" />
              {{ a.label }}
            </label>
            <button
              type="button"
              :data-move-up="a.id"
              :aria-label="`${a.label}を前へ`"
              title="前へ"
              :disabled="position(a.id) <= 0"
              @click="bar.move(a.id, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              :data-move-down="a.id"
              :aria-label="`${a.label}を後ろへ`"
              title="後ろへ"
              :disabled="position(a.id) < 0 || position(a.id) === bar.actions.length - 1"
              @click="bar.move(a.id, 1)"
            >
              ↓
            </button>
          </li>
        </ul>
        <div class="menu-footer">
          <button type="button" data-action="quick-reset" @click="bar.resetActions()">初期に戻す</button>
          <button type="button" @click="menuOpen = false">閉じる</button>
        </div>
        <p class="menu-note">ブロックのマスは、右クリックで固定・固定の解除。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 4px 8px;
  max-width: 100%;
  padding: 4px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 88%, transparent);
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
}

.slots,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.actions button {
  white-space: nowrap;
}

.actions {
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
}

.slot {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.slot:hover {
  border-color: var(--line);
}

.slot.on {
  border-color: Highlight;
  background: color-mix(in srgb, Highlight 22%, transparent);
}

.slot img {
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
  text-shadow: 0 0 2px rgb(0 0 0 / 70%);
}

.number {
  position: absolute;
  left: 2px;
  bottom: 0;
  font-size: 9px;
  opacity: 0.75;
}

.pin {
  position: absolute;
  right: 2px;
  top: 0;
  font-size: 8px;
  color: Highlight;
}

.empty {
  padding: 0 6px;
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
}

.menu-wrap {
  position: relative;
}

.menu-button {
  min-width: 28px;
}

.menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 4;
  min-width: 200px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: Canvas;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
  font-size: 12px;
}

.menu-title {
  margin: 0 0 4px;
  font-weight: 600;
}

.menu ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.menu li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}

.menu li label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.menu-footer {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 6px;
}

.menu-note {
  margin: 6px 0 0;
  opacity: 0.7;
}
</style>

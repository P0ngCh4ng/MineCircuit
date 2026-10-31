<script setup lang="ts">
// 「大きさを変える…」ボタン。6方向に足すマス数を入れて、設計図を広げる・縮める。余白を詰める（#191）。
// 画面の操作は docs/ui.md「設計図の大きさ」。操作は edit/blueprintResize.ts が作り、編集の履歴に通す
import { computed, ref } from 'vue'
import { resizeRegion, trimRegions } from '../../edit/blueprintResize'
import { MAX_BLUEPRINT_SIDE } from '../../edit/regionTransform'
import type { Vec3 } from '../../domain/vec3'
import ModalDialog from '../shell/ModalDialog.vue'
import { useBrushStore } from '../stores/brushStore'
import { useDocumentSession } from './documentSession'

const session = useDocumentSession()
const brush = useBrushStore()

const open = ref(false)
const regionIndex = ref(0)
/** 負の向き（x−・y−・z−）と正の向き（x+・y+・z+）に足すマス数 */
const minGrow = ref<[number, number, number]>([0, 0, 0])
const maxGrow = ref<[number, number, number]>([0, 0, 0])

const AXES = ['x', 'y', 'z'] as const

const blueprint = computed(() => session.current.value?.blueprint ?? null)
const regions = computed(() => blueprint.value?.regions ?? [])

/** 入力欄の値を整数にそろえる（空や小数は 0・切り捨て） */
function whole(v: Vec3): Vec3 {
  return v.map((n) => (Number.isFinite(n) ? Math.trunc(n) : 0)) as unknown as Vec3
}

/** 今の入力で作る操作。変わらなければ null、作れなければ理由の文 */
const plan = computed(() => {
  // 設計図の変更（version）で作り直す
  void session.version.value
  const bp = blueprint.value
  if (!bp) return null
  return resizeRegion(bp, regionIndex.value, { min: whole(minGrow.value), max: whole(maxGrow.value) })
})

const region = computed(() => regions.value[regionIndex.value] ?? null)
const nextSize = computed(() => {
  const r = region.value
  if (!r) return null
  const min = whole(minGrow.value)
  const max = whole(maxGrow.value)
  return r.size.map((n, a) => n + min[a]! + max[a]!)
})
const error = computed(() => (typeof plan.value === 'string' ? plan.value : null))
const removed = computed(() => (plan.value && typeof plan.value !== 'string' ? plan.value : null))

const applyLabel = computed(() => {
  const p = removed.value
  return p && p.removedBlocks > 0 ? `ブロックを ${p.removedBlocks} 個消して変える` : '変える'
})

/** 余白を詰める操作。詰める所がなければ null */
const trimPlan = computed(() => {
  void session.version.value
  const bp = blueprint.value
  return bp ? trimRegions(bp) : null
})

function show(): void {
  regionIndex.value = 0
  minGrow.value = [0, 0, 0]
  maxGrow.value = [0, 0, 0]
  open.value = true
}

function finish(warnings: readonly string[]): void {
  open.value = false
  brush.setMessage(warnings.length > 0 ? warnings.join('。') : null)
}

function apply(): void {
  const p = plan.value
  if (!p || typeof p === 'string') return
  if (session.apply(p.command)) finish(p.warnings)
}

function trim(): void {
  const p = trimPlan.value
  if (p && session.apply(p.command)) finish(p.warnings)
}
</script>

<template>
  <button
    type="button"
    class="resize"
    data-action="resize-blueprint"
    title="設計図の枠を広げる・縮める・余白を詰める"
    :disabled="!blueprint"
    @click="show"
  >
    大きさを変える…
  </button>
  <ModalDialog v-if="open && blueprint" title="設計図の大きさを変える" @close="open = false">
    <form id="resize-blueprint-form" class="form" @submit.prevent="apply">
      <label v-if="regions.length > 1" class="field">
        <span>リージョン</span>
        <select v-model.number="regionIndex" name="region">
          <option v-for="(r, i) in regions" :key="i" :value="i">{{ r.name }}（{{ r.size.join(' × ') }}）</option>
        </select>
      </label>
      <fieldset class="grow">
        <legend>足すマス数（マイナスで縮める）</legend>
        <template v-for="(axis, a) in AXES" :key="axis">
          <label>{{ axis }}− <input v-model.number="minGrow[a]" type="number" :name="`${axis}-min`" step="1" /></label>
          <label>{{ axis }}+ <input v-model.number="maxGrow[a]" type="number" :name="`${axis}-max`" step="1" /></label>
        </template>
      </fieldset>
      <p class="size" data-role="next-size">
        {{ region?.size.join(' × ') }} → {{ nextSize?.join(' × ') }}（各辺 1〜{{ MAX_BLUEPRINT_SIDE }}）
      </p>
      <p v-if="error" class="errors" role="alert">{{ error }}</p>
      <p v-else-if="removed && removed.removedBlocks + removed.removedEntities > 0" class="warning" data-role="removed">
        縮めた所にあるブロック {{ removed.removedBlocks }} 個<template v-if="removed.removedEntities > 0">とエンティティ {{ removed.removedEntities }} 個</template>が消えます。元に戻すと戻ります。
      </p>
    </form>
    <template #actions>
      <button type="button" @click="open = false">やめる</button>
      <button
        type="button"
        data-action="trim-blueprint"
        title="ブロックとエンティティのない端を取り除く"
        :disabled="!trimPlan"
        @click="trim"
      >
        余白を詰める
      </button>
      <button type="submit" form="resize-blueprint-form" data-action="apply-resize" :disabled="!removed">{{ applyLabel }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.resize {
  font-size: 12px;
  padding: 0 6px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.grow {
  display: grid;
  grid-template-columns: auto auto;
  gap: 6px 16px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}

.grow input {
  width: 5em;
}

.size {
  margin: 0;
}

.warning,
.errors {
  margin: 0;
  color: #c0392b;
}
</style>

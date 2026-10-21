<script setup lang="ts">
// 選択中のブロックの「計算に使う設定」（#72）。クリエイティブモーターの回転数など。
// どの項目を変えられるかは calc の blockSettingsFor が決める。この部品は表示と入力の確認だけを行い、
// 変更は編集の操作（setBlockEntityTag）として生データに書く（元に戻せる）。
import { computed, reactive, watch } from 'vue'
import { blockSettingsFor, parseSettingInput, settingTag, settingValue, type BlockSettingField } from '../../calc/blockSettings'
import { PROVENANCE_LABELS } from '../../calc/provenance'
import { setBlockEntityTag } from '../../edit/editCommand'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'

const props = defineProps<{ pos: Vec3 }>()

const session = useDocumentSession()

const settings = computed(() => {
  void session.version.value
  const bp = session.current.value?.blueprint
  const state = bp?.get(props.pos) ?? null
  if (!bp || !state) return null
  const desc = blockSettingsFor(state)
  if (!desc) return null
  const blockEntity = bp.blockEntityAt(props.pos)
  return {
    desc,
    name: state.id.path,
    fields: desc.fields.map((field) => ({ field, current: settingValue(field, blockEntity) })),
  }
})

// 入力中の文字列とエラー（項目名ごと）。選択や値が変わったら今の値に戻す
const drafts = reactive(new Map<string, string>())
const errors = reactive(new Map<string, string>())

watch(
  settings,
  (s) => {
    drafts.clear()
    errors.clear()
    for (const { field, current } of s?.fields ?? []) drafts.set(field.key, String(current.value))
  },
  { immediate: true },
)

function onInput(field: BlockSettingField, text: string): void {
  drafts.set(field.key, text)
  errors.delete(field.key)
}

function commit(field: BlockSettingField): void {
  const s = settings.value
  if (!s) return
  const parsed = parseSettingInput(field, drafts.get(field.key) ?? '')
  if ('error' in parsed) {
    errors.set(field.key, parsed.error)
    return
  }
  const bp = session.current.value?.blueprint
  if (!bp) return
  const unit = field.unit ? ` ${field.unit}` : ''
  const cmd = setBlockEntityTag(
    bp,
    props.pos,
    field.key,
    settingTag(field, parsed.value),
    s.desc.initialBlockEntity(),
    `${s.name} の${field.label}を ${parsed.value}${unit} にする`,
  )
  // 値が同じなら操作は作らず、表示だけ整える（"+16" → "16"）
  if (!session.apply(cmd)) drafts.set(field.key, String(parsed.value))
}
</script>

<template>
  <div v-if="settings" class="settings" data-testid="block-settings">
    <div class="settings-head">計算に使う設定</div>
    <div v-for="{ field, current } in settings.fields" :key="field.key" class="field">
      <form class="row" @submit.prevent="commit(field)">
        <label :for="`setting-${field.key}`">{{ field.label }}</label>
        <input
          :id="`setting-${field.key}`"
          :data-setting="field.key"
          type="number"
          inputmode="numeric"
          step="1"
          :min="field.min"
          :max="field.max"
          :value="drafts.get(field.key)"
          :aria-invalid="errors.has(field.key)"
          @input="onInput(field, ($event.target as HTMLInputElement).value)"
          @change="commit(field)"
        />
        <span v-if="field.unit" class="unit">{{ field.unit }}</span>
        <span
          class="source"
          :data-source="current.source"
          :title="current.source === 'blueprint' ? '設計図の生データ（nbt）の値' : '生データにないので、内蔵の初期値を使っています'"
          >{{ PROVENANCE_LABELS[current.source] }}</span
        >
      </form>
      <p class="hint">範囲 {{ field.min }}〜{{ field.max }}。{{ field.hint }}</p>
      <p v-if="errors.has(field.key)" class="error" role="alert">{{ errors.get(field.key) }}</p>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  gap: 4px;
}

.settings-head {
  font-size: 12px;
  font-weight: 600;
}

.field {
  display: grid;
  gap: 2px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.row label {
  opacity: 0.75;
}

input {
  width: 6em;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

input[aria-invalid='true'] {
  outline: 1px solid #c62828;
}

.unit {
  opacity: 0.75;
}

.source {
  margin-left: auto;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: 3px;
  font-size: 10px;
  opacity: 0.7;
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.65;
}

.error {
  margin: 0;
  font-size: 11px;
  color: #c62828;
}
</style>

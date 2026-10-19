<script setup lang="ts">
// 「新規」ボタン。大きさ・名前・Minecraft のバージョンを選んで、空の設計図を開く（#20）。
// バージョンは Modpack があれば jar の名前から推定し、なければ利用者に選んでもらう（docs/design.md「BlueprintWriter」）。
import { computed, ref } from 'vue'
import { findMinecraftVersion, MINECRAFT_VERSIONS } from '../../domain/minecraftVersion'
import { createEmptyBlueprint, NEW_BLUEPRINT_MAX_SIDE, validateNewBlueprint } from '../../domain/newBlueprint'
import { guessMinecraftVersion } from '../../io/modpack/minecraftVersionGuess'
import ModalDialog from '../shell/ModalDialog.vue'
import { useModpackContentStore } from '../stores/modpackContent'
import { useDocumentSession } from './documentSession'

const session = useDocumentSession()
const content = useModpackContentStore()

const open = ref(false)
const name = ref('新しい設計図')
const width = ref(16)
const height = ref(8)
const depth = ref(16)
/** 選んだバージョンの名前。選んでいなければ '' */
const versionName = ref('')
/** 作るボタンを押したあとだけ間違いを出す */
const submitted = ref(false)

/** Modpack から推定したバージョン。Modpack がないか、推定できなければ null */
const guessed = computed(() => (content.pack ? guessMinecraftVersion(content.pack.mods) : null))

const versionHint = computed(() => {
  if (guessed.value) return `Modpack の Mod から ${guessed.value.name} と推定しました。違うときは選び直してください。`
  if (content.pack) return 'Modpack の Mod からバージョンを推定できませんでした。ゲームのバージョンを選んでください。'
  return 'Modpack を選んでいないので、ゲームのバージョンを選んでください。'
})

const spec = computed(() => ({
  name: name.value,
  size: [width.value, height.value, depth.value] as const,
  dataVersion: findMinecraftVersion(versionName.value)?.dataVersion ?? 0,
}))
const errors = computed(() => validateNewBlueprint(spec.value))

/** 開いている設計図の編集の回数。0 でなければ、なくなることを知らせる */
const unsavedEdits = computed(() => (session.current.value ? session.editCount.value : 0))

function show(): void {
  versionName.value = guessed.value?.name ?? ''
  submitted.value = false
  open.value = true
}

function create(): void {
  submitted.value = true
  if (errors.value.length > 0) return
  const bp = createEmptyBlueprint(spec.value)
  session.setBlueprint(bp)
  open.value = false
}
</script>

<template>
  <button type="button" data-action="new-blueprint" title="空の設計図を作ります" @click="show">新規…</button>
  <ModalDialog v-if="open" title="新規の設計図" @close="open = false">
    <form id="new-blueprint-form" class="form" @submit.prevent="create">
      <label class="field">
        <span>名前</span>
        <input v-model="name" type="text" name="name" />
      </label>
      <fieldset class="size">
        <legend>大きさ（ブロック、1〜{{ NEW_BLUEPRINT_MAX_SIDE }}）</legend>
        <label>幅 <input v-model.number="width" type="number" name="width" min="1" :max="NEW_BLUEPRINT_MAX_SIDE" /></label>
        <label>高さ <input v-model.number="height" type="number" name="height" min="1" :max="NEW_BLUEPRINT_MAX_SIDE" /></label>
        <label>奥行き <input v-model.number="depth" type="number" name="depth" min="1" :max="NEW_BLUEPRINT_MAX_SIDE" /></label>
      </fieldset>
      <label class="field">
        <span>Minecraft のバージョン</span>
        <select v-model="versionName" name="version">
          <option value="" disabled>選んでください</option>
          <option v-for="v in [...MINECRAFT_VERSIONS].reverse()" :key="v.name" :value="v.name">
            {{ v.name }}（DataVersion {{ v.dataVersion }}）
          </option>
        </select>
        <small class="hint">{{ versionHint }}書き出す .nbt の DataVersion になります。</small>
      </label>
      <p v-if="unsavedEdits > 0" class="warning">
        開いている設計図を閉じます。書き出していない編集（{{ unsavedEdits }} 回）はなくなります。
      </p>
      <ul v-if="submitted && errors.length > 0" class="errors" role="alert">
        <li v-for="e in errors" :key="e">{{ e }}</li>
      </ul>
    </form>
    <template #actions>
      <button type="button" @click="open = false">やめる</button>
      <button type="submit" form="new-blueprint-form" data-action="create-blueprint">作る</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
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

.size {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}

.size input {
  width: 4.5em;
}

.hint {
  opacity: 0.75;
}

.warning,
.errors {
  margin: 0;
  color: #c0392b;
}

.errors {
  padding-left: 1.2em;
}
</style>

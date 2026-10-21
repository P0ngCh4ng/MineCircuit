<script setup lang="ts">
// Modpack のフォルダを登録し、一覧から選ぶ部品。
// ブラウザ版はフォルダのハンドル、デスクトップ版（Tauri）はフォルダのパスで登録する（view/platform/fileAccess.ts）
import { onMounted, ref } from 'vue'
import { pickDirectory, supportsDirectoryPicker, BrowserFileSource } from '../io/browserFileSource'
import { fileSourceFromPickedFiles } from '../io/memoryFileSource'
import { createBrowserModpackRegistry } from '../io/modpack/browserModpackRegistry'
import type { ModpackRegistry } from '../io/modpack/modpackRegistry'
import { loadDesktopModpackFolders, type DesktopModpackFolders } from './platform/fileAccess'
import { isDesktop } from './platform/platform'
import { useModpackStore } from './stores/modpack'

const props = defineProps<{
  /** テストで差し替える。省略するとブラウザ用の登録一覧を使う */
  registry?: ModpackRegistry<FileSystemDirectoryHandle>
  /** テストで差し替える。省略するとブラウザが対応しているかで決める */
  pickerSupported?: boolean
  /** テストで差し替える。省略すると動いている環境で決める */
  desktopFolders?: DesktopModpackFolders
}>()

const store = useModpackStore()
/** デスクトップ版か。デスクトップ版は Tauri のダイアログでフォルダを選び、次回も許可なしで読む */
const desktop = props.desktopFolders !== undefined || (props.registry === undefined && isDesktop())
const canPick = desktop || (props.pickerSupported ?? supportsDirectoryPicker())
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
let desktopLoading: Promise<DesktopModpackFolders> | null = null

function desktopAccess(): Promise<DesktopModpackFolders> {
  desktopLoading ??= props.desktopFolders ? Promise.resolve(props.desktopFolders) : loadDesktopModpackFolders()
  return desktopLoading
}

onMounted(() => {
  if (desktop) {
    void desktopAccess().then((d) => store.init(d.registry))
    return
  }
  void store.init(props.registry ?? createBrowserModpackRegistry())
})

async function registerFolder(): Promise<void> {
  if (desktop) {
    busy.value = true
    try {
      const picked = await (await desktopAccess()).pickFolder()
      if (picked) await store.register(picked.name, picked.source, picked.handle)
    } finally {
      busy.value = false
    }
    return
  }
  if (!canPick) {
    // Firefox / Safari：フォルダ内のファイルをまとめて選ぶ
    fileInput.value?.click()
    return
  }
  busy.value = true
  try {
    const handle = await pickDirectory()
    if (handle) await store.register(handle.name, new BrowserFileSource(handle), handle)
  } finally {
    busy.value = false
  }
}

async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files ? fileSourceFromPickedFiles(input.files) : null
  input.value = ''
  if (!picked) return
  busy.value = true
  try {
    await store.register(picked.name, picked.source, null)
  } finally {
    busy.value = false
  }
}

function onSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void store.select(value === '' ? null : value)
}
</script>

<template>
  <section class="modpack">
    <label class="row">
      <span class="label">Modpack</span>
      <select :value="store.selectedId ?? ''" aria-label="Modpack を選ぶ" @change="onSelect">
        <option value="">使わない</option>
        <option v-for="entry in store.entries" :key="entry.id" :value="entry.id">
          {{ entry.name }}{{ entry.persistent ? '' : '（今回だけ）' }}
        </option>
      </select>
    </label>
    <div class="row">
      <button type="button" :disabled="busy" @click="registerFolder">フォルダを登録</button>
      <button v-if="store.selectedId !== null" type="button" @click="store.remove(store.selectedId)">
        登録を外す
      </button>
      <button v-if="store.status === 'needs-permission'" type="button" @click="store.grantPermission()">
        フォルダを読む許可を出す
      </button>
    </div>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      webkitdirectory
      multiple
      @change="onFilesPicked"
    />
    <p v-if="store.status === 'needs-permission' && desktop" class="note">
      このフォルダを読む許可がありません。「フォルダを読む許可を出す」を押し、同じフォルダを選んでください。
    </p>
    <p v-else-if="store.status === 'needs-permission'" class="note">
      前回の許可が切れています。「フォルダを読む許可を出す」を押してください。
    </p>
    <p v-if="store.message" class="note" role="status">{{ store.message }}</p>
    <p class="note">
      mods フォルダが入っているフォルダを選びます。CurseForge では、Instances の中の Modpack 名のフォルダです。ファイルは外部に送信しません。
    </p>
    <p v-if="desktop" class="note">登録したフォルダは、次回も選び直さずに読みます。</p>
    <p v-else-if="!canPick" class="note">
      このブラウザ（Firefox / Safari など）では、登録したフォルダは次回開いたときに選び直しになります。Chrome / Edge では次回も同じフォルダを読みます。
    </p>
  </section>
</template>

<style scoped>
.modpack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 480px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.label {
  font-size: 12px;
  font-weight: bold;
}

.note {
  margin: 0;
  font-size: 12px;
  opacity: 0.8;
}

.hidden {
  display: none;
}
</style>

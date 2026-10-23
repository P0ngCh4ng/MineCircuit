<script setup lang="ts">
// Minecraft 本体の jar を見つけたかを出し、見つからなければ本体のフォルダ（ランチャーのフォルダ）を選んでもらう部品。
// 選んだフォルダは Modpack の登録と同じく保存し、すべての Modpack で使う（docs/design.md「Minecraft 本体の資産」）。
import { computed, onMounted, ref } from 'vue'
import { BrowserFileSource, pickDirectory, supportsDirectoryPicker } from '../io/browserFileSource'
import { fileSourceFromPickedFiles } from '../io/memoryFileSource'
import { createBrowserGameFolderRegistry } from '../io/modpack/browserModpackRegistry'
import type { GameFolderRegistry } from '../io/modpack/gameFolderRegistry'
import { loadDesktopGameFolders, type DesktopGameFolders } from './platform/fileAccess'
import { isDesktop } from './platform/platform'
import { useGameFolderStore } from './stores/gameFolders'
import { useModpackContentStore } from './stores/modpackContent'

const props = defineProps<{
  /** テストで差し替える。省略するとブラウザ用の一覧を使う */
  registry?: GameFolderRegistry<FileSystemDirectoryHandle>
  /** テストで差し替える。省略するとブラウザが対応しているかで決める */
  pickerSupported?: boolean
  /** テストで差し替える。省略すると動いている環境で決める */
  desktopFolders?: DesktopGameFolders
}>()

const store = useGameFolderStore()
const content = useModpackContentStore()
const desktop = props.desktopFolders !== undefined || (props.registry === undefined && isDesktop())
const canPick = desktop || (props.pickerSupported ?? supportsDirectoryPicker())
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
let desktopLoading: Promise<DesktopGameFolders> | null = null

function desktopAccess(): Promise<DesktopGameFolders> {
  desktopLoading ??= props.desktopFolders ? Promise.resolve(props.desktopFolders) : loadDesktopGameFolders()
  return desktopLoading
}

onMounted(() => {
  if (desktop) {
    void desktopAccess().then((d) => store.init(d.registry))
    return
  }
  void store.init(props.registry ?? createBrowserGameFolderRegistry())
})

const vanilla = computed(() => content.pack?.vanilla ?? null)
const needsPermission = computed(() => store.folders.some((f) => f.status === 'needs-permission'))

async function pickFolder(): Promise<void> {
  if (desktop) {
    busy.value = true
    try {
      const picked = await (await desktopAccess()).pickFolder()
      if (picked) await store.add(picked.name, picked.source, picked.handle)
    } finally {
      busy.value = false
    }
    return
  }
  if (!canPick) {
    fileInput.value?.click()
    return
  }
  busy.value = true
  try {
    const handle = await pickDirectory('minecircuit-game-folder')
    if (handle) await store.add(handle.name, new BrowserFileSource(handle), handle)
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
    await store.add(picked.name, picked.source, null)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section v-if="content.pack" class="vanilla" aria-label="Minecraft 本体">
    <p v-if="vanilla?.kind === 'found'" class="note" role="status">
      Minecraft 本体（{{ vanilla.version }}）の jar を読みました（{{ vanilla.where }}）。
      <template v-if="!vanilla.jaJp">
        日本語の名前は見つからなかったので、英語で出します。assets フォルダのあるランチャーのフォルダを選ぶと、日本語で出します。
      </template>
    </p>
    <p v-else-if="vanilla?.kind === 'missing'" class="note" role="status">
      Minecraft 本体<template v-if="vanilla.version">（{{ vanilla.version }}）</template>の jar が見つかりません。本体のブロックは色付きの箱で描き、名前は出ません。
    </p>
    <div class="row">
      <button type="button" :disabled="busy" @click="pickFolder">Minecraft 本体のフォルダを選ぶ</button>
      <button v-if="needsPermission" type="button" @click="store.grantPermission()">
        本体のフォルダを読む許可を出す
      </button>
    </div>
    <input ref="fileInput" class="hidden" type="file" webkitdirectory multiple @change="onFilesPicked" />
    <ul v-if="store.folders.length > 0" class="folders">
      <li v-for="f in store.folders" :key="f.id">
        {{ f.name }}{{ f.persistent ? '' : '（今回だけ）' }}
        <template v-if="f.status === 'needs-permission'">（許可が必要）</template>
        <template v-else-if="f.status === 'error'">（読めません）</template>
        <button type="button" @click="store.remove(f.id)">外す</button>
      </li>
    </ul>
    <p v-if="store.message" class="note" role="alert">{{ store.message }}</p>
    <p v-if="vanilla?.kind !== 'found'" class="note">
      ランチャーのフォルダを選びます。CurseForge は minecraft の中の Install、Prism Launcher・MultiMC はランチャーのフォルダ、Modrinth App は ModrinthApp の中の meta、公式ランチャーは .minecraft です。本体の jar はアプリに入っていません。この PC の中のものを読むだけで、外部に送信しません。
    </p>
  </section>
</template>

<style scoped>
.vanilla {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 480px;
}

.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.note {
  margin: 0;
  font-size: 12px;
  opacity: 0.8;
}

.folders {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
}

.folders button {
  margin-left: 6px;
}

.hidden {
  display: none;
}
</style>

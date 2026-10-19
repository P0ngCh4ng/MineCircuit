import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * 要素へのファイルのドラッグ&ドロップを受け取る。
 * 返す関数を要素の dragenter / dragover / dragleave / drop に付ける。dragging はファイルが上にある間 true。
 * 要素の外に落としたときに、ブラウザがファイルを開いて画面を離れないよう、window でも既定の動きを止める。
 */
export function useFileDrop(onFile: (file: File) => void): {
  dragging: Ref<boolean>
  onDragEnter: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
} {
  const dragging = ref(false)
  // 子の要素に出入りするたびに dragenter / dragleave が来るので、深さを数える
  let depth = 0

  function onDragEnter(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth++
    dragging.value = true
  }

  function onDragOver(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(e: DragEvent): void {
    if (!hasFiles(e)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) dragging.value = false
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    depth = 0
    dragging.value = false
    // 複数落とされたときは最初の1つだけを開く
    const file = e.dataTransfer?.files?.[0]
    if (file) onFile(file)
  }

  const blockWindowDrop = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }
  onMounted(() => {
    window.addEventListener('dragover', blockWindowDrop)
    window.addEventListener('drop', blockWindowDrop)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('dragover', blockWindowDrop)
    window.removeEventListener('drop', blockWindowDrop)
  })

  return { dragging, onDragEnter, onDragOver, onDragLeave, onDrop }
}

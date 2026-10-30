import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { carriesFiles, transferFiles } from '~/utils/transferFiles'

/** A drop zone for files dragged in from the computer. `dragging` drives the visible drop hint; the
 *  enter/leave counter keeps it steady while the pointer crosses child elements. */
export function useFileDrop(target: Ref<HTMLElement | null>, onFiles: (files: File[]) => void, enabled: () => boolean = () => true) {
  const dragging = ref(false)
  let depth = 0

  function onEnter(event: DragEvent) {
    if (!enabled() || !carriesFiles(event.dataTransfer)) return
    event.preventDefault()
    depth += 1
    dragging.value = true
  }
  function onOver(event: DragEvent) {
    if (!enabled() || !carriesFiles(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  function onLeave() {
    depth = Math.max(0, depth - 1)
    if (!depth) dragging.value = false
  }
  function onDrop(event: DragEvent) {
    depth = 0
    dragging.value = false
    // A nested zone (such as the comment editor) that already took the files marks the event handled.
    if (event.defaultPrevented || !enabled() || !carriesFiles(event.dataTransfer)) return
    event.preventDefault()
    const files = transferFiles(event.dataTransfer)
    if (files.length) onFiles(files)
  }

  useEventListener(target, 'dragenter', onEnter)
  useEventListener(target, 'dragover', onOver)
  useEventListener(target, 'dragleave', onLeave)
  useEventListener(target, 'drop', onDrop)
  return { dragging }
}

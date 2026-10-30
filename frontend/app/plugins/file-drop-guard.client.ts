import { carriesFiles } from '~/utils/transferFiles'

// A file dropped outside every drop zone must not make the browser leave Masar to open the file.
export default defineNuxtPlugin(() => {
  const guard = (event: DragEvent) => {
    if (carriesFiles(event.dataTransfer)) event.preventDefault()
  }
  window.addEventListener('dragover', guard)
  window.addEventListener('drop', guard)
})

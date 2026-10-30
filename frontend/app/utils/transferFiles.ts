// Files from drag-and-drop and clipboard events. Browsers differ: some expose pasted screenshots only
// through DataTransfer.items (getAsFile), others only through DataTransfer.files, so both are read.

/** Whether a drag carries files from outside the page (not, for example, a dragged task row). */
export function carriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return !!transfer && [...transfer.types].includes('Files')
}

/** The files of a drop or paste, without duplicates. */
export function transferFiles(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return []
  const fromItems = [...(transfer.items ?? [])]
    .filter(item => item.kind === 'file')
    .flatMap(item => item.getAsFile() ?? [])
  return fromItems.length ? fromItems : [...(transfer.files ?? [])]
}

/** Pasted screenshots often arrive as "image.png" or without a name: give them a readable, unique one. */
export function nameUploadedFile(file: File, now = new Date()): File {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name)
  if (!generic) return file
  const extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return new File([file], `pasted-image-${stamp}.${extension}`, { type: file.type })
}

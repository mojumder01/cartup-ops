// Remembers the last CartUp upload template picked on any page — in this
// browser only (IndexedDB) — so it doesn't have to be chosen every time. If
// storage is unavailable (private window, blocked site data) nothing is
// remembered and the pages simply ask for the file.
const DB_NAME = 'cartup-ops', STORE = 'files', KEY = 'upload-template'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(req?.result) }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

export async function saveTemplate(file) {
  try {
    const data = await file.arrayBuffer()
    await withStore('readwrite', s => s.put({ name: file.name, data, savedAt: Date.now() }, KEY))
  } catch { /* storage unavailable — nothing remembered */ }
}

// → { file, savedAt } or null
export async function loadSavedTemplate() {
  try {
    const rec = await withStore('readonly', s => s.get(KEY))
    if (!rec?.data) return null
    return { file: new File([rec.data], rec.name, { type: XLSX_TYPE }), savedAt: rec.savedAt }
  } catch { return null }
}

export const savedLabel = saved => `${saved.file.name} · saved ${new Date(saved.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`

const STORAGE_KEY = 'cartup_word_replacements'

export const DEFAULT_REPLACEMENTS = [
  { find: 'daraz', replace: 'cartup' },
]

export function getReplacements() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return DEFAULT_REPLACEMENTS
}

export function saveReplacements(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function applyReplacements(text) {
  if (!text) return text
  const list = getReplacements()
  let result = text
  for (const { find, replace } of list) {
    if (!find) continue
    // Case-insensitive replace, preserve case of surrounding text
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'gi'), replace)
  }
  return result
}

import { teamValue } from './teamSettings'

const STORAGE_KEY = 'cartup_word_replacements'

export const DEFAULT_REPLACEMENTS = [
  { find: 'daraz', replace: 'cartup' },
]

// The team's list (Settings → Rules & defaults) once saved; until then the
// one kept in this browser, else the default.
export function getReplacements() {
  const team = teamValue('rules')?.wordReplacements
  if (Array.isArray(team)) return team
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return DEFAULT_REPLACEMENTS
}

export function saveReplacements(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// Replaces in the text only — never inside HTML tags or web links (an image
// at static-01.daraz.com.bd must keep working) — and keeps the found word's
// capitals: "Daraz" → "Cartup", "DARAZ" → "CARTUP".
const SKIP = /(<[^>]*>|https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i
function matchCase(found, replace) {
  if (!/[a-z]/i.test(found) || !replace) return replace
  if (found === found.toUpperCase() && found !== found.toLowerCase()) return replace.toUpperCase()
  if (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()) return replace.charAt(0).toUpperCase() + replace.slice(1)
  return replace
}
export function applyReplacements(text) {
  if (!text) return text
  const list = getReplacements().filter(r => r.find)
  if (!list.length) return text
  return String(text).split(new RegExp(SKIP.source, 'gi')).map((part, i) => {
    if (i % 2 === 1) return part   // a tag or a link
    for (const { find, replace } of list) {
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      part = part.replace(new RegExp(escaped, 'gi'), m => matchCase(m, replace ?? ''))
    }
    return part
  }).join('')
}

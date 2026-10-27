// Product name rules (Data & Rules → Rules & defaults), on every page that
// builds a CartUp file (Daraz Upload, Manual Upload, Shop Duplicate):
//   nameRemove — claim words cut out of the name ("100% Original", "Genuine");
//   nameBlock  — a product whose name has one is not uploaded and is reported
//                ("Medicine", "Mystery Box", "{n} taka deal").
// Whole words, capitals ignored, a plural "s" too; words may be joined by a
// space, "-" or nothing ("Mystery-Box", "MysteryBox"); {n} is any amount
// (99, 1,299, 99.50, ৯৯, ৳99).
import { houseRules } from './catalog'

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const AMOUNT = '৳?\\s*[0-9০-৯][0-9০-৯,]*(?:\\.[0-9০-৯]+)?'
const WORD = '[\\p{L}\\p{N}\\p{M}]'

function phraseRegex(phrase) {
  const words = phrase.split(/\s+/).filter(Boolean)
  const body = words.map(w => w.split(/(\{n\})/i).filter(Boolean)
    .map(p => /^\{n\}$/i.test(p) ? AMOUNT : esc(p).replace(/%/g, '\\s*%')).join('')).join('[\\s\\-_]*')
  const plural = /\p{L}$/u.test(phrase) ? '(?:e?s)?' : ''
  return new RegExp(`(?<!${WORD})${body}${plural}(?!${WORD})`, 'giu')
}

const compiled = new Map()
function compile(list) {
  const key = JSON.stringify(list || [])
  if (!compiled.has(key)) {
    if (compiled.size > 20) compiled.clear()
    compiled.set(key, [...new Set((list || []).map(p => String(p ?? '').trim()).filter(Boolean))]
      .sort((a, b) => b.length - a.length)   // "100% Genuine" before "Genuine"
      .flatMap(phrase => { try { return [{ phrase, re: phraseRegex(phrase) }] } catch { return [] } }))
  }
  return compiled.get(key)
}

// The team's rules (or lists being edited), ready to match.
export function nameRules(r = houseRules()) {
  return { remove: compile(r.nameRemove), block: compile(r.nameBlock) }
}

// What is left after cutting a phrase out: no empty brackets, doubled or
// dangling separators, or doubled spaces.
const SEP = '[,;:|/\\-–—]'
export function tidyName(text) {
  return String(text)
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(new RegExp(`(\\s*${SEP})(?:\\s*${SEP})+`, 'g'), '$1')
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(new RegExp(`^(?:\\s|${SEP})+|(?:\\s|${SEP})+$`, 'g'), '')
}

// → { name, removed: [the words as the name had them] }. A name that would be
// left empty is kept as it was.
export function removeNameClaims(name, rules = nameRules()) {
  const original = String(name ?? '')
  let text = original
  const removed = []
  for (const { re } of rules.remove) {
    const found = text.match(re)
    if (!found) continue
    removed.push(...found.map(f => f.trim()))
    text = text.replace(re, ' ')
  }
  if (!removed.length) return { name: original, removed }
  const name2 = tidyName(text)
  return name2 ? { name: name2, removed: [...new Set(removed)] } : { name: original, removed: [] }
}

// → { found: as the name has it, phrase: the team's rule } or null
export function blockedBy(name, rules = nameRules()) {
  const text = String(name ?? '')
  for (const { phrase, re } of rules.block) {
    const found = text.match(re)
    if (found) return { found: found[0].trim(), phrase }
  }
  return null
}

export const blockText = b => `Not uploaded — name has "${b.found}" (team name rule "${b.phrase}")`

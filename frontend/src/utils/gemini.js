const GEMINI_MODEL = 'gemini-2.0-flash-lite'

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || ''
}

export function saveApiKey(key) {
  localStorage.setItem('gemini_api_key', key)
}

// ── Typo map for local name fix ──────────────────────────────────────────────
const TYPO_MAP = {
  'Febric':'Fabric','Fabrics':'Fabric','Fabirc':'Fabric',
  'Jearsy':'Jersey','Jersy':'Jersey','Jearsey':'Jersey',
  'Lenth':'Length','Lenght':'Length',
  'Comfotable':'Comfortable','Comfortble':'Comfortable','Confortable':'Comfortable',
  'Cottan':'Cotton','Coton':'Cotton','Cottton':'Cotton',
  'Poleyster':'Polyester','Polister':'Polyester','Polyster':'Polyester','Poliyester':'Polyester',
  'Woaman':'Women','Weman':'Women','Woomen':'Women',
  'Mens':"Men's",'Womens':"Women's",
  'Shrt':'Shirt','Shrit':'Shirt',
  'Troser':'Trouser','Trousar':'Trouser','Trousser':'Trouser',
  'Pent':'Pant','Pents':'Pants',
  'Sleveless':'Sleeveless','Sleevless':'Sleeveless','Slevless':'Sleeveless',
  'Fullsleeve':'Full Sleeve','Halfsleeve':'Half Sleeve',
  'Jeens':'Jeans','Jens':'Jeans',
  'Kurthi':'Kurti','Kurtee':'Kurti',
  'Sari':'Saree',
  'Orgnza':'Organza',
  'Chifon':'Chiffon','Chiffone':'Chiffon',
  'Gorgette':'Georgette','Gorget':'Georgette',
  'Embroidary':'Embroidery','Embrodery':'Embroidery','Embroidrey':'Embroidery',
  'Collor':'Color','Colour':'Color',
  'Desing':'Design','Dezign':'Design',
  'Beautifull':'Beautiful','Beutiful':'Beautiful',
  'Qualiy':'Quality','Qualty':'Quality',
  'Premiun':'Premium','Primium':'Premium',
  'Fashoin':'Fashion','Fassion':'Fashion',
  'Stylesh':'Stylish','Stlyish':'Stylish',
  'Packege':'Package','Pakage':'Package',
  'Orginal':'Original','Orignal':'Original',
  'Guarntee':'Guarantee','Guarentee':'Guarantee',
  'Warrenty':'Warranty','Waranty':'Warranty',
  'Dupata':'Dupatta','Duptta':'Dupatta',
  'Kamiz':'Kameez',
  'Anarkalli':'Anarkali',
  'Lehnga':'Lehenga','Lahenga':'Lehenga',
  'Palaso':'Palazzo',
  'Prited':'Printed',
  'Stiched':'Stitched',
  'Unstiched':'Unstitched',
  'Embelished':'Embellished',
  'Sequened':'Sequined',
  'Nekline':'Neckline',
  'Jaquard':'Jacquard',
  'Viscouse':'Viscose',
  'Rayan':'Rayon',
  'Spandix':'Spandex',
  'Lycre':'Lycra',
  'Deniim':'Denim',
  'Cordruoy':'Corduroy',
  'Flanel':'Flannel',
  'Flece':'Fleece',
  'Hoody':'Hoodie',
  'Sweathshirt':'Sweatshirt',
  'Tracksuite':'Tracksuit',
  'Tshirt':'T-Shirt',
  'Oversize':'Oversized','Ovesized':'Oversized',
  'Boyfreind':'Boyfriend',
  'Streetware':'Streetwear',
  'Bloues':'Blouse',
  'Salwaar':'Salwar','Shalwar':'Salwar',
}

export function localFixName(name) {
  if (!name) return name
  let result = name
  for (const [wrong, right] of Object.entries(TYPO_MAP)) {
    result = result.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), (match) => {
      if (match === match.toUpperCase()) return right.toUpperCase()
      if (match[0] === match[0].toUpperCase()) return right.charAt(0).toUpperCase() + right.slice(1)
      return right
    })
  }
  // Remove duplicate consecutive words (case-insensitive)
  result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1')
  // Fix double spaces
  result = result.replace(/\s{2,}/g, ' ').trim()
  // Fix trailing/leading dashes and spaces
  result = result.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim()
  return result
}

// ── Gemini call ──────────────────────────────────────────────────────────────
async function callGemini(prompt, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    }
  )
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ── Name fix ─────────────────────────────────────────────────────────────────
export async function fixName(name, apiKey) {
  if (!name) return name
  const localFixed = localFixName(name)
  if (!apiKey) return localFixed
  const prompt = `Fix spelling errors in this product name. Rules:
- Fix obvious misspellings only
- Remove ONLY exact duplicate consecutive words (e.g. "Quality Quality" → "Quality")
- Fix double spaces and trailing/leading dashes
- NEVER add or remove product type, color, or key attributes
- NEVER add information not already in the name
- Return ONLY the fixed name, nothing else

Product name: "${localFixed}"`
  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/^["']|["']$/g, '') || localFixed
  } catch { return localFixed }
}

// ── Category match ────────────────────────────────────────────────────────────
export async function matchCategory(productName, cartupCategories, apiKey) {
  if (!apiKey || !productName) return null
  const catList = cartupCategories.slice(0, 200).map(c => `${c.id}|${c.path}`).join('\n')
  const prompt = `Match this product to the best category from the list below.
Reply ONLY with valid JSON: {"id":"...","path":"...","reason":"..."}
Do NOT add any explanation outside the JSON.

Product: "${productName}"

Categories (ID|Path):
${catList}`
  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return null }
}

// ── Highlights fix ────────────────────────────────────────────────────────────
const HL_RULES = `STRICT RULES — follow ALL:
FORMAT:
- Output MUST be ONLY <ul><li>point</li>...</ul> — nothing else outside this
- Convert plain text lines/bullet points into <li> items
- Strip ALL other HTML tags/styles. Keep ONLY <ul> and <li>
- Remove all <img> tags

CONTENT:
- Remove any non-Latin characters (Bengali, Chinese, Japanese, Arabic, etc.)
- Remove encoding artifacts: Â, â€™, Ã, Ã©, â€", ï¿½, etc.
- Remove hashtags (#word) and keyword-spam items (comma-separated keyword lists)
- Remove duplicate <li> items (same or very similar meaning)
- Remove empty <li> items

CRITICAL — most important:
- NEVER add information not present in the given inputs
- NEVER invent features, materials, specs, or claims`

export async function fixHighlights(highlights, name, description, apiKey) {
  if (!apiKey) return highlights

  let prompt = ''
  if (!highlights && !description) {
    prompt = `Create product highlights using ONLY the product name below. Do not add any detail not found in the name.
${HL_RULES}
Generate 3–5 bullet points.
Product name: "${name}"`
  } else if (!highlights && description) {
    prompt = `Create highlights from the product name and description below. Use ONLY the given information.
${HL_RULES}
Generate 3–5 bullet points.
Name: "${name}"
Description: "${description}"`
  } else {
    prompt = `Clean and reformat this product highlights HTML. Use ONLY the content already present.
${HL_RULES}
Input highlights: ${highlights}
Product name (context only, do NOT add extra info): "${name}"`
  }

  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/```html|```/g, '').trim()
  } catch { return highlights }
}

// ── Description fix ───────────────────────────────────────────────────────────
const BOILERPLATE_RE = [
  /the seller (offer|provide|sell)/i,
  /we (provide|offer|sell|deliver)/i,
  /our (product|item|store)/i,
  /visit our (store|shop|page)/i,
  /contact (us|seller)/i,
  /for more (information|details|info)/i,
  /best (price|deal|quality) guarantee/i,
  /100% (original|authentic|genuine)/i,
]

export function hasBoilerplate(text) {
  return BOILERPLATE_RE.some(p => p.test(text))
}

const DESC_RULES = `STRICT RULES — follow ALL:
FORMAT:
- Output MUST be ONLY <p>text</p> tags — one or more <p> blocks
- Strip ALL other HTML: div, h1-h6, ul, li, span, strong, em, pre, br, etc.
- Remove all <img> tags
- Wrap remaining text in <p> tags only

CONTENT:
- Remove any non-Latin characters (Bengali, Chinese, Japanese, Arabic, etc.)
- Remove encoding artifacts: Â, â€™, Ã, â€", ï¿½, etc.
- If the text contains generic boilerplate ("The seller offers...", "We provide...", "Contact us...", "Visit our store..."), REPLACE the entire text with a 2–3 sentence product-specific description built ONLY from the name and highlights

CRITICAL — most important:
- NEVER add information not present in the given inputs
- NEVER invent features, materials, specs, or claims`

export async function fixDescription(description, name, highlights, apiKey) {
  if (!apiKey) return description

  const rawText = description ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const isBoilerplate = hasBoilerplate(rawText)

  let prompt = ''
  if (!description && !highlights) {
    prompt = `Create a product description using ONLY the product name below. Do not add any detail not in the name.
${DESC_RULES}
Write 2–3 sentences max.
Product name: "${name}"`
  } else if (!description && highlights) {
    prompt = `Create a product description from the name and highlights below. Use ONLY the given information.
${DESC_RULES}
Write 2–3 sentences max.
Name: "${name}"
Highlights: "${highlights}"`
  } else if (isBoilerplate) {
    prompt = `The description below contains generic boilerplate. Replace it with a product-specific 2–3 sentence description using ONLY the name and highlights provided.
${DESC_RULES}
Name: "${name}"
Highlights: "${highlights || 'N/A'}"
Original description (replace this): ${description}`
  } else {
    prompt = `Clean and reformat this product description HTML. Use ONLY the content already present.
${DESC_RULES}
Input description: ${description}
Product name (context only, do NOT add extra info): "${name}"`
  }

  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/```html|```/g, '').trim()
  } catch { return description }
}

export async function testConnection(apiKey) {
  try {
    await callGemini('Say "ok"', apiKey)
    return true
  } catch { return false }
}

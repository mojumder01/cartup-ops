// Shared content rules applied when AI recreates Highlights/Description
// (Governance content passes + Production Daraz/Manual AI cleaning).
const IMG_TAG_RE = /<img\b[^>]*>/gi

// Highlights must never contain an image — strip any <img> tag entirely.
export function stripImagesFromHighlights(html) {
  return String(html || '').replace(IMG_TAG_RE, '').replace(/\s{2,}/g, ' ').trim()
}

// Description keeps ALL images found, but every one of them must be moved to
// the very end, after the last closing </p> tag — never inside or between
// paragraphs.
export function fixDescriptionImages(html) {
  let desc = String(html || '')
  const imgs = desc.match(IMG_TAG_RE)
  if (!imgs || !imgs.length) return desc.trim()
  desc = desc.replace(IMG_TAG_RE, '').replace(/<p>\s*<\/p>/gi, '').trim()
  return `${desc}${imgs.join('')}`
}

export function enforceImageRules(highlightsHtml, descriptionHtml) {
  return {
    highlights: stripImagesFromHighlights(highlightsHtml),
    description: fixDescriptionImages(descriptionHtml),
  }
}

// Prompt text shared by every content-recreation prompt (Governance + Production)
export const IMAGE_RULE_PROMPT = `- Highlights must NEVER contain an <img> tag — if the source has an image, drop it from highlights entirely.
- If the source description contains <img> tag(s), keep ALL of them (don't drop any) but move them all to the very end of the description, AFTER the last closing </p> tag (e.g. "...</p><img src=\\"...\\"/><img src=\\"...\\"/>"). Never place an image inside or between paragraphs.`

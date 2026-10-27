// The category data and house rules every page works with: the team's copy
// (Team settings — saved from the Settings page) or, until someone saves one,
// the copy built into the app (mappings.json and the defaults below). Read
// when needed, never kept at load, so a change applies to the next run.
import MAPPINGS from './mappings.json'
import { teamValue } from './teamSettings'

// Daraz category → CartUp category; mystery boxes (no CartUp category) and
// categories mapped by hand (said so in Report).
export const BUILT_IN_DARAZ = { map: MAPPINGS.daraz_to_cartup, mystery: MAPPINGS.mystery_cats, manual: MAPPINGS.manual_cats }
export const darazCategories = () => teamValue('daraz_categories') || BUILT_IN_DARAZ
// CartUp category id → { path, tags }.
export const cartupCategories = () => teamValue('cartup_categories') || MAPPINGS.cartup_map
// CartUp category id → the attributes it is mapped to (Color, Size, Age Group,
// Main Materials…) — a variant attribute it needs must be filled or CartUp
// rejects the row ("Attribute-Variant Mapping Missing").
export const categoryAttributes = () => teamValue('category_attributes') || MAPPINGS.cat_variant_map
export const BUILT_IN = { daraz_categories: BUILT_IN_DARAZ, cartup_categories: MAPPINGS.cartup_map, category_attributes: MAPPINGS.cat_variant_map }

// House rules (Daraz Upload, Manual Upload, Shop Duplicate).
// fillDefaults: a variant column the category needs but the seller left
// empty gets the neutral value on CartUp's list — Age Group's only one is
// "One Size". discountLimit: a special price this % or more below the price
// is removed (the SKU stays). stockCap: stock never above it. hashTo: "#" in
// names becomes this. wordReplacements: in names, highlights, descriptions.
// partsToName: a Variations Combo part with no column in the category that
// every SKU of the product has ("8TB" in "Grey,8TB") goes into the name.
export const DEFAULT_RULES = {
  fillDefaults: { Color: 'Not Specified', Model: 'Same as picture', Size: 'One Size', 'Clothing Size': 'One Size', 'Shoe Size': 'One Size', 'Bedding Size': 'One Size', 'Age Group': 'One Size' },
  discountLimit: 75,
  stockCap: 99999,
  hashTo: '-',
  wordReplacements: [{ find: 'daraz', replace: 'cartup' }],
  partsToName: true,
}
export function houseRules() {
  const t = teamValue('rules') || {}
  return { ...DEFAULT_RULES, ...t, fillDefaults: { ...DEFAULT_RULES.fillDefaults, ...(t.fillDefaults || {}) } }
}

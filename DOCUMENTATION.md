# CartUp Ops — Catalog Team Platform Documentation

**Built by Muntasir** · Version scheme: `YY.M.patch` (shown in sidebar footer)

CartUp Ops is a browser-based platform for the CartUp catalog team. It converts seller/Daraz export files into CartUp upload templates, runs AI-powered quality checks, maps product images, and revamps product content — all processed locally in the browser with the Gemini AI API.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Production — Daraz Upload](#2-production--daraz-upload)
3. [Production — Manual Upload](#3-production--manual-upload)
4. [Visual](#4-visual)
5. [QC (Quality Check)](#5-qc-quality-check)
6. [Governance](#6-governance)
7. [Settings & Configuration](#7-settings--configuration)
8. [AI Rules Reference](#8-ai-rules-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Getting Started

### Login
Sign in with your team email and password.

### API keys (required for AI features)
1. Get a free key from [Google AI Studio](https://aistudio.google.com/apikey) (or Groq / Grok — see AI Provider below)
2. Go to **Profile & Settings** (top-right) → **API keys & models** → paste one or more keys (one per line) → **Add keys**, or **Import .txt**
3. Add **several keys**: when one hits its limit (15 requests/minute, 500/day on Gemini's free tier) the next one takes over automatically — see [AI Provider](#ai-provider-profile--settings)

### Navigation
| Section | Purpose |
|---|---|
| **Dashboard** | Overview and shortcuts to all sections |
| **Production** | Convert Daraz/manual files → CartUp upload template |
| **Visual** | Map SKU images → image output file |
| **QC** | Flag product issues (the QC team flags, never edits) |
| **Governance** | Revamp product content (zero-tolerance rewrite) |

---

## 2. Production — Daraz Upload

Converts Daraz seller export files into the CartUp bulk-upload template.

### Workflow

```
Upload 4-5 Daraz files → AI cleans content + matches category → Download CartUp template
```

**Step 1 — Upload files (4 required + 1 optional):**

| File | Required | Key columns used |
|---|---|---|
| Price / Stock | ✅ | Product ID, price, stock |
| Basic | ✅ | Product ID, name, images, highlights, description |
| Weight | ✅ | Package weight/dimensions |
| SKU Image | ✅ | Variant images, seller SKU, variations |
| Attribute | optional | Brands — without it every product is **No Brand** |
| CartUp upload template | recommended | Its dropdown lists (Color, Size, Brand, Warranty…) — remembered in the browser after the first pick, shared with Shop Duplicate |
| Image key file | optional | A sheet pairing Daraz image links with CartUp image keys — add it before or after processing (the keys often come later); pick its sheet, link column and key column (guessed automatically) |

**Options** (on the page):
- **Rows:** all rows, or **active only** (by the price file's `status` column) — chosen before processing
- **Special price:** include or leave out. When included it runs **from the day the file is made to the end date you pick** (remembered while it is still ahead); a special price that is a **discount of 75% or more** is removed and logged. Nothing else is removed.
- **Image keys:** every Daraz image link (Product Image 1–8, Variant Image) found in the key file is replaced by its key — links match even with Daraz's size suffixes (`…abc.jpg_720x720q80.jpg_.webp`); links without a key are listed in **to check**
- Special price and image keys apply when the file is built, so they can be changed after processing without running again

**Step 2 — Click "Process & Download".** The system:
1. Joins all files on Product ID
2. AI cleans names (spelling zero-tolerance), recreates highlights/description (strict rules — see [AI Rules](#8-ai-rules-reference))
3. Matches each product to a CartUp category (3,815-category tree)
4. Applies word replacements (default: `daraz` → `cartup`)
5. Fills variant columns (Color, Size…) only if valid for the matched category — see below
6. With the template: checks every dropdown value (variant columns, Brand, Unit, Warranty Type/Period…) against CartUp's lists — the lists `payload_hidden` looks values up in — and writes the list's own spelling
7. House rules, each logged in **changes** (or **to check**):
   - Name: `#` → `-`
   - Stock: never above **99,999**
   - Warranty: *No Warranty* with a period → the period is removed; *Seller / Brand Warranty* without a period → *No Warranty*; a period that isn't on the list goes to review (pick one, keep it, or **Set No Warranty**)
   - Weight below **0.01 kg** (shows as 0.00 — CartUp would charge 0 for delivery) → flagged in **to check**, not changed

The work runs in three stages (`processor.js`): read + AI (once, the slow part) → match values against the template (`matchItems`, repeatable) → build the file (`buildOutput`: decisions, house rules, image keys, hand edits). So:
- **Newer template, no re-run:** after values are added to CartUp's lists, "Check again with a newer template" re-matches the same run — your picks and edits stay.
- **How much is automatic:** the result shows the share of rows that need nothing from you and of dropdown values settled automatically.

**Variant attributes from "Variations Combo"** (e.g. `Black, EU:40`) — decided **per product (Parent SKU)**, not row by row (`frontend/src/utils/variantReview.js`):
- **Product pattern** — which column each position of the combo goes to is scored over all the product's SKUs (match on each column's CartUp list, whether values look like sizes or colours, colour usually first). An odd value ("Type A", "Zorvex Pattern 1") follows its siblings; a value that clearly belongs elsewhere (siblings written in another order: `38, Navy Blue` next to `Black, 40`) still goes where it fits. A size-only combo (`XL`) goes to the size column. Colour-only products no longer get `Size = Yes` (on no list → #N/A).
- **One size format per product** — if siblings are `41 (EU)`, a bare `40` becomes `40 (EU)` too.
- **Variants never collide** — when two SKUs of a product would end up with the same values (`Mixed Color` and `Assorted` both → Multicolor; a seller writing `Red, M` twice), they get the list's numbered entries: `Multicolor-1`, `Multicolor-2`… (numbers the product already uses are skipped). Without numbered entries on the list, the clashing auto-matches are undone and go to review.
- **Seller SKU unique** — a repeated Seller SKU row is dropped (first kept) and logged.

**Smart matching** (`frontend/src/utils/listMatch.js`, also used by Shop Duplicate), in order of confidence: exact (case ignored, as VLOOKUP does) → same text apart from spacing/punctuation (`Type-B` = `Type B`; decimal points and ranges kept, so `2.5mm` ≠ `25mm`, `3-4 Years` ≠ `34 Years`) → known equivalents (`EU:40`/`38` → `40 (EU)`/`38 (EU)`, `UK:7` → `7 (UK)`, `Int:XXL`/`XXL` → `2XL`, `Free Size`/`FS` → `One Size`, `King` → `King Size`, `6 Months` → `6 month`, `12 Months` → `1 year`, `Local seller warranty` → `Seller Warranty`, `International Manufacturer Warranty` → `Brand Warranty`, `pcs` → `PCS`, `Mixed Color` → `Multicolor`, `As Picture` → `Same as picture`) → a close spelling (same words in another order, or one or two typos — only when one entry is clearly closest and every number is the same). Brands, units and warranty fields never use close spellings.

**Review window — product by product** (opens by itself when values are left; or "Review product by product"): products needing attention on the left; on the right the product's SKUs with their **variant images** (click to enlarge) and every dropdown value, coloured by state (red = not on CartUp's list, blue = matched automatically / remembered, green = picked, amber = kept as a new value). Click a value to: pick one of the **closest list values**, **search** the whole list (type-ahead), **keep the seller's value as a new value** for CartUp's list, or go back to automatic. Each pick applies to **this SKU**, **this product**, or **every SKU with that value** (the default) — and "every SKU" picks are **remembered in this browser**, so the same value is automatic in later runs (the footer shows how many are remembered, with a "forget them" link). After a pick the window jumps to the next open value. SKUs of a product left with identical variant values are flagged. **Large images** shows bigger variant images and the product's images 1–8 above the table. **Brands** (top right, when the attribute file has brands that aren't on CartUp's list): one row per brand with how many products/SKUs use it — **No Brand**, **Keep as new brand** (for CartUp to add), or **Pick…** the right one from the list; applies to every product with that brand and is remembered.

**View & edit sheet** — the whole output, Excel-style (`components/SheetEditor.jsx`): every row and column, rows virtualised so thousands stay smooth, the Seller SKU column and header fixed. Red = required and empty, or a dropdown value not on CartUp's list (#N/A); amber = flagged (weight, image key); blue = edited. Column headers count their problem cells. Filter to rows with problems, search by SKU or name, click a cell and edit it in the bar below (dropdown columns suggest list values; the row's image is shown). Edits are the last word on a value, logged as "Edited by hand", and survive a newer-template re-check.

**Step 3 — Output:** `cartup_daraz_output.xlsx` — downloads at once when nothing needs a decision, otherwise from the review window ("Download file", also on the page). Sheets:
- **product** — with the decisions applied; the Report column notes each row's changes, values not on the list, and identical variants
- **invalid** — rows missing required fields (as before)
- **changes** — every change, one row per Seller SKU and column: Seller SKU, Parent SKU, product, column, Daraz value, output value, what changed it (known equivalent, close spelling, numbered to keep variants apart, picked by hand, remembered pick, kept as new value, name fixed by AI, "#" replaced, stock capped, special price removed, warranty rule, edited by hand, duplicate Seller SKU removed)
- **to check** — flagged but not changed: weight below 0.01 kg, image links without a key
- **new values** (with the template) — every value not on CartUp's lists, once each: column, value, status (*Add to the CartUp list — decided*, or *Not reviewed — shows #N/A until matched or added*), how many SKUs and products use it, the Seller SKUs, and the closest CartUp values

---

## 3. Production — Manual Upload

Same as Daraz Upload but for a single manually-prepared file.

### Workflow

```
Download template → Fill in products → Upload → AI process → Download output
```

1. Click **Download Template** to get the input format
2. Required columns: **Name**, **Parent SKU**. Optional: Price, Color/Size (comma-separated — variants auto-expand), Highlights, Description, Brand, Image 1–8, Stock, Weight, etc.
3. Upload the filled file → **Process & Download**
4. Color/Size values expand into one row per variant, with variant columns filled only when valid for the matched category

### Shop Duplicate

Copies every product of one seller into the CartUp bulk-upload template for another seller — no AI, nothing rewritten.

```
Old seller's product export + blank upload template + new seller SKU (replace code or prefix) → Process & Download
```

**Inputs:**
- **Old seller's product export** — the admin export (ProductId, VariantName, Seller SKU, Parent Sku, Product Image1–8, HighlightEn/Bn, DescriptionEn/Bn, …)
- **Upload template (blank)** — download a fresh one from the seller center each time; its Brand/Unit/Color/Size lists are used to fill the hidden ID sheet
- **New seller SKU** — applied to Seller SKU and Parent SKU, two modes:
  - **Replace code** (default) — old seller code → new seller code: `CCWT9196 = CCWT9197` turns `CCWT9196_184_Anycolour` into `CCWT9197_184_Anycolour`. One row per old code; the codes found in the export (the part before the first `_`) are pre-filled with their SKU counts, and pasting lines like `CCWT9196 = CCWT9197` (also `->`, `→`, `:`) fills the rows. Codes match whole tokens only (`CCWT9196` never touches `CCWT91961`), case-insensitive, in one pass (so `A = B`, `B = A` swaps rather than chains)
  - **Add prefix** — e.g. `CCWT9323` turns `CCWT9196_184_Anycolour` into `CCWT9323_CCWT9196_184_Anycolour`
  - **Clash check** (live, before processing): if two old SKUs would become the same new Seller SKU, or two different old parents the same new Parent SKU (e.g. mapping `CCWT9196` and `CCWT9194` both to `CCWT9197` makes `CCWT9196_184` and `CCWT9194_184` one product), the page shows a red warning — give each old code its own new code, or use Add prefix. SKUs no rule matches keep the old code and are counted too

**How each row is filled:**
- Image URLs → file name only (`https://…/product/abc.webp` → `abc.webp`), for Product Image 1–8 and Variant Image
- `VariantName` is split into the variant columns: `Size-One Size, Color-Black` → Size = One Size, Color = Black
- Warranty Type/Period IDs → their names (3 → No Warranty)
- Brand, Unit, Color, Size, Warranty… are matched to the template's own list with the same smart matching as Daraz Upload (exact first — the lists contain near-duplicates such as `Grey` and `Grey ` with different IDs — then spelling/format differences and known equivalents); every value that was changed is listed under **Auto-matched values**
- Special Price 0 → blank (and its dates); duplicate Seller SKUs → first one kept, original order kept
- **Special price** (checkbox on the page): include or leave out; when included it runs from today to the end date you pick, and a **discount of 75% or more** is removed
- House rules as in Daraz Upload: `#` in names → `-`, stock never above 99,999, *No Warranty* with a period → period removed, *Seller/Brand Warranty* without one → *No Warranty*, weight below 0.01 kg flagged as a warning — all listed under **Changed values**
- Word Replacements from Profile (default `daraz → cartup`) applied to names, highlights, descriptions, what's-in-the-box and warranty text

**The hidden `payload_hidden` sheet** (the one the platform reads — IDs via VLOOKUP formulas) is filled with the values Excel would compute, so the file uploads correctly without opening it in Excel first. A small built-in formula engine (`frontend/src/utils/xlsxFormula.js`) reads each column's formula, fills it down every row the way Excel's fill handle does, and calculates it — IF, IFERROR/IFNA, VLOOKUP, INDEX/MATCH, XLOOKUP, TRIM/LEN/LEFT…, AND/OR, ISBLANK… over Excel Tables, plain ranges or defined names. So template variations still work: Excel "shared" formulas, other formula styles, extra blank cells, and templates whose rows were deleted in Excel (`#REF!` rows, or formulas shifted out of line with the product rows — the seller-center template itself has these) are rebuilt so hidden row N always reads product row N+1. A formula using a function the engine doesn't know is written without a cached value and the page says to open the file in Excel and press Save before uploading. Everything else in the template — dropdowns, lookup tables, hidden sheets — is kept byte-for-byte.

**Report tab** (on by default — checkbox on the page): a visible **Report** sheet is added after the template's own sheets (so their order doesn't change) with the run summary (files used, SKU rule, rows read / duplicates removed / rows written / products, any template notes); **Hidden sheet errors** — every data row whose payload_hidden cell still shows `#N/A` (or another error) after matching, with the file row, column and value, so it can be fixed from the dropdown before uploading; **Auto-matched values**; every **removed duplicate** (export row, Seller SKU, Parent SKU, name, the row that was kept, and what differs from it — e.g. `Price(MRP): 1550 → 1234`, or "Same as kept row"), and every warning. The #N/A cells, auto-matched values and removed duplicates are listed on the page as well. If the platform ever rejects files with an extra sheet, untick the checkbox.

**Output:** `cartup_shop_duplicate_<new code or prefix>.xlsx`. A template holds ~4,990 rows; bigger shops are split into several files (downloaded as a .zip) and a product's variants are never split across files.

**Warnings** are listed after processing (and downloadable as .xlsx): a value not in the template's list (that row would be rejected — the hidden sheet shows `#N/A` exactly as Excel would), an unknown variant attribute, an empty required field, a special price not below MRP, a SKU no replace rule matched, or a Seller/Parent SKU clash.

---

## 4. Visual

Maps product images from Daraz files into the CartUp image-upload format.

### Workflow

```
Upload SKU Image file + Basic file → Generate → Download image output
```

**Inputs:**
- **SKU Image file** — columns: Product ID, SellerSKU, Variations Combo, Images1–8
- **Basic file** — columns: Product ID, *Product Name(English), *Product Images1–8

**Image mapping rules (same as Daraz):**
- Variant has its own SKU image → use it
- Color variant without a SKU image → left empty
- No variants → falls back to Basic file Image 1

**Output columns:** `Parent SKU | Product | Seller SKU | Image 1–8 | Variant Image | Variant Combo`

---

## 5. QC (Quality Check)

**The QC team FLAGS products — it never edits them.** Sellers upload many products, so spelling/grammar checks are **lenient**: only clear, unprofessional errors get flagged. Output: an approval/reject file for the admin panel.

### Workflow

```
Upload Admin QC file → toggle checks → Run → review table (image/HTML previews,
manual flags, edit reports) → check variants manually → Download 2 output files
```

**Step 1 — Upload** the Admin QC export (.xlsx). Required: `ProductId`. The table shows 14 columns; rows dedupe by Product ID in **Unique-QC View**.

**Step 2 — Configure (control bar):**
- **Check toggles** — turn each check on/off: Name, Category, Image, Highlights, Description, Weight, Restricted, Competitor
- **Context box** — describe the products (e.g. "RFL home appliances") → improves AI accuracy for every check
- **Batch size** — products per AI call. Small (1–5) = more accurate, more API calls. Large (10–20) = faster, cheaper, slightly less accurate. Recommended: 5 for small files, 10 for 5k+.

**Step 3 — Run QC Checks.** Checks run one pass at a time (sequential):

| Check | Type | What it flags |
|---|---|---|
| Name | AI | Obvious spelling mistakes (`'Blander' = 'Blender'`), Bangla characters in English name |
| Category | AI 2-step | AI describes the correct category → scored against all 3,815 CartUp categories → mismatch report includes the suggested correct path |
| Image | instant + manual | Missing image auto-flagged; blur/poor quality flagged manually via the image viewer |
| Highlights | AI + instant | Clear spelling/broken grammar; `<img>` tag inside highlights; empty |
| Description | AI + instant | Clear spelling/broken grammar; empty |
| Weight | AI + instant | Missing/invalid/≤0/>100kg; AI checks realism (blender at 0.05 kg = flag) |
| Restricted | AI + keywords | Medicine (supplements OK), adult items, weapons, vape/tobacco, gambling. Keyword list editable via **Lists** |
| Competitor | instant | Competitor names (daraz, pickaboo, amazon…), external links, phone numbers. List editable via **Lists** |

After all passes, a **verify pass** re-checks every spelling/grammar flag and removes false positives (brand names, model codes, local words).

**Step 4 — Review in the table:**
- **All Products / Unique-QC View / Variant Check** view buttons
- Click an **image** → large viewer with Prev/Next arrows, flag button, comment box
- Click **View** on HL/Desc → rendered HTML preview (no raw tags) with Prev/Next + comment box
- **Pencil icon** on any report → edit issues manually (separate with `;`, empty = OK)
- **Filter** button → per-column text filters
- **Checkboxes + Remove Selected**, or **Remove by ID** (paste multiple IDs) → removed products are excluded from both outputs. Undo anytime.

**Step 5 — Variant Check tab:** shows only products whose Product ID repeats (= has variants). Rows are color-grouped per product (light blue / light yellow alternating). Mark each **OK** or **Issue** manually. AI checks keep running in the background while you work here.

**Step 6 — Download:**

| File | Contents |
|---|---|
| **Unique-QC View** | SL + the 14 columns + Report (all issues joined with `;`, or `OK`) |
| **QC Pass File** | `Seller ID \| Product ID \| Approval Status \| Product Tags \| Reject Reason` — Status **1** = all OK, **2** = rejected (all issues in Reject Reason) |

**Pause / Resume:** Pause stops after the current batch; progress saves to the browser (checkpoint). Re-upload the same file → Continue resumes exactly where it stopped. Uploading a *different* file wipes everything automatically.

---

## 6. Governance

**The Governance team REVAMPs products** — so the AI actually rewrites content with **zero tolerance** for spelling/grammar errors.

### Workflow

```
Upload file → toggle checks → sequential passes (Name → Weight → Category →
Highlights → Description) → single output when ALL passes complete
```

**Input:** .xlsx with required columns **Name** + **SKU ID** (Description, Highlights optional).

**Sequential pipeline** — each enabled check runs as its own full pass over all products, in this order, because later passes consume earlier results:

```
Pass 1: Name        (clean all names first)
Pass 2: Weight      (estimate from cleaned name)
Pass 3: Category    (2-step match + verify, uses cleaned name + description)
Pass 4: Highlights  (recreated from cleaned Name + original Description)
Pass 5: Description (recreated from cleaned Name + fixed Highlights)
→ Output (only when every enabled pass is complete)
```

**Category matching (highest accuracy path):**
1. AI describes the product's true category (leaf + branch + alternative), using name + description excerpt
2. Local weighted scoring against all 3,815 CartUp categories (leaf matches weighted 6×) → top 25 candidates
3. AI picks the best candidate
4. **Verify pass** — AI audits every pick; doubtful ones get `Low confidence — verify manually` in the Category Note so wrong categories never slip through silently

**Controls:**
- **All / None** — toggle every check at once
- **Batch Size** — same trade-off as QC (tips shown in UI)
- **Pause** — stops after current batch; checkpoint saves every batch
- **Resume** — re-upload the same file; continues mid-pass from the exact product it stopped at
- **Reset** — wipes file, checkpoint, toggles

**Output** (`cartup_governance_output.xlsx`) — only columns for enabled checks:
`SKU ID | Original Name | Name (Cleaned) | Weight (kg) + Confidence | Highlights | Description | Category ID + Path + Note | Report`

**Large files (5k–15k):** checkpoint saves every batch, so a browser crash, rate-limit stop, or manual pause never loses progress. Resume across days if the daily API quota runs out.

---

## 7. Settings & Configuration

All settings persist in the browser (localStorage).

| Setting | Where | Default |
|---|---|---|
| Gemini API key | Profile & Settings | — |
| Word replacements (applies to Production output) | Profile & Settings | `daraz` → `cartup` |
| QC batch size | QC control bar | 5 |
| Governance batch size | Governance page | 10 |
| Competitor list | QC → Lists button | 17 marketplaces |
| Restricted keyword list | QC → Lists button | 19 keywords |

---

## 8. AI Rules Reference

### Content recreation (Production + Governance) — STRICT
- Use **ONLY** information present in the given Name/Highlights/Description
- **Never add** AI-generated info, marketing phrases, invented specs, or assumptions
- **Never remove** any specification, feature, measurement, or detail
- Fix **ALL** spelling and grammar — zero tolerance
- Brand names and model codes stay unchanged
- Output format: highlights = `<ul><li>` bullets, description = `<p>` paragraphs
- **Image rule**: Highlights may never contain an `<img>` tag — any image found there is dropped. Description keeps every image found in the source, but all of them are relocated to the very end, after the last closing `</p>` tag — never inside or between paragraphs. Enforced in code (not just the prompt), so it holds even if the AI ignores the instruction.
- **Combined Highlights+Description (Governance only)**: when both checks are enabled together, they run as ONE AI pass instead of two sequential ones, so the two fields are generated from the same source at once and never contradict each other. Toggling only one of the two still runs it alone. Production (Daraz/Manual) already generates both fields in a single call by design, so this applies there automatically too.

### QC flagging — LENIENT
- Flag only clear, obvious errors that look unprofessional
- Forgive: plural slips, minor typos, bullet fragments, missing articles
- Ignore: brand names, model codes, transliterated Bangla words, style variants (colour/color)
- Every spelling/grammar flag is double-checked by a verify pass

### Rate limiting
- 2-second delay between API calls, 15s wait + 3 retries on HTTP 429
- Model: `gemini-3.1-flash-lite` (default), or `grok-4-fast-non-reasoning` when Grok is selected as provider

### AI Provider (Profile & Settings)
- Choose **Gemini** (Google, 500 free requests/day), **Grok** (xAI — [console.x.ai](https://console.x.ai)) or **Groq** (groqcloud — keys start with `gsk_`)
- The chosen provider powers all AI calls across Production, QC, and Governance — no per-section switch needed

**API keys & models** (`frontend/src/utils/aiPool.js`) — every provider holds a list of keys and a list of models, used in turn:
- **Keys:** the first usable key is used until it hits its limit; then it cools down (for the wait the provider reports — 60 s by default — or an hour when the *daily* quota is used up) and the next key takes over. An invalid key is skipped for a day. When every key is cooling down the app waits for the soonest one (up to ~1½ min), then stops with a clear message. Each key shows its state (ready / works / rate limited · back at hh:mm / daily limit / invalid) with **Test**, reorder, remove and "use it again now".
- **Models:** tried top to bottom — if a model is unavailable (not found) or busy (5xx), the next one is used. Add any model name, reorder, or go back to the defaults (Gemini: `gemini-3.1-flash-lite` → `gemini-2.5-flash-lite` → `gemini-2.5-flash`).
- **Import / export .txt:** one key per line; lines starting with `#` are ignored. The provider comes from the key's start (`AIza…` Gemini, `gsk_…` Groq, `xai-…` Grok); write `gemini: KEY` if it isn't clear. Export writes every key of every provider — share it only with your team.
- Keys and cool-downs are stored in this browser only. Grok / Groq calls go through our backend (`/ai/proxy`, which passes the chosen model on) because those APIs block browser calls; the key is sent per request and never stored there.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Old version showing after update | Hard refresh: `Ctrl+Shift+R` (check version in sidebar footer) |
| "Rate limit" error | Daily quota (500 req) or per-minute limit hit — wait, or Pause and Resume later; progress is saved |
| Selecting a file does nothing | Fixed in v25.6.30+ — hard refresh. All inputs accept re-selecting the same filename |
| New file shows old data | Fixed — uploading a new file wipes all previous state and stops running checks |
| Paused, want to continue later | Re-upload the **same** file (same name + size) → Continue/Resume button appears |
| Category obviously wrong | Check the Report/Note column — low-confidence picks are labelled for manual review. Add a context hint (QC) to improve accuracy |
| AI checks skipped | No API key — add it in Profile & Settings |
| Output missing products | Check the `invalid` sheet (Governance) or error column (Production) — rows without required fields are listed there |

---

*Everything runs client-side in your browser — files are never uploaded to any server except product text sent to the Gemini API for AI processing.*

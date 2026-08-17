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

### Gemini API Key (required for AI features)
1. Get a free key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Go to **Profile & Settings** (top-right) → paste the key → Save
3. Free tier limits: **500 requests/day**, 15 requests/minute — the app auto-throttles (2s delay between calls, retries on rate-limit)

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
| Attribute | optional | Extra attributes |

**Step 2 — Click "Process & Download".** The system:
1. Joins all files on Product ID
2. AI cleans names (spelling zero-tolerance), recreates highlights/description (strict rules — see [AI Rules](#8-ai-rules-reference))
3. Matches each product to a CartUp category (3,815-category tree)
4. Applies word replacements (default: `daraz` → `cartup`)
5. Fills variant columns (Color, Size…) only if valid for the matched category

**Step 3 — Output:** `cartup_daraz_output.xlsx` downloads automatically. Products that failed category matching get a note in the error column — fix manually.

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
- Choose **Gemini** (Google, 500 free requests/day) or **Grok** (xAI, free trial credits for new accounts) — get a Grok key at [console.x.ai](https://console.x.ai)
- The chosen provider powers all AI calls across Production, QC, and Governance — no per-section switch needed
- Each provider's key is stored and tested independently in Profile; switching providers doesn't clear the other key

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

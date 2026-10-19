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

### Gemini API keys (required for AI features)
1. Get free keys from [Google AI Studio](https://aistudio.google.com/apikey) — AI runs on **Gemini only**
2. Go to **Profile & Settings** (top-right) → **Gemini API — keys & models** → paste one or more keys (one per line, any format: `AIza…`, `AQ.…`, `gen-…`) → **Add keys**, or **Import** a .txt
3. Add **several keys**: every key has its own limit per model (e.g. 15 a minute and 500 a day on Gemini 3.5 Flash Lite), and requests are spread over the ticked keys — see [Gemini keys & models](#gemini-keys--models-profile--settings)

### Which parts use the Gemini API
Only these call Gemini (they use requests from the ticked keys' daily limits); everything else runs in the browser with no API.

| Page | Uses Gemini for | Without a key |
|---|---|---|
| Daraz Upload | Name, Highlights, Description clean-up (5 products a request, once per Product ID) — each can be turned off with the **AI check** boxes. Categories never use AI (mapping table only) | Name: spelling rules; highlights / description as in the Basic file |
| Manual Upload | Name, Highlights, Description clean-up + CartUp category in one request per batch | Spelling rules only; no category |
| QC | Name spelling, category match, weight, highlights, description, restricted items (+ a second check of flagged spelling issues) | Instant checks only (image missing, `<img>` in highlights…) |
| Governance Checks | Every check (name, weight, category, highlights, description) | Refuses to run |

**No API:** reading and checking the Daraz files, category mapping from the built-in table, matching Color/Size/Brand/Warranty to CartUp's lists, the review window, house rules (special price, stock, weight, "#"), image keys, the sheet view, the report summary, Shop Duplicate, Visual, word replacements. The backend (Render) is used only for sign-in.

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
Upload 4-5 Daraz files → AI cleans content (optional) → category by lookup → Download the filled CartUp template
```

**Step 1 — Upload files (4 required + 1 optional):**

| File | Required | Key columns used |
|---|---|---|
| Price / Stock | ✅ | Product ID, price, stock |
| Basic | ✅ | Product ID, name, images, highlights, description |
| Weight | ✅ | Package weight/dimensions |
| SKU Image | ✅ | Variant images, seller SKU, variations |
| Attribute | optional | Brands — without it every product is **No Brand**; an **ISBN/ISSN** column (books) fills CartUp's ISBN/ISSN |
| CartUp upload template | recommended | **The output is this template, filled in** (templates whose hidden formulas are written `=IF(…)`, as some tools save them, are read too) (every column, dropdown and hidden formula kept); its dropdown lists (Color, Size, Brand, Warranty…) check the values — remembered in the browser after the first pick, shared with Shop Duplicate |
| Image key file | optional | CartUp image keys — add it before or after processing (the keys often come later). Two layouts, guessed automatically: **Keys per Seller SKU** (one row per SKU, a column per image — e.g. `SellerSKU`, `Images 1`…`Images 5`, `Variant 1`): pick the column to match rows by and, in **nine dropdowns**, which file column goes to Image 1–8 and Variant Image (or "not used"); or **Daraz link → key** (a link column and a key column) |

**File check** (`utils/darazFiles.js`) — every file is read and checked the moment it is picked, so a wrong or incomplete file shows up before processing:
- **Under each box:** rows, products, Seller SKUs (and how many are active) in green; problems in amber (rows without Product ID, Seller SKU, price or name; repeated Seller SKUs; products without Image 1; rows without a package weight); errors in red — **the wrong file in a box** ("This looks like the Basic file — put it in the Basic box"), the **CartUp template in a Daraz box**, **missing columns**, an empty or unreadable file. The CartUp template box says how many dropdown lists it has.
- **File check panel** — the files against each other: the **same file in two boxes**; **Price and Basic from different exports** (fewer than half the products in both); products in the Price file but not in Basic (kept, image flagged) or Weight (no weight → left out unless typed in), Seller SKUs not in the SKU Image file (with the first IDs as examples); how many products get a brand from the Attribute file.
- **Process** is blocked while a box is red (with the reason); a cross-file error asks "Process anyway?". Files are read once — processing reuses them. A title row above the header, another sheet name than `template`, or extra spaces in headers are handled. If the Weight file has a `SellerSKU` column, each SKU gets its own weight.
- After a run the button says **Process again** and asks first (it runs the AI again and starts the review over).

**Options** (on the page):
- **Rows:** all rows, or **active only** (by the price file's `status` column) — chosen before processing
- **AI check** — three checkboxes, all on by default and remembered: **Name**, **Highlights**, **Description**. Ticked: Gemini fixes its spelling/grammar. Unticked: not checked and not sent to the AI — the name gets the spelling rules only; highlights / description are **taken from the Basic file as they are** (a plain lookup by Product ID: no clean-up, no word replacements, no content rules). All three off: no AI requests at all. The change log, summary and AI line say which were off. Chosen before processing
- **Variations Combo:** **Match to variant columns** (default — `Black, XL` → Color *Black*, Size *XL*, matched to CartUp's lists; variants that would be identical are numbered — Black-1, Black-2… — and flagged) or **Mark needed columns "Yes"** — no matching and no numbering: each variant column the category needs (Color, Size…) just says *Yes* (Report says which; check list *Variant columns marked "Yes"*; "Yes" isn't on CartUp's current lists, so the hidden sheet shows #N/A for those cells). Changing it after processing re-matches the same run (no AI). Either way the seller's original combo is in the file's **Variations Combo** column. Remembered
- **Special price:** include or leave out. When included it runs **from the day the file is made to the end date you pick** (remembered while it is still ahead); a special price that is a **discount of 75–99%** is removed, **the SKU stays** (a special price of **0** means no special price — it is left empty, not counted as a 100% discount): logged in changes, "Special price removed: n% discount" in Report, marked in the sheet (*Special price removed*) and counted in the summary.
- **Stock:** *As in file* (never above 99,999), or **the same stock for every row** — e.g. `0` when the seller wants to upload with no stock; every changed row is logged in **changes**
- **Image keys:** with a key file the images are **the file's, as they are** (matched by Seller SKU, used as given). An image without a key is not uploaded and is logged in **changes** only — it is not flagged; the product images that have a key move up to fill the gaps (a key for Image 2 only → it becomes Image 1). *Keys per Seller SKU* — each row is found by its Seller SKU (or Product ID when that is the match column; then every variant gets the same images) and each mapped column's key goes into that image. *Daraz link → key* — every Daraz image link (Product Image 1–8, Variant Image) found in the key file is replaced by its key; links match even with Daraz's size suffixes (`…abc.jpg_720x720q80.jpg_.webp`). Either way, **an image without a key is not uploaded** (the Daraz link is removed — in **changes** and **to check**, with "Seller SKU not in the image key file" when the row wasn't found). A product that isn't a colour variant takes Image 1's key as its variant image
- **A SKU is left out of the upload only for:** no **name**, no **price (MRP)**, no **package weight**, or — with an image key file — **no product image with a CartUp key at all, or none for the Variant Image** (plus no Product ID / Seller SKU, without which a row can't be uploaded at all, and a repeated Seller SKU). Left-out rows go to **invalid** with the reason. No weight / no key are decided when the file is built, so typing the weight or key in the sheet keeps the row (check list *Rows left out of the upload*, sheet filter *Left out — no weight / no image key*). Everything else stays in the upload with a note: no Image 1 or no variant image without a key file (flagged *Image missing*), no CartUp category, a value not on a list, a weight of 0.00x (no longer flagged)
- **Report summary** — the run in a few lines: rows in the Price file → uploaded / left out, then per topic — Inactive, Price (no price, special prices removed or flagged), Image (left out for no key, keyed, not uploaded, missing), Weight (left out for no weight), Stock, other reasons, Category, Variants set by rule, Check = YES rows, AI. Shown on the page with a **Copy** button, and in the file's **summary** sheet as one cell (A1)
- Special price, stock and image keys apply when the file is built, so they can be changed after processing without running again

**Step 2 — Click "Process & Download".** The system:
1. Joins all files on Product ID
2. AI cleans the ticked fields — names (spelling zero-tolerance), highlights / description (strict rules — see [AI Rules](#8-ai-rules-reference)); unticked ones are looked up as they are
3. CartUp category from the **mapping table only** (Daraz category → CartUp category; **no AI**). No match: the row stays, its Category Id is empty and Report says *No CartUp category for Daraz category n — fill in the Category Id*
4. Applies word replacements (default: `daraz` → `cartup`) to the AI-checked fields
5. Fills variant columns (Color, Size…) only if valid for the matched category — see below. **A variant column the category needs but the seller left empty** (no variant, or a variant of another kind — e.g. a colour-only card holder whose category needs Size): **Color → "Not Specified"**, **Model → "Same as picture"**, **Size / Clothing Size / Shoe Size / Bedding Size → "One Size"** (the list's spelling). Logged in changes, *Not given, set by rule (category needs it): Size = One Size* in Report, **Check = YES**, marked in the sheet (*Set by rule*)
6. With the template: checks every dropdown value (variant columns, Brand, Unit, Warranty Type/Period…) against CartUp's lists — the lists `payload_hidden` looks values up in — and writes the list's own spelling
7. House rules, each logged in **changes** (or **to check**):
   - Name: `#` → `-`
   - Stock: never above **99,999**
   - Warranty: *No Warranty* with a period → the period is removed; *Seller / Brand Warranty* without a period → *No Warranty*; **No Brand with Brand Warranty and a period is fine** — kept as it is, not flagged; a period that isn't on the list goes to review (pick one, keep it, or **Set No Warranty**)
   - Weight: no rule — `0.001`–`0.009` kg is kept as it is, not flagged; **no weight at all** leaves the SKU out (see above)

The work runs in three stages (`processor.js`): read + AI (once, the slow part) → match values against the template (`matchItems`, repeatable) → build the file (`buildOutput`: decisions, house rules, image keys, hand edits). So:
- **Newer template, no re-run:** after values are added to CartUp's lists, "Check again with a newer template" re-matches the same run — your picks and edits stay.
- **How much is automatic:** the result shows the share of rows that need nothing from you and of dropdown values settled automatically.

**Variant attributes from "Variations Combo"** (e.g. `Black, EU:40`) — decided **per product (Parent SKU)**, not row by row (`frontend/src/utils/variantReview.js`):
- **Product pattern** — which column each position of the combo goes to is scored over all the product's SKUs (match on each column's CartUp list, whether values look like sizes or colours, colour usually first). An odd value ("Type A", "Zorvex Pattern 1") follows its siblings; a value that clearly belongs elsewhere (siblings written in another order: `38, Navy Blue` next to `Black, 40`) still goes where it fits. A size-only combo (`XL`) goes to the size column. Colour-only products no longer get `Size = Yes` (on no list → #N/A).
- **One size format per product** — if siblings are `41 (EU)`, a bare `40` becomes `40 (EU)` too.
- **Variants never collide** — when two SKUs of a product would end up with the same values (`Mixed Color` and `Assorted` both → Multicolor; a seller writing `Red, M` twice; `Multicolor, Vitamin C` / `Multicolor, tea tree` in a category with only Color), they get the list's numbered entries: `Multicolor-1`, `Multicolor-2`… (numbers the product already uses are skipped). Without numbered entries on the list, the clashing auto-matches are undone and go to review. **Read per product, like a person would:** what do the variants differ by — **colour**, **size**, **colour and size**, or something else (the summary counts the products of each kind) — and which columns does the category have? With a size column the size goes there. With **Color but no size column**: **only the size differs → the size alone in Color** (`Grey,L,Body` / `Grey,XL,Body` → **L** / **XL**); **colour and size differ → both in Color** (`Grey,L` / `Black,M` → **Grey-L** / **Black-M**), always in CartUp's list spelling, only when every SKU gets a value and no two end up alike (Report: *In Color: L — size "L" in the Color column — the variants differ only by size and the category has no size column*). Sizes are read the way people write them: S/M/L/XL, `M/Left` → **M (Left)**, `M(30-40)`, age ranges (`1-2 Years`), and words — *Universel* → Universal, *CH / Child* → Kids, *AD* → Adult, *SPL* → Special, *mail* → Male. Each SKU has its own list of names to try (the whole part, its known names, its words one by one, then just its size); two SKUs that would get the same value — counting `Grey-XL` and `Grey XL` as the same — move on to their next try, so `xL/30-40` / `XL/20-30` become **Grey-XL** / **XL** and `CH/Left` / `CH/Right` become **Left** / **Right**. **Size (or side) in the Color column, SKU by SKU, when that doesn't fit the whole product:** when the category has Color but no size column (e.g. Injury Support and Braces) and the variants differ by size — `Grey, L, Body` / `Grey, XL, Body` — the size goes into Color as CartUp's list has it: **Grey-L / Grey L / Grey Large**, else the size alone (**L**, **Large**, **M (Left)** for `M/Left`); a part that isn't a size but tells the variants apart and is on the Color list (Left / Right, Long / Short, Vitamin C) is used the same way. Each SKU on its own, never a value another SKU of the product has; one SKU left alike keeps its plain colour. Flagged to check (check list *Size put in the Color column*, sheet filter *Size / variant in the Color column*, Report *In Color: Grey-L (Daraz "Grey,L,Body"…)*, Check = YES). Only what is still alike after that is numbered — with the list's real numbered entries only (`Grey-2`; never look-alikes like `Grey (5)`, `Grey16` or a far `L-21`); when there aren't enough, the variants stay as they are and are flagged *Variants with the same values*. **A numbered value is flagged (fix):** check list *Variants told apart only by a number*, sheet filter of the same name, Check = YES, and Report names what the variants really differ by (*they differ by "Vitamin C", which has no CartUp column*) — check each, or pick a real value.
- **Seller SKU unique** — a repeated Seller SKU row is dropped (first kept) and logged.

**Smart matching** (`frontend/src/utils/listMatch.js`, also used by Shop Duplicate), in order of confidence: exact (case ignored, as VLOOKUP does) → same text apart from spacing/punctuation (`Type-B` = `Type B`; decimal points and ranges kept, so `2.5mm` ≠ `25mm`, `3-4 Years` ≠ `34 Years`) → known equivalents (`EU:40`/`38` → `40 (EU)`/`38 (EU)`, `UK:7` → `7 (UK)`, `Int:XXL`/`XXL` → `2XL`, `Free Size`/`FS` → `One Size`, `King` → `King Size`, `6 Months` → `6 month`, `12 Months` → `1 year`, `Local seller warranty` → `Seller Warranty`, `International Manufacturer Warranty` → `Brand Warranty`, `pcs` → `PCS`, `Mixed Color` → `Multicolor`, `As Picture` → `Same as picture`) → a close spelling (same words in another order, or one or two typos — only when one entry is clearly closest and every number is the same). Brands, units and warranty fields never use close spellings.

**While it runs** the progress box shows the AI line live: requests and tokens so far, the key and model in use, and requests left today; afterwards *What was done automatically* gives the run's requests and tokens.

**Check list — "Before you upload"** (on the page after processing, `utils/checks.js`): every check with its count, why it matters, and one click to the view that fixes it. Red = fix before uploading, amber = worth a look, green = done; the badge on top says **Ready to upload**, *Ready — n worth a look*, or *n things to fix*. The same counts are used in the review window and the sheet view.

| Check | Level | Opens |
|---|---|---|
| Variant values not on CartUp lists (Color, Size…) | fix | Review → By value, variant columns, not on list |
| Brands not on CartUp list | fix | Review → By value, Brand |
| Warranty values not on CartUp lists | fix | Review → By value, Warranty |
| Other values not on the lists (materials, unit…) | fix | Review → By value, other columns |
| Variants with the same values | fix | Review → By product, same variant |
| Rows without a CartUp category | fix | Sheet → No category |
| Required cells empty | fix | Sheet → Required — empty |
| Close-spelling matches (plus how many were matched automatically in all) | check | Review → By value, matched automatically (riskiest first) |
| Variants told apart only by a number (Multicolor-1, -2…) | fix | Sheet → Variants told apart by a number |
| Rows left out of the upload (no weight; with a key file, no image key) | fix | Sheet → Left out — no weight / no image key |
| Images missing (rows kept) | check | Sheet → Image missing (row kept) |
| Variant values set by rule (Not Specified / Same as picture / One Size) | check | Sheet → Set by rule |
| Variant columns marked "Yes" (Variations Combo option) | check | Sheet → Marked "Yes" |
| Names not cleaned by AI (AI unavailable — limit used up…) | check | Sheet → Names not cleaned by AI |
| Special price not below the price | check | Sheet → Special price not below the price |
| Kept as new values | info | Review → By value, kept as new |
| Rows with 0 stock (from the file, or set by the Stock option) | info | Sheet → Stock 0 |
| Special prices removed (75–99% discount, SKU kept) | info | Sheet → Special price removed |
| Rows left out (no name / price — invalid sheet, with the reason) | info | — |

**Review window — "Check & match values"** (opens by itself when values are left; or from the check list). Two views, both with filters: **column** (all, a group — variant columns / Brand / Warranty / other — or one column, with its open count), **state**, and **search**.
- **By value** — each seller value once, across all products: column, seller value, **the Seller SKU(s) using it (with a copy button — all of them, one per line)**, how many products and SKUs use it, and what it is now. States: *Not on list* · *Matched automatically* (close-spelling matches first — the ones worth a glance) · *Kept as new* · *All*. For an open value the closest CartUp values are shown as one-click chips; or **Keep as new**, **Pick…** (search the whole list, Enter takes the first), **No Brand** (Brand), **No Warranty** (Warranty Period), undo, and **Products ›** to see the products with that value. A pick here covers every SKU with that value and is remembered in this browser.
- **Quick fixes (By product)** — for a product whose variants need a look (a value not on the list, variants alike, numbered, size put in Color), a panel offers **complete ways to set that variant column for all its SKUs at once**, each with its values per SKU (green = on CartUp's list, amber = new value) — only for the column that has the trouble:
  - **The size** (L, S, M, XL) · **Colour and size** (Grey-L…) · **Part n of the combo** (the part that tells the variants apart — e.g. Left / Right, Vitamin C) · **The colour** · **First size of each range** (`37-39` → 37 (EU)) · **Numbered** (the list's real Grey-1, Grey-2…) · **As the seller wrote it** (new values such as *EU 42 M* — they go to the "new values" sheet for CartUp to add, #N/A until then)
  - Options that say what the variant is come first, numbering after them, new values last; a part is offered only when it is different for every SKU; the option the product has now is marked
  - **Use this** sets each SKU's value (a pick per SKU, logged; **Undo** takes it back); **Use for this + n similar products** applies the same kind of fix to every product of the same category and columns that needs a look (e.g. 87 braces at once)
  - Filter **Variants to check** lists those products; the check list's *Variants with the same values*, *Variants told apart only by a number* and *Size put in the Color column* open it. A fixed product stays in view until you pick another
- Gender words as Color values are matched to CartUp's spelling: *mail* → male, *Female* → Famale (as the list has it)
- **By product (Parent SKU)** — Seller SKU, Parent SKU and "Copy SKUs" (every SKU of the product) have copy buttons; products on the left (Parent SKU, SKU count, open values, "same variant"); states *Needs attention* · *Open values* · *Same variant* · *Changed automatically* · *All*; search by Parent SKU, Seller SKU, name or exact value. On the right the product's SKUs with their **variant images** (click to enlarge) and every dropdown value, coloured by state (red = not on CartUp's list, blue = matched automatically — with how: known equivalent, close spelling, numbered… — or remembered, green = picked, amber = kept as a new value); the filtered column is highlighted. Click a value to pick one of the **closest list values**, **search** the list, **keep the seller's value**, **No Brand** / **Set No Warranty**, or go back to automatic. Each pick applies to **this SKU**, **this product**, or **every SKU with that value** (the default, remembered — the footer shows how many, with "forget them"). After a pick the window jumps to the next open value in the filtered column. Keys: **1–8** pick a suggestion, **K** keep, **N** next, **Esc** close. **Large images** shows bigger variant images and the product's images 1–8.

**View & edit sheet** — the whole output, Excel-style (`components/SheetEditor.jsx`), laid out for one job — find what needs fixing and fix it:
- **Left — what to show:** *Needs attention*, *All rows*, then every problem type with its count — **To fix** (red: not on CartUp's list #N/A, no category, required and empty, numbered variants, left out for no weight / no image key) and **To check** (amber: image missing, special price removed or not below the price, value set by rule…) — and *Names not cleaned by AI*, *Stock 0*, *Edited by hand*, *Deleted rows*. **Columns:** show or hide each section of the template (Basic, Attributes, Description, Service, Delivery, Variant, Extra — with its problem count), or **only the columns with problems**.
- **Middle — the grid:** the template's section bands over the column headers (a column's red count shows only its problems); Seller SKU, row number and image fixed on the left; problem cells tinted with a coloured edge (red = fix, amber = check), edited cells with a blue dot; rows virtualised so thousands stay smooth. Search by Seller / Parent SKU or name. **Tick rows** (Shift-click for a range, or all shown) to **Delete from upload** (they go to the "invalid" sheet as *Deleted by hand*, and can be **restored**), or **Copy Seller SKUs**.
- **Right — the selected cell:** the row (image, Seller SKU and Parent SKU with copy buttons, name, combo), its problem in words, the value (Daraz name with "use it" for names), for dropdown columns whether it is on CartUp's list, the **closest CartUp values** and a **search of the whole list**, and **Same value for all SKUs of this product**. **Save & next** goes straight to the next problem.
- **Keys:** click a cell, ↑↓←→ move, **Enter** edits (Enter again saves and moves on; Ctrl+Enter in long text), **F8** / Shift+F8 next / previous problem, **Esc** closes.
- **Find & replace** — for hundreds of the same error at once: find a value (in every column or one; **whole cell** or part of it; match case; only the rows shown), see how many cells and rows match, and **Replace all** — each becomes a hand edit. A replacement that isn't on that column's CartUp list is warned about (#N/A).
- Edits are the last word on a value, logged as "Edited by hand", and survive a newer-template re-check.

**Step 3 — Output:** downloads at once when nothing needs a decision, otherwise from the review window ("Download file", also on the page).
- **With the CartUp template** (recommended): **the template itself, filled** — `cartup_daraz_output.xlsx`. Every sheet, column (ISBN/ISSN, Storage, Free Items… none is ever dropped), dropdown, Excel table and hidden `payload_hidden` formula of the template stays; the hidden formulas are calculated for the new rows (and Excel recalculates on open), so the file uploads as it is. **Report**, **Check** (YES = look at this row; the reason is in Report) and the seller's original **Variations Combo** go in the first free columns after the template's own; the tabs below follow its sheets. A hidden cell that comes out as an error (#N/A — a value not on a list) is listed in **to check**. More rows than the template holds (~5,000) → `cartup_daraz_output.zip` with several files, the variants of a product always in the same file.
- **Without the template:** the template's columns in its order (none left out), then Report, Check, CartUp category path, Variations Combo and status.

Tabs after the product sheet:
- **invalid** — SKUs left out, with the reason: no name, no price (MRP), no package weight, no CartUp image key (with a key file), deleted by hand in the sheet view, no Product ID / Seller SKU
- **changes** — every change, one row per Seller SKU and column: Seller SKU, Parent SKU, product, column, Daraz value, output value, what changed it (known equivalent, close spelling, numbered to keep variants apart, picked by hand, remembered pick, kept as new value, set by rule — Same as picture / One Size, name fixed by AI, "#" replaced, stock set by the Stock option, stock capped, special price removed, warranty rule, edited by hand, duplicate Seller SKU removed)
- **to check** — flagged: images missing or without a CartUp key, special prices removed or not below the price, rows left out for no weight / no key, hidden-sheet errors (#N/A)
- **new values** (with the template) — every value not on CartUp's lists, once each: column, value, status (*Add to the CartUp list — decided*, or *Not reviewed — shows #N/A until matched or added*), how many SKUs and products use it, the Seller SKUs, and the closest CartUp values
- **summary** — the report summary in one cell (A1, wrapped), the same text as on the page

---

## 3. Production — Manual Upload

Same as Daraz Upload but for a single manually-prepared file.

### Workflow

```
Download template → Fill in products → Upload → AI process → Download output
```

1. Click **Download Template** to get the input format
2. Required columns: **Name**, **Parent SKU**. Optional: Price, Color/Size (comma-separated — variants auto-expand), Highlights, Description, Brand, Image 1–8, Stock, Weight, etc.
3. Upload the filled file → **Process & Download** (the `template` sheet is read when there is one; Excel date cells become `YYYY-MM-DD`)
4. Color/Size values expand into one row per variant, with variant columns filled only when valid for the matched category
5. House rules as in Daraz Upload: `#` in names → `-`, stock never above 99,999, a **75%+ special price removed**; a special price not below the price and weights empty or starting with 0.00 are **noted** in the row's Report. A **repeated Seller SKU** goes to the "invalid" sheet (the first row is kept).
6. After processing the page shows a summary: rows written, rows in "invalid", rows without a category, and what the rules changed

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
- **Same stock for every row** (checkbox + number): e.g. `0` when the seller wants to upload with no stock; off = stock as in the export (never above 99,999). Each changed row is listed under **Changed values**
- House rules as in Daraz Upload: `#` in names → `-`, stock never above 99,999, *No Warranty* with a period → period removed, *Seller/Brand Warranty* without one → *No Warranty*, a weight starting with 0.00 (`0.001`–`0.009`) flagged as a warning — all listed under **Changed values**
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

Each product comes out once (a product repeated in the Basic file isn't doubled). A product in the SKU Image file but not in the Basic file is **kept** — marked "(not in the basic file)", without product images — instead of being dropped; the page shows how many, and how many rows have no variant image. The `template` sheet of a Daraz export is read when there is one.

---

## 5. QC (Quality Check)

**The QC team FLAGS products — it never edits them.** Sellers upload many products, so spelling/grammar checks are **lenient**: only clear, unprofessional errors get flagged. Output: an approval/reject file for the admin panel.

### Workflow

```
Upload Admin QC file → toggle checks → Run → review table (image/HTML previews,
manual flags, edit reports) → check variants manually → Download 2 output files
```

**Step 1 — Upload** the Admin QC export (.xlsx). Required: `ProductId`. The table shows 14 columns; rows dedupe by Product ID in **Unique-QC View**. A file without `ProductId` says which columns it has; missing columns are listed (those checks see them as empty).

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

**When the AI can't check a product** (today's limit used up, a bad answer…), it is **never passed as OK**: the table marks it *Not checked yet*, the Unique-QC View says "NOT CHECKED YET by AI: …", it is **left out of the QC Pass file**, and the checkpoint stays so **Continue** checks just those products. When the daily limit is used up the run stops at once instead of trying every batch. **Without a Gemini key** only the basic checks run (image, empty fields, weight, competitor and restricted words) — the page says so.

**Step 4 — Review in the table:**
- **All Products / Unique-QC View / Variant Check** view buttons
- Click an **image** → large viewer with Prev/Next arrows, flag button, comment box
- Click **View** on HL/Desc → rendered HTML preview (no raw tags) with Prev/Next + comment box. Seller HTML is cleaned first — scripts, event handlers (`onerror=…`) and `javascript:` links are removed, so product text can't run code in the app (same in Governance → Data Viz)
- **Pencil icon** on any report → edit issues manually (separate with `;`, empty = OK)
- **Filter** button → per-column text filters
- **Checkboxes + Remove Selected**, or **Remove by ID** (paste multiple IDs) → removed products are excluded from both outputs. Undo anytime.

**Step 5 — Variant Check tab:** shows only products whose Product ID repeats (= has variants). Rows are color-grouped per product (light blue / light yellow alternating). Mark each **OK** or **Issue** manually. AI checks keep running in the background while you work here.

**Step 6 — Download:**

| File | Contents |
|---|---|
| **Unique-QC View** | SL + the 14 columns + Report (all issues joined with `;`, or `OK`) |
| **QC Pass File** | `Seller ID \| Product ID \| Approval Status \| Product Tags \| Reject Reason` — Status **1** = all OK, **2** = rejected (all issues in Reject Reason). Products not checked yet are left out |

**Pause / Resume:** Pause stops after the current batch; progress saves to the browser (checkpoint). Re-upload the same file → Continue resumes exactly where it stopped. Uploading a *different* file wipes everything automatically and stops the old run (its results are ignored).

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

**When the AI can't do a batch:** the daily limit (or no key / network) **stops the run like a pause** — "Stopped — … Progress is saved" — and Resume continues from that batch. An answer that can't be read **keeps the product's original values** (never an empty Highlights / Description) and the Report column says so ("Highlights + Description: AI answer unreadable — original kept"); the page counts these products. A pass is skipped on Resume only when every product already has its result, so switching checks on or off between runs no longer skips the wrong pass. Every check here uses AI, so **Run is off without a Gemini key**.

---

## 7. Settings & Configuration

All settings persist in the browser (localStorage).

| Setting | Where | Default |
|---|---|---|
| Gemini API keys, models and limits, pause between requests, requests at the same time, per-minute guard | Profile & Settings | Gemini 3.5 Flash Lite → 3.1 Flash Lite → 2.5 Flash Lite, 1 s, 3, on |
| Word replacements (applies to Production output) — in the text only, never inside HTML tags or web links (Daraz-hosted images keep working); the found word's capitals are kept (`Daraz` → `Cartup`, `DARAZ` → `CARTUP`) | Profile & Settings | `daraz` → `cartup` |
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

### Gemini keys & models (Profile & Settings)
AI runs on **Gemini only** (Production, QC, Governance) — Grok and Groq were removed. `frontend/src/utils/aiPool.js`, card in `components/AiKeys.jsx`:
- **Today strip:** keys in use, requests used / capacity today, left today, tokens today, speed (≈ requests a minute) and the **daily reset** with a countdown. Free-tier limits reset at midnight Pacific time — **1:00 PM in Bangladesh** while the US is on summer time, **2:00 PM** in winter (shown in local time, so it is always right).
- **Models:** pick the **main model** from the list, each with its free-tier limits per key — Gemini 3.5 Flash Lite and 3.1 Flash Lite 15/min · 500/day; 3.8, 3.7, 3.6, 3.5, 3 and 2.5 Flash 5/min · 20/day; 2.5 Flash Lite 10/min · 20/day. Tick the **backup** models to use when the main one is full, and reorder them. **Edit limits** changes a model's numbers (Google changes them; paid keys have more). **Check models for my key** lists which models the first ticked key can use (others show *not available*) — a model Google publishes under a longer name (`gemini-3-flash` → `gemini-3-flash-preview`) is found and used automatically, never a different model (`-lite`). Add any other model name; **Defaults** goes back to 3.5 Flash Lite → 3.1 Flash Lite → 2.5 Flash Lite.
- **Keys:** *Tick = use here* — **All**, **None**, **Remove ticked**; each key shows *Key n*, the key (masked; **Show** for the full key), today's usage against its capacity (e.g. `280/1,000`, with a bar), and its state: ready / works / resting · back hh:mm (per-minute limit) / *n of m models used up today* / today's limit used / invalid. **Test**, "use it again now" and remove per key. **Click a key's usage** to enter the numbers **AI Studio** shows for each model — counts are kept per browser, so when the same key is used elsewhere (another app or browser) this keeps them right. **Import** a .txt / .csv (one key per line; `#` lines ignored; a label like `Key 1:` or a CSV column next to the key is fine) or a .json (keys anywhere in it); Grok/Groq keys are skipped. **Export** writes a .txt. **Clear** removes every key.
- **How requests are spread:** each request goes to the next ticked key that still has room on the main model (its per-minute and per-day count, kept per key and model in this browser); when every key is full on the main model, the next ticked model takes over. A 429 still from Google cools the key down for that model (until the next minute, or the next day for a daily quota); an invalid key is skipped for a day; a model that doesn't exist or is overloaded gives way to the next. When everything is used up for the day the run stops with a clear message, and Daraz Upload lists the products that got the spelling fix only (check list → *Names not cleaned by AI*).
- **Settings:** **Remember keys in this browser** (off = keys are kept only until the browser window closes), **Pause between requests** (seconds, default 1), **Requests at the same time** (1–10, default 3 — Daraz and Manual Upload) and **Stay under the per-minute limit automatically** (on; turn off only for paid keys with higher limits).
- The Daraz page shows the AI line before a run: main model, ticked keys, requests left today (≈ products, 5 per request), speed and the next reset; during the run the same line counts requests, tokens and the key in use.
- Keys, usage and cool-downs live in this browser only (usage is stored under a fingerprint of the key, not the key) — never on our server.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Old version showing after update | Hard refresh: `Ctrl+Shift+R` (check version in sidebar footer) |
| "Waking up the server…" / signed out in the morning | The sign-in server sleeps when idle. The app now waits for it (about a minute) and, with a saved profile, opens straight away — you are signed out only when the server says the sign-in is no longer valid |
| A Daraz file box is red | Read the line under it — usually the file is in the wrong box, or it is the CartUp template; the File check panel below lists files that don't match each other |
| "Rate limit" error | Daily or per-minute limit hit on every ticked key — add or tick more keys or backup models in Profile, or wait until the reset time shown there; progress is saved |
| Selecting a file does nothing | Fixed in v25.6.30+ — hard refresh. All inputs accept re-selecting the same filename |
| New file shows old data | Fixed — uploading a new file wipes all previous state and stops running checks |
| Paused, want to continue later | Re-upload the **same** file (same name + size) → Continue/Resume button appears |
| Category obviously wrong | Check the Report/Note column — low-confidence picks are labelled for manual review. Add a context hint (QC) to improve accuracy |
| AI checks skipped | No Gemini key ticked — add or tick one in Profile & Settings |
| Output missing products | Check the `invalid` sheet — every row there says why (no Product ID, Seller SKU, name, price or image; repeated Seller SKU) |

---

*Everything runs client-side in your browser — files are never uploaded to any server except product text sent to the Gemini API for AI processing.*

import io
import os
import pandas as pd
from bs4 import BeautifulSoup
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

# ── Reference file paths ───────────────────────────────────────────────────
BASE = os.path.dirname(os.path.dirname(__file__))
REF  = os.path.join(BASE, "reference-files")

CAT_MAP_PATH    = os.path.join(REF, "daraz_and_cartup_category_mapping.xlsx")
CARTUP_CAT_PATH = os.path.join(REF, "category_mapping.xlsx")
VAR_MATCH_PATH  = os.path.join(REF, "Category_wise_varints.xlsx")

# ── Static lookups (loaded once) ───────────────────────────────────────────
MANUAL_CAT_MAP = {
    '10000860': '4681', '10000866': '4681', '10000887': '4681',
    '10002020': '4660', '10121':    '4690',
}
MYSTERY_CATIDS = {'20000359'}

VARIANT_COLS = [
    'Clothing Materials','Shoe Material','Bag Material','Dial Materials',
    'Strap Materials','Main Materials','Recommended Age','Watch TYespe',
    'Clothing Size','Age Group','Shoe Size','Size','Color','Bedding Size','Model'
]

SECTIONS = [
    ('Basic Information',   'D9E1F2', 15),
    ('Product Attribute',   'E2EFDA', 8),
    ('Product Description', 'FCE4D6', 5),
    ('Service',             'FFF2CC', 4),
    ('Delivery',            'DDEBF7', 4),
    ('Variant Attribute',   'F2F2F2', 11),
    ('Extra',               'EDEDED', 4),
]

def _load_references():
    cat_map    = pd.read_excel(CAT_MAP_PATH, dtype=str)
    cartup_cat = pd.read_excel(CARTUP_CAT_PATH, dtype=str)
    var_match  = pd.read_excel(VAR_MATCH_PATH, sheet_name='Variations matching', dtype=str)

    daraz_to_cartup = dict(zip(cat_map['Daraz Category ID'].str.strip(), cat_map['Cartup Category ID'].str.strip()))
    daraz_to_cartup.update(MANUAL_CAT_MAP)
    cartup_to_path = dict(zip(cartup_cat['Cartup Category ID'].str.strip(), cartup_cat['Cartup Category Path'].str.strip()))
    cartup_to_tags = dict(zip(cartup_cat['Cartup Category ID'].str.strip(), cartup_cat.iloc[:,2].str.strip()))

    cat_variant_map = {}
    for col in VARIANT_COLS:
        if col not in var_match.columns: continue
        col_idx = var_match.columns.get_loc(col)
        status_col = var_match.columns[col_idx + 1]
        for _, row in var_match.iterrows():
            cat_id = str(row[col]).strip() if pd.notna(row[col]) else ''
            status = str(row[status_col]).strip() if pd.notna(row[status_col]) else ''
            if cat_id and status.lower() == 'yes':
                cat_variant_map.setdefault(cat_id, set()).add(col)

    return daraz_to_cartup, cartup_to_path, cartup_to_tags, cat_variant_map

def _build_brand_dict(attr_bytes):
    if not attr_bytes: return {}
    brand_dict = {}
    attr_raw = pd.read_excel(io.BytesIO(attr_bytes), sheet_name=None, dtype=str, header=1)
    for sheet_name, df in attr_raw.items():
        if sheet_name == 'INDEX': continue
        pid_col   = next((c for c in df.columns if 'Product ID' in str(c)), None)
        brand_col = next((c for c in df.columns if 'Brand' in str(c)), None)
        if not pid_col or not brand_col: continue
        for _, row in df.iterrows():
            pid   = str(row[pid_col]).strip() if pd.notna(row[pid_col]) else ''
            brand = str(row[brand_col]).strip() if pd.notna(row[brand_col]) else ''
            if pid and pid not in brand_dict:
                brand_dict[pid] = brand if brand and brand != 'nan' else 'No Brand'
    return brand_dict

def _val(x):
    return '' if pd.isna(x) or str(x).strip() == 'nan' else str(x).strip()

def _clean_highlights(html):
    if not html or str(html).strip() in ('', 'nan'): return ''
    soup = BeautifulSoup(str(html), 'html.parser')
    for img in soup.find_all('img'): img.decompose()
    items = [f'<li>{li.get_text(strip=True)}</li>' for li in soup.find_all('li') if li.get_text(strip=True)]
    if items: return '<ul>' + ''.join(items) + '</ul>'
    lines = [l for l in soup.get_text(separator='\n', strip=True).split('\n') if l]
    return '<ul>' + ''.join(f'<li>{l}</li>' for l in lines) + '</ul>' if lines else ''

def _clean_description(html):
    if not html or str(html).strip() in ('', 'nan'): return ''
    soup = BeautifulSoup(str(html), 'html.parser')
    for img in soup.find_all('img'): img.decompose()
    paras = [f'<p>{p.get_text(strip=True)}</p>' for p in soup.find_all(['p','pre']) if p.get_text(strip=True)]
    if paras: return ''.join(paras)
    text = soup.get_text(separator=' ', strip=True)
    return f'<p>{text}</p>' if text else ''

def _parse_variations(combo, applicable):
    result = {c: '' for c in VARIANT_COLS}
    if not combo or str(combo).strip() in ('', 'nan'): return result
    parts = [p.strip() for p in str(combo).split(',', 1)]
    color    = parts[0]
    size_val = parts[1] if len(parts) > 1 else 'Yes'
    if 'Color' in applicable: result['Color'] = color
    if size_val:
        if 'Shoe Size' in applicable:       result['Shoe Size'] = size_val
        elif 'Clothing Size' in applicable: result['Clothing Size'] = size_val
        elif 'Bedding Size' in applicable:  result['Bedding Size'] = size_val
        elif 'Size' in applicable:          result['Size'] = size_val
        else:                               result['Size'] = size_val
    return result

def _build_excel(output_rows):
    cols = list(output_rows[0].keys())
    wb = Workbook()
    ws = wb.active
    ws.title = 'product'

    # Section header row
    sec_row = []
    for name_s, color, span in SECTIONS:
        sec_row.extend([name_s] + [''] * (span - 1))
    ws.append(sec_row)

    col_pos = 1
    for name_s, color, span in SECTIONS:
        for i in range(span):
            c = ws.cell(row=1, column=col_pos + i)
            c.fill = PatternFill('solid', start_color=color)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal='center')
        if span > 1:
            ws.merge_cells(start_row=1, start_column=col_pos, end_row=1, end_column=col_pos + span - 1)
        col_pos += span

    # Column header row
    ws.append(cols)
    for ci, col in enumerate(cols, 1):
        c = ws.cell(row=2, column=ci)
        c.fill = PatternFill('solid', start_color='D9D9D9')
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal='center', wrap_text=True)

    # Data rows
    for r in output_rows:
        ws.append([r.get(c, '') for c in cols])

    # Color Report column
    report_col_idx = cols.index('Report') + 1
    for row_i in range(3, len(output_rows) + 3):
        cell = ws.cell(row=row_i, column=report_col_idx)
        v = str(cell.value or '')
        if v == 'OK':
            cell.fill = PatternFill('solid', start_color='E2EFDA')
            cell.font = Font(color='375623')
        elif 'Mystery' in v:
            cell.fill = PatternFill('solid', start_color='FCE4D6')
            cell.font = Font(color='9C0006', bold=True)
        elif 'Manually' in v:
            cell.fill = PatternFill('solid', start_color='FFF2CC')
            cell.font = Font(color='7F6000')
        elif 'No category' in v:
            cell.fill = PatternFill('solid', start_color='FFDCE1')
            cell.font = Font(color='9C0006')

    for ci in range(1, len(cols) + 1):
        ws.column_dimensions[get_column_letter(ci)].width = 20
    ws.column_dimensions['C'].width = 50
    ws.column_dimensions['D'].width = 50
    ws.column_dimensions[get_column_letter(report_col_idx)].width = 45
    ws.freeze_panes = 'A3'
    ws.row_dimensions[2].height = 30

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

def process_daraz_files(price_b, basic_b, weight_b, skuimg_b, attr_b=None):
    daraz_to_cartup, cartup_to_path, cartup_to_tags, cat_variant_map = _load_references()
    brand_dict = _build_brand_dict(attr_b)

    price   = pd.read_excel(io.BytesIO(price_b),  sheet_name='template', dtype=str)
    basic   = pd.read_excel(io.BytesIO(basic_b),  sheet_name='template', dtype=str)
    freight = pd.read_excel(io.BytesIO(weight_b), sheet_name='template', dtype=str)
    skuimg  = pd.read_excel(io.BytesIO(skuimg_b), sheet_name='template', dtype=str)

    basic_dict   = basic.drop_duplicates('Product ID').set_index('Product ID').to_dict('index')
    freight_dict = freight.drop_duplicates('Product ID').set_index('Product ID').to_dict('index')
    skuimg_dict  = skuimg.set_index('SellerSKU').to_dict('index')
    warranty_type_col = '*Warranty Type' if '*Warranty Type' in basic.columns else 'Warranty Type'

    output_rows = []
    for _, row in price.iterrows():
        pid   = _val(row['Product ID'])
        cat   = _val(row['catId'])
        name  = _val(row['*Product Name(English)'])
        sku   = _val(row['SellerSKU'])
        combo = _val(row.get('Variations Combo', ''))

        brand = brand_dict.get(pid, 'No Brand')
        if not brand or brand in ('', 'nan'): brand = 'No Brand'

        is_mystery  = cat in MYSTERY_CATIDS
        report_note = ''

        if is_mystery:
            cartup_id = cartup_path = tags = ''
            report_note = 'Mystery/Surprise Box — no category. Manual review needed.'
        else:
            cartup_id   = daraz_to_cartup.get(cat, '')
            cartup_path = cartup_to_path.get(cartup_id, '')
            tags        = cartup_to_tags.get(cartup_id, '')
            if not cartup_id:
                report_note = f'No category match for Daraz catId={cat}'
            elif cat in MANUAL_CAT_MAP:
                report_note = f'Manually mapped (Daraz catId={cat})'
            else:
                report_note = 'OK'

        applicable = cat_variant_map.get(cartup_id, set())

        b = basic_dict.get(pid, {})
        highlights  = _clean_highlights(_val(b.get('*Highlights', '')))
        description = _clean_description(_val(b.get('Main Description', '')))

        if not highlights and not description:
            highlights  = f'<ul><li>{name}</li></ul>'
            description = f'<p>{name}</p>'
        elif not highlights:
            text = BeautifulSoup(description, 'html.parser').get_text(strip=True)
            highlights = f'<ul><li>{name}</li><li>{text[:200]}</li></ul>'
        elif not description:
            text = BeautifulSoup(highlights, 'html.parser').get_text(separator=' ', strip=True)
            description = f'<p>{name}. {text[:300]}</p>'

        f = freight_dict.get(pid, {})
        s = skuimg_dict.get(sku, {})
        images = [_val(b.get('*Product Images1' if i==1 else f'Product Images{i}', '')) for i in range(1, 9)]
        vr = _parse_variations(combo, applicable)
        warranty_policy = _val(b.get('Warranty Policy', ''))

        output_rows.append({
            '**Category Id':            cartup_id,
            '**Name (English)':         name,
            'Name (Bengali)':           name,
            '**Product Image 1':        images[0], 'Product Image 2': images[1],
            'Product Image 3':          images[2], 'Product Image 4': images[3],
            'Product Image 5':          images[4], 'Product Image 6': images[5],
            'Product Image 7':          images[6], 'Product Image 8': images[7],
            'VideoUrl':                 '',
            '**Brand':                  brand,
            '**Unit':                   'pcs',
            'Tags':                     tags,
            'Clothing Materials':       vr['Clothing Materials'],
            'Shoe Material':            vr['Shoe Material'],
            'Bag Material':             vr['Bag Material'],
            'Dial Materials':           vr['Dial Materials'],
            'Strap Materials':          vr['Strap Materials'],
            'Recommended Age':          vr['Recommended Age'],
            'Watch Type':               vr['Watch TYespe'],
            'Main Materials':           vr['Main Materials'],
            'Highlights(English)':      highlights,
            'Highlights(Bengali)':      highlights,
            'Description (Bengali)':    description,
            'Description (English)':    description,
            "What's in the box":        f'1* {name}',
            'Warranty Policy(English)': warranty_policy,
            'Warranty Policy(Bangla)':  warranty_policy,
            'Warranty Type':            _val(b.get(warranty_type_col, '')),
            'Warranty Period':          _val(b.get('Warranty', '')),
            '**Package Weight (kg)':    _val(f.get('*Package Weight (kg)', '')),
            '**Package Length(cm)':     _val(f.get('*Package Length (cm)', '')),
            '*Package Width (cm)':      _val(f.get('*Package Width (cm)', '')),
            '*Package Height(cm)':      _val(f.get('*Package Height (cm)', '')),
            'Clothing Size':            vr['Clothing Size'],
            'Color':                    vr['Color'],
            'Model':                    vr['Model'],
            'Age Group':                vr['Age Group'],
            'Size':                     vr['Size'],
            'Shoe Size':                vr['Shoe Size'],
            'Bedding Size':             vr['Bedding Size'],
            '**Seller SKU':             sku,
            '**Parent Sku':             pid,
            '*Variant Image':           _val(s.get('Images1', '')),
            '**Current Stock Qty':      _val(row.get('*Quantity', '')),
            'status':                   _val(row.get('status', '')),
            'Cartup Category Path':     cartup_path,
            'Variations Combo':         combo,
            'Report':                   report_note,
        })

    return _build_excel(output_rows)

def process_manual_upload(input_bytes):
    # Manual upload processing (AI-powered content fix)
    # Placeholder — full logic comes in next phase
    df = pd.read_excel(io.BytesIO(input_bytes), dtype=str)
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()

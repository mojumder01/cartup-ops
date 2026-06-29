from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import io
from services.production_service import process_daraz_files, process_manual_upload
from utils.supabase_client import get_supabase

router = APIRouter()
security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    supabase = get_supabase()
    try:
        user = supabase.auth.get_user(credentials.credentials)
        return user.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

@router.post("/daraz-upload")
async def daraz_upload(
    price_file:    UploadFile = File(...),
    basic_file:    UploadFile = File(...),
    weight_file:   UploadFile = File(...),
    skuimg_file:   UploadFile = File(...),
    attr_file:     Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user)
):
    try:
        price_bytes  = await price_file.read()
        basic_bytes  = await basic_file.read()
        weight_bytes = await weight_file.read()
        skuimg_bytes = await skuimg_file.read()
        attr_bytes   = await attr_file.read() if attr_file else None

        output_bytes = process_daraz_files(
            price_bytes, basic_bytes, weight_bytes, skuimg_bytes, attr_bytes
        )

        return StreamingResponse(
            io.BytesIO(output_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=cartup_output.xlsx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/manual-upload")
async def manual_upload(
    input_file: UploadFile = File(...),
    current_user=Depends(get_current_user)
):
    try:
        input_bytes  = await input_file.read()
        output_bytes = process_manual_upload(input_bytes)

        return StreamingResponse(
            io.BytesIO(output_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=cartup_manual_output.xlsx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

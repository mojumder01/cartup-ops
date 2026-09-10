from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from utils.supabase_client import get_supabase

try:
    from gotrue.errors import AuthApiError
except Exception:
    AuthApiError = None

router = APIRouter()
security = HTTPBearer()

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
async def login(req: LoginRequest):
    try:
        supabase = get_supabase()
    except RuntimeError as e:
        # Missing/misconfigured SUPABASE_URL / SUPABASE_KEY — not a bad password.
        raise HTTPException(status_code=500, detail=f"Server misconfigured: {e}")

    try:
        res = supabase.auth.sign_in_with_password({
            "email": req.email,
            "password": req.password
        })
        user = res.user
        session = res.session
        return {
            "access_token": session.access_token,
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.user_metadata.get("name", ""),
                "role": user.user_metadata.get("role", "member"),
                "team": user.user_metadata.get("team", ""),
            }
        }
    except Exception as e:
        # Only a genuine "wrong email/password" response from Supabase should
        # ever surface as 401. Anything else (paused Supabase project, wrong
        # keys, network failure, quota) is a SERVER problem — reporting it as
        # "Invalid credentials" would wrongly tell a user with a correct
        # password that they typed it wrong.
        if AuthApiError is not None and isinstance(e, AuthApiError) and getattr(e, "status", None) in (400, 401, 422):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        raise HTTPException(status_code=500, detail=f"Login failed: {type(e).__name__}: {e}")

@router.post("/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    supabase = get_supabase()
    supabase.auth.sign_out()
    return {"message": "Logged out"}

@router.get("/me")
async def get_me(credentials: HTTPAuthorizationCredentials = Depends(security)):
    supabase = get_supabase()
    try:
        user = supabase.auth.get_user(credentials.credentials)
        return {
            "id": user.user.id,
            "email": user.user.email,
            "name": user.user.user_metadata.get("name", ""),
            "role": user.user.user_metadata.get("role", "member"),
            "team": user.user.user_metadata.get("team", ""),
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

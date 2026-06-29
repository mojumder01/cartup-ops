from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from utils.supabase_client import get_supabase

router = APIRouter()
security = HTTPBearer()

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
async def login(req: LoginRequest):
    supabase = get_supabase()
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
        raise HTTPException(status_code=401, detail="Invalid credentials")

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

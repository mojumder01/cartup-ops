from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import httpx
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

# Grok (xAI) and Groq (groqcloud) both block direct browser fetch() calls
# (no CORS headers on their API) so the frontend can't reach them client-side
# like it does with Gemini. This endpoint relays the prompt server-side using
# the user's own key — the key is passed through per-request only, nothing is
# stored on the backend.
PROVIDER_CONFIG = {
    "grok": {
        "url": "https://api.x.ai/v1/chat/completions",
        "model": "grok-4-fast-non-reasoning",
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "model": "llama-3.3-70b-versatile",
    },
}

class ProxyRequest(BaseModel):
    provider: str
    api_key: str
    prompt: str

@router.post("/proxy")
async def ai_proxy(req: ProxyRequest, current_user=Depends(get_current_user)):
    cfg = PROVIDER_CONFIG.get(req.provider)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")
    if not req.api_key:
        raise HTTPException(status_code=400, detail="Missing API key")

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                cfg["url"],
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {req.api_key}",
                },
                json={
                    "model": cfg["model"],
                    "temperature": 0.1,
                    "messages": [{"role": "user", "content": req.prompt}],
                },
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")

    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="Rate limit — please wait and retry")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"{req.provider} error: {resp.status_code} {resp.text[:200]}")

    data = resp.json()
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {"text": text}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, production, ai_proxy

app = FastAPI(title="CartUp Ops API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(production.router, prefix="/production", tags=["production"])
app.include_router(ai_proxy.router, prefix="/ai", tags=["ai"])

@app.get("/")
def root():
    return {"status": "CartUp Ops API running"}

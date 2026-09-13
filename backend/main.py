import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from routers import auth, production, ai_proxy

app = FastAPI(title="CartUp Ops API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Any exception that escapes a route (not just the ones each router already
# catches) lands here instead of Starlette's bare "Internal Server Error"
# text — so the real cause is visible in the response body, not just in
# Render's logs.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print(f"UNHANDLED: {type(exc).__name__}: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(production.router, prefix="/production", tags=["production"])
app.include_router(ai_proxy.router, prefix="/ai", tags=["ai"])

@app.get("/")
def root():
    return {"status": "CartUp Ops API running"}

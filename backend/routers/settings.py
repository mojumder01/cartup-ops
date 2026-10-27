"""Team settings: data and rules the team edits from the frontend (Settings
page) instead of in code — category attributes, Daraz → CartUp categories,
CartUp categories, rules & defaults. One row per key in app_settings
(Supabase); every change, restore and reset is also kept in
app_settings_history, so it can be seen and undone. Any signed-in user may
read and change them. Tables: backend/sql/app_settings.sql.

A save names the version it started from; if someone saved in between, it is
refused (409) instead of overwriting their change.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from supabase import create_client

from utils.supabase_client import get_supabase

router = APIRouter()
security = HTTPBearer()

KEYS = {"category_attributes", "daraz_categories", "cartup_categories", "rules"}
MAX_BYTES = 8 * 1024 * 1024
SETUP = "Team settings are not set up yet — run backend/sql/app_settings.sql once in Supabase (SQL Editor)"


class Store:
    """The two tables, as the signed-in user (row-level security applies)."""

    def __init__(self, db):
        self.db = db

    def _run(self, query):
        try:
            return query.execute().data
        except Exception as e:  # a missing table reads as "not set up", anything else as itself
            text = str(e)
            if "app_settings" in text and ("does not exist" in text or "PGRST205" in text or "schema cache" in text):
                raise HTTPException(status_code=503, detail=SETUP)
            raise HTTPException(status_code=500, detail=f"Settings: {type(e).__name__}: {e}")

    def list(self):
        return self._run(self.db.table("app_settings").select("key,version,updated_at,updated_by"))

    def get(self, key):
        rows = self._run(self.db.table("app_settings").select("*").eq("key", key))
        return rows[0] if rows else None

    def insert(self, row):
        return self._run(self.db.table("app_settings").insert(row))

    def update(self, key, version, row):
        # Only if nobody saved since `version` was read.
        return self._run(self.db.table("app_settings").update(row).eq("key", key).eq("version", version))

    def delete(self, key):
        return self._run(self.db.table("app_settings").delete().eq("key", key))

    def add_history(self, row):
        return self._run(self.db.table("app_settings_history").insert(row))

    def history(self, key, limit=50):
        return self._run(self.db.table("app_settings_history").select("id,version,changed_at,changed_by,note")
                         .eq("key", key).order("id", desc=True).limit(limit))

    def history_value(self, key, hid):
        rows = self._run(self.db.table("app_settings_history").select("value,version").eq("key", key).eq("id", hid))
        return rows[0] if rows else None


def signed_in(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        user = get_supabase().auth.get_user(credentials.credentials).user
    except Exception:
        user = None
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    db.postgrest.auth(credentials.credentials)
    return {"who": user.email or user.id, "store": Store(db)}


def known(key: str):
    if key not in KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown setting: {key}")
    return key


def check_value(key: str, value: Any):
    """The shape each key must have — a broken upload must not reach everyone."""
    def fail(why):
        raise HTTPException(status_code=422, detail=f"{key}: {why}")
    if len(json.dumps(value)) > MAX_BYTES:
        fail("too large")
    if key == "category_attributes":
        if not isinstance(value, dict) or not all(isinstance(v, list) and all(isinstance(a, str) for a in v) for v in value.values()):
            fail("expected { category id: [attribute, …] }")
    elif key == "cartup_categories":
        if not isinstance(value, dict) or not all(isinstance(v, dict) and isinstance(v.get("path"), str) for v in value.values()):
            fail("expected { category id: { path, tags } }")
    elif key == "daraz_categories":
        if not isinstance(value, dict) or not isinstance(value.get("map"), dict) or not all(isinstance(v, str) for v in value["map"].values()):
            fail("expected { map: { Daraz category: CartUp category }, mystery: [], manual: [] }")
    elif key == "rules":
        if not isinstance(value, dict):
            fail("expected { rule: value }")


def _now():
    return datetime.now(timezone.utc).isoformat()


def meta(row):
    return {k: row.get(k) for k in ("key", "version", "updated_at", "updated_by")}


class SaveRequest(BaseModel):
    value: Any
    base_version: int = 0   # the version the change started from (0: built-in, never saved)
    note: str = ""


@router.get("")
def list_settings(user=Depends(signed_in)):
    """Every saved key's version (no values) — the frontend fetches only what changed."""
    return [meta(r) for r in user["store"].list()]


@router.get("/{key}")
def get_setting(key: str = Depends(known), user=Depends(signed_in)):
    row = user["store"].get(key)
    if not row:
        raise HTTPException(status_code=404, detail="Not saved yet — the built-in copy is used")
    return {**meta(row), "value": row["value"]}


def write(store, key, value, base_version, who, note):
    """Saves a new version (or refuses with 409 if someone saved since base_version)."""
    current = store.get(key)
    now_version = current["version"] if current else 0
    if base_version != now_version:
        raise HTTPException(status_code=409, detail={"message": "Changed by someone else since you opened it — load the new version first",
                                                     "current": meta(current) if current else None})
    row = {"value": value, "version": now_version + 1, "updated_by": who, "updated_at": _now()}
    if current:
        if not store.update(key, now_version, row):
            raise HTTPException(status_code=409, detail={"message": "Changed by someone else just now — load the new version first", "current": None})
    else:
        try:
            store.insert({"key": key, **row})
        except HTTPException as e:
            if e.status_code == 500 and "duplicate" in str(e.detail).lower():
                raise HTTPException(status_code=409, detail={"message": "Saved by someone else just now — load the new version first", "current": None})
            raise
    store.add_history({"key": key, "value": value, "version": now_version + 1, "changed_by": who, "note": note[:500]})
    return meta(store.get(key))




@router.put("/{key}")
def save_setting(req: SaveRequest, key: str = Depends(known), user=Depends(signed_in)):
    check_value(key, req.value)
    return write(user["store"], key, req.value, req.base_version, user["who"], req.note or "Saved")


@router.get("/{key}/history")
def setting_history(key: str = Depends(known), user=Depends(signed_in)):
    rows = user["store"].history(key)
    return [{"id": r["id"], "version": r["version"], "changed_at": r["changed_at"], "changed_by": r["changed_by"], "note": r["note"]} for r in rows]


class RestoreRequest(BaseModel):
    base_version: int = 0


@router.post("/{key}/restore/{hid}")
def restore_setting(hid: int, req: RestoreRequest, key: str = Depends(known), user=Depends(signed_in)):
    old = user["store"].history_value(key, hid)
    if not old:
        raise HTTPException(status_code=404, detail="No such version")
    if old["value"] is None:   # that version was a reset to the built-in copy
        return reset_setting(req, key, user)
    return write(user["store"], key, old["value"], req.base_version, user["who"], f"Restored version {old['version']}")


@router.post("/{key}/reset")
def reset_setting(req: RestoreRequest, key: str = Depends(known), user=Depends(signed_in)):
    """Back to the copy built into the app: the saved row goes, history keeps a note."""
    store = user["store"]
    current = store.get(key)
    if not current:
        return {"key": key, "version": 0, "updated_at": None, "updated_by": None}
    if req.base_version != current["version"]:
        raise HTTPException(status_code=409, detail={"message": "Changed by someone else since you opened it — load the new version first", "current": meta(current)})
    store.delete(key)
    store.add_history({"key": key, "value": None, "version": current["version"] + 1, "changed_by": user["who"], "note": "Reset to the built-in copy"})
    return {"key": key, "version": 0, "updated_at": None, "updated_by": None}

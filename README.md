# CartUp Ops Platform

Team operations platform for CartUp — Production, QC, Visual, Governance.

## Project Structure

```
cartup-ops/
├── backend/                  # FastAPI Python backend
│   ├── main.py
│   ├── requirements.txt
│   ├── routers/
│   │   ├── auth.py           # Login/logout
│   │   └── production.py     # Daraz & manual upload
│   ├── services/
│   │   └── production_service.py  # Core processing logic
│   ├── utils/
│   │   └── supabase_client.py
│   └── reference-files/      # Category mapping Excel files
├── frontend/                 # React frontend (coming next)
├── render.yaml               # Render deploy config
└── .github/workflows/        # Auto-deploy on push
```

## Deploy Steps

### 1. GitHub Setup
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/cartup-ops.git
git push -u origin main
```

### 2. Supabase Setup
- Go to https://supabase.com → New project
- Copy **Project URL** and **anon/public key**
- Create users manually: Authentication → Users → Invite user

### 3. Render Setup
- Go to https://render.com → New Web Service
- Connect GitHub repo
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Add environment variables:
  - `SUPABASE_URL` = your Supabase project URL
  - `SUPABASE_KEY` = your Supabase anon key

### 4. Get Render Deploy Hook
- Render dashboard → your service → Settings → Deploy Hook
- Copy URL → GitHub repo → Settings → Secrets → `RENDER_DEPLOY_HOOK`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login with email/password |
| GET | `/auth/me` | Get current user |
| POST | `/production/daraz-upload` | Process 4-5 Daraz files → Excel |
| POST | `/production/manual-upload` | Process manual Excel |

## Environment Variables

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGci...
```

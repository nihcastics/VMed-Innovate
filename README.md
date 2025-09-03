```markdown
# 💉 InsulinMate

InsulinMate is a full-stack diabetes management app built with **Next.js + FastAPI + PostgreSQL**.  
It helps patients track insulin doses, get AI-backed safety checks, set reminders, and view logs.

---

## 🚀 Features
- Track insulin doses (bolus/basal)
- AI dosage safety advice (Google Gemini)
- Patient registration & login with JWT cookies
- History logs & CSV export
- Reminder scheduling with timezone support

---

## ⚙️ Tech Stack
- **Frontend:** Next.js 15 (App Router, TailwindCSS, TypeScript)  
- **Backend:** FastAPI (Python 3.11)  
- **Database:** PostgreSQL 17  
- **AI:** Google Gemini API  
- **Auth:** Secure JWT cookies (`jose`)  

---

## 📂 Structure
```

pharmora/
├── src/app/             # Next.js pages & API routes
│   ├── page.tsx         # Dashboard
│   ├── auth/page.tsx    # Login/Register
│   └── api/             # Auth + proxy routes
├── src/lib/             # DB, JWT, context helpers
├── python\_backend/      # FastAPI backend
│   ├── main.py
│   └── shot\_advisor.py
└── .env / .env.local    # Config

````

---

## 🛠️ Setup

1. **Clone repo**
```bash
git clone https://github.com/yourusername/pharmora.git
cd pharmora
````

2. **Frontend**

```bash
npm install
npm run dev
```

3. **Backend**

```bash
cd python_backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

4. **Database**

* Run PostgreSQL 17+
* Create DB: `inter`
* Connection string in `.env.local` and `python_backend/.env`

---

## 🔑 Env Vars

**.env.local (Next.js)**

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/inter
AUTH_SECRET=supersecretlongrandom
PY_BACKEND=http://127.0.0.1:8001
GEMINI_API_KEY=your_gemini_api_key
```

**python\_backend/.env**

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=inter
PGUSER=postgres
PGPASSWORD=password
GEMINI_API_KEY=your_gemini_api_key
```

---

## 🧪 Usage

* Visit `/auth` → Register or Login
* Redirects to `/` Dashboard:

  * Last dose time
  * AI safety check (`SAFE` / `WAIT`)
  * Log doses
  * Set reminders
* Visit `/history-logs` → View & export logs

---

## ⚠️ Disclaimer

This app **assists** diabetes management. Always confirm with a licensed clinician before making medical decisions.

---

## 📜 License

MIT — free to use and modify.

```

---  
Do you want me to also add a **screenshots/demo section** (for hackathon judges), or keep it clean like this?
```

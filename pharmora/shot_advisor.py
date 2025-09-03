import os
import json
from datetime import datetime
from zoneinfo import ZoneInfo
import psycopg
from dotenv import load_dotenv

# Load .env (must contain GEMINI_API_KEY=...)
load_dotenv()

# Gemini
try:
    import google.generativeai as genai
except Exception:  # library missing
    genai = None

# ── DB config (match insulinmate.py) ─────────────────────────────
DB = dict(
    host="localhost", port=5432, dbname="inter",
    user="postgres", password="ashu5995", sslmode="disable",
)

def _conn():
    return psycopg.connect(**DB)

def _fetch_context(user_id: int) -> dict:
    """Grab patient & last few logs to give the model context."""
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT full_name, time_zone, primary_basal_insulin_type, primary_bolus_insulin_type
            FROM patients WHERE user_id=%s
        """, (user_id,))
        prow = cur.fetchone()

        cur.execute("""
            SELECT timestamp_utc, insulin_type, units_taken, purpose, dose_context, COALESCE(remarks,'')
            FROM insulin_logs
            WHERE user_id=%s
            ORDER BY timestamp_utc DESC
            LIMIT 12
        """, (user_id,))
        logs = cur.fetchall()

    patient = None
    if prow:
        patient = dict(
            full_name=prow[0],
            time_zone=prow[1] or "UTC",
            basal_type=prow[2],
            bolus_type=prow[3],
        )

    hist = []
    for ts, itype, units, purpose, ctx, rem in logs:
        hist.append(dict(
            timestamp_utc=ts.isoformat(),
            insulin_type=itype,
            units_taken=float(units),
            purpose=purpose,
            dose_context=ctx,
            remarks=rem,
        ))
    return dict(patient=patient, history=hist)

def _model():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    # Fast/light model; swap if you prefer
    return genai.GenerativeModel("gemini-2.5-flash")

def get_insulin_timing_advice(user_id: int, proposed_units: float, remarks: str, now_iso: str) -> dict:
    """
    Returns dict like:
      {"recommendation":"take_now"|"wait",
       "wait_minutes": 0|int,
       "reason":"short explanation"}
    Falls back to 'take_now' if model unavailable.
    """
    ctx = _fetch_context(user_id)
    patient = ctx.get("patient") or {}
    history = ctx.get("history") or []

    model = _model()
    if model is None:
        return {
            "recommendation": "take_now",
            "wait_minutes": 0,
            "reason": "AI unavailable; defaulting to proceed.",
        }

    prompt = {
        "instruction": (
            "You are a diabetes assistant. Decide if the user should take an insulin shot RIGHT NOW "
            "or WAIT for some time. Consider recent dosing history and the proposed units.\n"
            "If recent similar insulin was taken very recently, suggest waiting.\n"
            "IMPORTANT: Return ONLY valid JSON with keys: recommendation (take_now|wait), "
            "wait_minutes (integer), reason (short, patient-friendly).\n"
        ),
        "now_local_iso": now_iso,
        "patient": patient,
        "proposed_shot": {
            "units": proposed_units,
            "remarks": remarks,
        },
        "recent_logs": history,
    }

    try:
        resp = model.generate_content(
            f"Analyze this JSON and respond ONLY with JSON:\n{json.dumps(prompt, separators=(',',':'))}"
        )
        text = resp.text.strip()

        # Model may wrap code fences; strip them
        if text.startswith("```"):
            text = text.strip("` \n")
            if text.lower().startswith("json"):
                text = text[4:].strip()

        data = json.loads(text)

        rec = str(data.get("recommendation", "take_now")).lower()
        if rec not in ("take_now", "wait"):
            rec = "take_now"
        wait = int(data.get("wait_minutes", 0) or 0)
        reason = str(data.get("reason", "") or "").strip() or "No details."

        return {"recommendation": rec, "wait_minutes": wait, "reason": reason}
    except Exception as e:
        return {
            "recommendation": "take_now",
            "wait_minutes": 0,
            "reason": f"AI parsing error; proceeding. ({e})",
        }

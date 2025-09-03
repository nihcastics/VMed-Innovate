# import os
# import json
# import datetime as dt
# from datetime import datetime, timedelta, time, date
# from zoneinfo import ZoneInfo

# import streamlit as st
# import psycopg

# # external AI advisor
# from shot_advisor import get_insulin_timing_advice

# # ─────────────────────────  DB CONNECTION  ─────────────────────────
# def get_conn():
#     return psycopg.connect(
#         host="localhost",
#         port=5432,
#         dbname="inter",
#         user="postgres",
#         password="ashu5995",
#         sslmode="disable",
#     )

# # ─────────────────────────  DDL (patients + reminders)  ─────────────────────────
# PATIENTS_DDL = """
# CREATE TABLE IF NOT EXISTS patients (
#   user_id                    INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 100000 INCREMENT BY 1) PRIMARY KEY,
#   full_name                  TEXT NOT NULL,
#   age_years                  SMALLINT CHECK (age_years >= 0 AND age_years <= 120),
#   gender                     TEXT CHECK (gender IN ('male','female','nonbinary','other','prefer_not_to_say')),
#   diabetes_type              TEXT CHECK (diabetes_type IN ('T1DM','T2DM','GDM','LADA','MODY','other')),
#   primary_basal_insulin_type TEXT,
#   primary_bolus_insulin_type TEXT,
#   shots_per_day              SMALLINT CHECK (shots_per_day >= 0),
#   tdd_units                  NUMERIC(6,2) CHECK (tdd_units >= 0),
#   target_bg_mgdl             SMALLINT CHECK (target_bg_mgdl BETWEEN 70 AND 200),
#   icr_g_per_unit             NUMERIC(6,2),
#   isf_mgdl_per_unit          NUMERIC(6,2),
#   preferred_units_increment  NUMERIC(3,1),
#   time_zone                  TEXT,
#   scheduled_basal_times      JSONB,
#   patient_phone              TEXT,
#   emergency_contact_name     TEXT,
#   emergency_contact_phone    TEXT,
#   clinician_name             TEXT,
#   clinician_contact          TEXT,
#   created_at_utc             TIMESTAMPTZ DEFAULT now(),
#   updated_at_utc             TIMESTAMPTZ DEFAULT now()
# );
# """

# REMINDERS_DDL = """
# CREATE TABLE IF NOT EXISTS reminders (
#   reminder_id     BIGSERIAL PRIMARY KEY,
#   user_id         INTEGER NOT NULL REFERENCES patients(user_id) ON DELETE CASCADE,
#   label           TEXT NOT NULL,
#   repeat_mode     TEXT NOT NULL CHECK (repeat_mode IN ('everyday','custom','one_off')),
#   days_of_week    JSONB,
#   local_date      DATE,
#   local_time      TIME NOT NULL,
#   next_fire_utc   TIMESTAMPTZ NOT NULL,
#   is_active       BOOLEAN NOT NULL DEFAULT TRUE,
#   last_called_utc TIMESTAMPTZ
# );
# """

# def ensure_tables():
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute(PATIENTS_DDL)
#         cur.execute(REMINDERS_DDL)
#         cur.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_phone TEXT;")
#         # NEW: store AI output separately from user remarks
#         cur.execute("ALTER TABLE insulin_logs ADD COLUMN IF NOT EXISTS ai_remark TEXT;")
#         conn.commit()

# # ─────────────────────────  HELPERS  ─────────────────────────
# DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

# def format_e164(num: str | None) -> str | None:
#     if not num:
#         return None
#     s = num.strip()
#     if s.startswith("+"):
#         return s
#     if s.isdigit() and len(s) == 10:
#         return "+91" + s
#     return None

# def parse_hhmm(txt: str, tag: str) -> time | None:
#     try:
#         h, m = map(int, txt.strip().split(":"))
#         return time(h, m)
#     except Exception:
#         st.error(f"Invalid time '{txt}' for {tag}. Use 24-hour HH:MM.")
#         return None

# def next_occurrence_utc(local_t: time, tz_str: str, days: list[str]):
#     tz = ZoneInfo(tz_str or "UTC")
#     now = datetime.now(tz)
#     for i in range(8):
#         cand_day = now + timedelta(days=i)
#         if days and cand_day.strftime("%a") not in days:
#             continue
#         cand = datetime.combine(cand_day.date(), local_t, tzinfo=tz)
#         if cand > now:
#             return cand.astimezone(ZoneInfo("UTC"))
#     tomorrow = now + timedelta(days=1)
#     return datetime.combine(tomorrow.date(), local_t, tzinfo=tz).astimezone(ZoneInfo("UTC"))

# def fetch_patient(uid: int):
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             SELECT
#               full_name, time_zone, patient_phone, shots_per_day,
#               primary_basal_insulin_type, primary_bolus_insulin_type, scheduled_basal_times
#             FROM patients WHERE user_id=%s
#             """,
#             (uid,),
#         )
#         row = cur.fetchone()
#     if not row:
#         return None
#     return dict(
#         full_name=row[0],
#         time_zone=row[1] or "Asia/Kolkata",
#         phone=format_e164(row[2]),
#         shots_per_day=row[3] or 0,
#         basal_type=row[4],
#         bolus_type=row[5],
#         scheduled_basal_times=row[6],  # may be list or JSON string
#     )

# def fetch_future(uid: int):
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             SELECT reminder_id, label, to_char(next_fire_utc,'YYYY-MM-DD HH24:MI UTC')
#             FROM reminders
#             WHERE user_id=%s AND is_active AND next_fire_utc > now()
#             ORDER BY next_fire_utc
#             """,
#             (uid,),
#         )
#         return cur.fetchall()

# def save_reminders(uid: int, tz: str, rows: list[dict]):
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute("DELETE FROM reminders WHERE user_id=%s", (uid,))
#         for r in rows:
#             if r["repeat_mode"] == "one_off":
#                 local_dt = datetime.combine(r["date"], r["time"], tzinfo=ZoneInfo(tz))
#                 next_fire = local_dt.astimezone(ZoneInfo("UTC"))
#                 days_json = None
#                 loc_date = r["date"]
#             else:
#                 next_fire = next_occurrence_utc(r["time"], tz, r["days"])
#                 days_json = json.dumps(r["days"]) if r["repeat_mode"] == "custom" else None
#                 loc_date = None

#             cur.execute(
#                 """
#                 INSERT INTO reminders
#                   (user_id, label, repeat_mode, days_of_week,
#                    local_date, local_time, next_fire_utc)
#                 VALUES (%s,%s,%s,%s,%s,%s,%s)
#                 """,
#                 (uid, r["label"], r["repeat_mode"], days_json, loc_date, r["time"], next_fire),
#             )
#         conn.commit()

# def deactivate_reminder(reminder_id: int, uid: int):
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute(
#             "UPDATE reminders SET is_active = FALSE WHERE reminder_id=%s AND user_id=%s",
#             (reminder_id, uid),
#         )
#         conn.commit()

# # ---------- Determine basal-vs-bolus window ----------
# def _within_basal_window(patient_tz: str, scheduled: list[str] | None, window_min: int = 90) -> bool:
#     if not scheduled:
#         return False
#     if isinstance(scheduled, str):
#         try:
#             scheduled = json.loads(scheduled)
#         except Exception:
#             scheduled = []
#     now_local = datetime.now(ZoneInfo(patient_tz)).time()
#     now_mins = now_local.hour * 60 + now_local.minute
#     for hhmm in scheduled:
#         try:
#             hh, mm = map(int, hhmm.split(":"))
#         except Exception:
#             continue
#         mins = hh * 60 + mm
#         diff = min(abs(now_mins - mins), 1440 - abs(now_mins - mins))
#         if diff <= window_min:
#             return True
#     return False

# # UPDATED: now accepts ai_remark and saves it in its own column
# def insert_insulin_log(uid: int, units_taken: float, remarks_text: str | None, patient: dict,
#                        ai_remark: str | None = None):
#     tz = patient["time_zone"]
#     on_basal = _within_basal_window(tz, patient.get("scheduled_basal_times"))
#     if on_basal:
#         purpose = "basal"
#         insulin_type = patient.get("basal_type") or patient.get("bolus_type") or "other"
#         dose_ctx = "manual_basal"
#     else:
#         purpose = "bolus"
#         insulin_type = patient.get("bolus_type") or patient.get("basal_type") or "other"
#         dose_ctx = "manual_bolus"

#     ts_utc = datetime.now(ZoneInfo("UTC"))
#     with get_conn() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             INSERT INTO insulin_logs
#               (user_id, timestamp_utc, insulin_type, prescribed_units,
#                units_taken, purpose, dose_context, current_bg_mgdl, remarks, ai_remark)
#             VALUES (%s,%s,%s,NULL,%s,%s,%s,NULL,%s,%s)
#             """,
#             (
#                 uid, ts_utc, insulin_type, float(units_taken),
#                 purpose, dose_ctx, remarks_text or None, ai_remark or None,
#             ),
#         )
#         conn.commit()

# # ─────────────────────────  UI  ─────────────────────────
# st.set_page_config(page_title="InsulinMate • Onboarding + Reminders", page_icon="💉", layout="wide")
# st.markdown(
#     """
#     <style>
#       /* bigger, medical-feel CTAs */
#       .cta-row {display:flex; gap:12px; justify-content:flex-end; align-items:center;}
#       .cta-primary button {font-size:18px; padding:16px 20px; border-radius:12px;
#                            background:#0ea5e9; color:white; border:0; box-shadow:0 2px 10px rgba(14,165,233,.35);}
#       .cta-secondary button {font-size:14px; padding:10px 14px; border-radius:10px;
#                              background:#065f46; color:white; border:0;}
#       /* AI advice boxes */
#       .advice-good {background:#064e3b; color:#d1fae5; padding:12px 14px; border-radius:12px;}
#       .advice-warn {background:#7c2d12; color:#fde68a; padding:12px 14px; border-radius:12px;}
#     </style>
#     """,
#     unsafe_allow_html=True,
# )

# st.title("💉 InsulinMate — Patient Onboarding + Reminders")
# ensure_tables()

# # Tabs: Create / Login
# tab_create, tab_login = st.tabs(["Create account", "Login"])

# with tab_login:
#     st.subheader("Login")
#     uid_login = st.text_input("Enter your 6-digit user_id", placeholder="e.g., 100000", key="login_uid")
#     if st.button("Continue", use_container_width=True, key="login_btn"):
#         try:
#             with get_conn() as conn, conn.cursor() as cur:
#                 cur.execute("SELECT user_id, full_name FROM patients WHERE user_id=%s", (uid_login,))
#                 row = cur.fetchone()
#             if row:
#                 st.success(f"Welcome, {row[1]} (user_id {row[0]})")
#                 st.session_state["user_id"] = int(row[0])
#             else:
#                 st.error("User not found. Double-check the user_id.")
#         except Exception as e:
#             st.error(f"Database error: {e}")

# with tab_create:
#     st.subheader("Create account")
#     with st.form("create_form", clear_on_submit=False):
#         full_name = st.text_input("Full name *")
#         age_years = st.number_input("Age (years) *", 0, 120, 30, 1)
#         gender = st.selectbox("Gender *", ["male","female","nonbinary","other","prefer_not_to_say"])
#         diabetes_type = st.selectbox("Diabetes Type *", ["T1DM","T2DM","GDM","LADA","MODY","other"])
#         shots_per_day = st.number_input("Insulin shots per day *", 0, 12, 2, 1)
#         tdd_units = st.number_input("Total Daily Dose (U/day) *", 0.0, step=0.5, value=40.0, format="%.2f")
#         target_bg_mgdl = st.number_input("Target BG (mg/dL) *", 70, 200, 110, 1)

#         primary_basal_insulin_type = st.text_input("Primary basal insulin (optional)")
#         primary_bolus_insulin_type = st.text_input("Primary bolus insulin (optional)")
#         icr = st.number_input("ICR (g carbohydrate per 1U) (optional)", 0.0, step=0.5, value=0.0, format="%.2f")
#         isf = st.number_input("ISF (mg/dL drop per 1U) (optional)", 0.0, step=0.5, value=0.0, format="%.2f")
#         units_increment = st.selectbox("Preferred dose increment (optional)", ["", "0.5", "1.0"], index=0)

#         tz = st.text_input("Time zone (IANA, e.g., Asia/Kolkata) *", value="Asia/Kolkata")
#         patient_phone = st.text_input("Patient phone (10 digits, used for calls) *", placeholder="9493110947")

#         st.markdown("**Scheduled basal times (optional)**")
#         num_times = st.number_input("How many daily basal times?", 0, 4, 2, 1)
#         basal_times = []
#         for i in range(num_times):
#             t = st.time_input(f"Basal time #{i+1}", value=dt.time(8,0) if i == 0 else dt.time(20,0), key=f"basal_{i}")
#             basal_times.append(t.strftime("%H:%M"))

#         emergency_contact_name = st.text_input("Emergency contact name (optional)")
#         emergency_contact_phone = st.text_input("Emergency contact phone (optional)")
#         clinician_name = st.text_input("Clinician name (optional)")
#         clinician_contact = st.text_input("Clinician contact (optional)")

#         submitted = st.form_submit_button("Create Patient", use_container_width=True)

#     if submitted:
#         if not full_name.strip():
#             st.error("Full name is required.")
#         elif not (patient_phone.strip().isdigit() and len(patient_phone.strip()) == 10):
#             st.error("Enter a 10-digit patient phone number.")
#         else:
#             try:
#                 with get_conn() as conn, conn.cursor() as cur:
#                     cur.execute(
#                         """
#                         INSERT INTO patients (
#                           full_name, age_years, gender, diabetes_type,
#                           primary_basal_insulin_type, primary_bolus_insulin_type,
#                           shots_per_day, tdd_units, target_bg_mgdl,
#                           icr_g_per_unit, isf_mgdl_per_unit, preferred_units_increment,
#                           time_zone, scheduled_basal_times,
#                           patient_phone,
#                           emergency_contact_name, emergency_contact_phone,
#                           clinician_name, clinician_contact
#                         )
#                         VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
#                         RETURNING user_id;
#                         """,
#                         (
#                             full_name.strip(),
#                             int(age_years),
#                             gender,
#                             diabetes_type,
#                             primary_basal_insulin_type or None,
#                             primary_bolus_insulin_type or None,
#                             int(shots_per_day),
#                             float(tdd_units),
#                             int(target_bg_mgdl),
#                             None if icr <= 0 else icr,
#                             None if isf <= 0 else isf,
#                             None if units_increment == "" else float(units_increment),
#                             tz or None,
#                             json.dumps(basal_times) if basal_times else None,
#                             patient_phone.strip(),
#                             emergency_contact_name or None,
#                             emergency_contact_phone or None,
#                             clinician_name or None,
#                             clinician_contact or None,
#                         ),
#                     )
#                     new_id = cur.fetchone()[0]
#                     conn.commit()
#                 st.success(f"✅ Patient created. Assigned user_id: **{new_id}**")
#                 st.session_state["user_id"] = int(new_id)
#             except Exception as e:
#                 st.error(f"Database error: {e}")

# # ─────────────────────────  REMINDERS + SHOT LOGGING  ─────────────────────────
# st.markdown("---")
# uid = st.session_state.get("user_id")
# if not uid:
#     st.info("Login or create an account above to manage reminders and log shots.")
#     st.stop()

# patient = fetch_patient(uid)
# if not patient:
#     st.error("User not found in patients.")
#     st.stop()

# # Header: name + big CTAs on the right
# left, right = st.columns([7, 5])
# with left:
#     st.success(f"Logged in as **{patient['full_name']}** (user_id {uid})  •  TZ: **{patient['time_zone']}**")
# with right:
#     # Two CTAs (we keep simple Streamlit buttons; CSS blocks above are decorative)
#     shot_cta = st.button("💉  Add insulin shot", key="cta_shot", use_container_width=True)
#     rem_cta = st.button("⏰  Add reminder", key="cta_rem", use_container_width=True)

# if shot_cta:
#     st.session_state["show_shot_modal"] = True
# if rem_cta:
#     st.session_state["show_reminder_builder"] = not st.session_state.get("show_reminder_builder", False)

# # ── SHOT MODAL: Step 1 (collect units/remarks) ─────────────────────────────────
# if st.session_state.get("show_shot_modal") and not st.session_state.get("shot_confirming"):
#     st.markdown("### Log insulin shot")
#     with st.form("log_shot_form", clear_on_submit=False):
#         units = st.number_input("Units taken", min_value=0.0, step=0.5, format="%.2f", key="shot_units")
#         remarks = st.text_area("Remarks (optional)", key="shot_remarks")
#         c1, c2 = st.columns(2)
#         save = c1.form_submit_button("Save")
#         cancel = c2.form_submit_button("Cancel")

#     if save:
#         # Call advisor: second file does DB read + Gemini
#         now_local = datetime.now(ZoneInfo(patient["time_zone"]))
#         advice = get_insulin_timing_advice(
#             user_id=uid,
#             proposed_units=float(units),
#             remarks=remarks.strip() or "",
#             now_iso=now_local.isoformat(),
#         )
#         # Store pending shot & advice to show "Are you sure?"
#         st.session_state["pending_shot"] = {"units": float(units), "remarks": remarks.strip()}
#         st.session_state["shot_advice"] = advice
#         st.session_state["shot_confirming"] = True
#         st.experimental_rerun() if hasattr(st, "experimental_rerun") else st.rerun()

#     if cancel:
#         st.session_state["show_shot_modal"] = False
#         st.session_state.pop("pending_shot", None)
#         st.session_state.pop("shot_advice", None)
#         st.session_state.pop("shot_confirming", None)
#         st.rerun()

# # ── SHOT MODAL: Step 2 (AI confirmation “Are you sure?”) ───────────────────────
# if st.session_state.get("shot_confirming"):
#     st.markdown("### Are you sure?")
#     advice = st.session_state.get("shot_advice") or {}
#     rec = (advice.get("recommendation") or "unknown").lower()
#     wait_min = advice.get("wait_minutes", 0)
#     reason = advice.get("reason", "No additional details.")

#     if rec == "take_now":
#         st.markdown(f"<div class='advice-good'><b>AI says:</b> Take the shot now.<br/>{reason}</div>", unsafe_allow_html=True)
#     elif rec == "wait":
#         st.markdown(
#             f"<div class='advice-warn'><b>AI says:</b> Wait ~{wait_min} minutes before taking the shot.<br/>{reason}</div>",
#             unsafe_allow_html=True,
#         )
#     else:
#         st.info(f"AI couldn't decide. {reason}")

#     c1, c2 = st.columns(2)
#     proceed = c1.button("Proceed", key="confirm_proceed", use_container_width=True)
#     cancel2 = c2.button("Cancel", key="confirm_cancel", use_container_width=True)

#     if proceed:
#         try:
#             units = st.session_state["pending_shot"]["units"]
#             remarks = st.session_state["pending_shot"]["remarks"]

#             # NEW: Short AI remark saved to ai_remark column (remarks stays user-only)
#             ai_short = None
#             if rec == "wait":
#                 ai_short = f"wait {wait_min} min — {reason}"
#             elif rec == "take_now":
#                 ai_short = f"proceed — {reason}"
#             else:
#                 ai_short = f"undetermined — {reason}"

#             insert_insulin_log(uid, units, remarks, patient, ai_remark=ai_short)
#             st.success("Shot logged to insulin_logs.")
#         except Exception as e:
#             st.error(f"Insert error: {e}")
#         finally:
#             for k in ("show_shot_modal", "pending_shot", "shot_advice", "shot_confirming"):
#                 st.session_state.pop(k, None)
#             st.rerun()

#     if cancel2:
#         for k in ("show_shot_modal", "pending_shot", "shot_advice", "shot_confirming"):
#             st.session_state.pop(k, None)
#         st.rerun()

# # ── SIDEBAR: Active reminders (unchanged list + deactivate) ────────────────────
# with st.sidebar:
#     st.header("📋 Active reminders")
#     rows = fetch_future(uid)
#     if rows:
#         for rid, label, ts in rows:
#             cols = st.columns([3, 2])
#             cols[0].write(f"• **{label}** → {ts}")
#             if cols[1].button("Deactivate", key=f"deact_{rid}"):
#                 deactivate_reminder(rid, uid)
#                 st.rerun()
#     else:
#         st.caption("No future reminders")

# # ── REMINDER BUILDER (only when clicked) ───────────────────────────────────────
# if st.session_state.get("show_reminder_builder"):
#     st.markdown("---")
#     st.subheader("Add reminder")
#     shots = st.number_input("How many reminders?", 0, 12, patient["shots_per_day"], 1)
#     rows_to_save: list[dict] = []

#     with st.form("builder"):
#         for i in range(int(shots)):
#             st.markdown(f"### Reminder {i+1}")
#             label = st.text_input("Label", f"shot_{i+1}", key=f"lbl{i}")
#             sched = st.radio("Type", ["Repeating", "One-off"], horizontal=True, key=f"sched{i}")

#             if sched == "Repeating":
#                 freq = st.radio("Frequency", ["Every day", "Custom weekdays"], horizontal=True, key=f"freq{i}")
#                 days = DOW if freq == "Every day" else st.multiselect("Weekdays", DOW, key=f"dow{i}")
#                 t = parse_hhmm(st.text_input("Time (24h HH:MM)", "08:00", key=f"time{i}"), f"reminder {i+1}")
#                 if t:
#                     rows_to_save.append(
#                         dict(label=label, repeat_mode=("everyday" if freq == "Every day" else "custom"),
#                              days=days, time=t)
#                     )
#             else:
#                 d = st.date_input("Date", date.today(), key=f"date{i}")
#                 t = parse_hhmm(st.text_input("Time (24h HH:MM)", "08:00", key=f"otime{i}"), f"one-off {i+1}")
#                 if t:
#                     rows_to_save.append(
#                         dict(label=label, repeat_mode="one_off", days=[], date=d, time=t)
#                     )

#         if st.form_submit_button("💾 Save reminders"):
#             if rows_to_save:
#                 save_reminders(uid, patient["time_zone"], rows_to_save)
#                 st.success("Reminders saved.")
#                 st.rerun()
#             else:
#                 st.warning("No valid rows to save.")

# insulinmate.py
import os
import json
import datetime as dt
from datetime import datetime, timedelta, time, date
from zoneinfo import ZoneInfo

import streamlit as st
import psycopg

# external AI advisor
from shot_advisor import get_insulin_timing_advice

# ─────────────────────────  DB CONNECTION  ─────────────────────────
def get_conn():
    return psycopg.connect(
        host="localhost",
        port=5432,
        dbname="inter",
        user="postgres",
        password="ashu5995",
        sslmode="disable",
    )

# ─────────────────────────  DDL (patients + reminders + logs)  ─────────────────────────
PATIENTS_DDL = """
CREATE TABLE IF NOT EXISTS patients (
  user_id                    INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 100000 INCREMENT BY 1) PRIMARY KEY,
  full_name                  TEXT NOT NULL,
  age_years                  SMALLINT CHECK (age_years >= 0 AND age_years <= 120),
  gender                     TEXT CHECK (gender IN ('male','female','nonbinary','other','prefer_not_to_say')),
  diabetes_type              TEXT CHECK (diabetes_type IN ('T1DM','T2DM','GDM','LADA','MODY','other')),
  primary_basal_insulin_type TEXT,
  primary_bolus_insulin_type TEXT,
  shots_per_day              SMALLINT CHECK (shots_per_day >= 0),
  tdd_units                  NUMERIC(6,2) CHECK (tdd_units >= 0),
  target_bg_mgdl             SMALLINT CHECK (target_bg_mgdl BETWEEN 70 AND 200),
  icr_g_per_unit             NUMERIC(6,2),
  isf_mgdl_per_unit          NUMERIC(6,2),
  preferred_units_increment  NUMERIC(3,1),
  time_zone                  TEXT,
  scheduled_basal_times      JSONB,
  patient_phone              TEXT,
  emergency_contact_name     TEXT,
  emergency_contact_phone    TEXT,
  clinician_name             TEXT,
  clinician_contact          TEXT,
  created_at_utc             TIMESTAMPTZ DEFAULT now(),
  updated_at_utc             TIMESTAMPTZ DEFAULT now()
);
"""

REMINDERS_DDL = """
CREATE TABLE IF NOT EXISTS reminders (
  reminder_id     BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES patients(user_id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  repeat_mode     TEXT NOT NULL CHECK (repeat_mode IN ('everyday','custom','one_off')),
  days_of_week    JSONB,
  local_date      DATE,
  local_time      TIME NOT NULL,
  next_fire_utc   TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_called_utc TIMESTAMPTZ
);
"""

# add a safe create for insulin_logs so ALTER won't fail
INSULIN_LOGS_DDL = """
CREATE TABLE IF NOT EXISTS insulin_logs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  timestamp_utc    TIMESTAMPTZ NOT NULL,
  insulin_type     TEXT NOT NULL,
  prescribed_units NUMERIC(6,2),
  units_taken      NUMERIC(6,2) NOT NULL,
  purpose          TEXT NOT NULL CHECK (purpose IN ('basal','bolus','correction')),
  dose_context     TEXT NOT NULL,
  current_bg_mgdl  SMALLINT,
  remarks          TEXT,
  ai_remark        TEXT,
  CONSTRAINT chk_units_taken_nonneg      CHECK (units_taken >= 0),
  CONSTRAINT chk_prescribed_units_nonneg CHECK (prescribed_units IS NULL OR prescribed_units >= 0),
  CONSTRAINT chk_bg_range                CHECK (current_bg_mgdl IS NULL OR current_bg_mgdl BETWEEN 20 AND 600),
  CONSTRAINT fk_user
    FOREIGN KEY (user_id) REFERENCES patients(user_id) ON DELETE CASCADE
);
"""

def ensure_tables():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(PATIENTS_DDL)
        cur.execute(REMINDERS_DDL)
        cur.execute(INSULIN_LOGS_DDL)  # ensures the table exists
        # keep these for older DBs
        cur.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_phone TEXT;")
        cur.execute("ALTER TABLE insulin_logs ADD COLUMN IF NOT EXISTS ai_remark TEXT;")
        conn.commit()

# ─────────────────────────  HELPERS  ─────────────────────────
DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

def format_e164(num: str | None) -> str | None:
    if not num:
        return None
    s = num.strip()
    if s.startswith("+"):
        return s
    if s.isdigit() and len(s) == 10:
        return "+91" + s
    return None

def parse_hhmm(txt: str, tag: str) -> time | None:
    try:
        h, m = map(int, txt.strip().split(":"))
        return time(h, m)
    except Exception:
        st.error(f"Invalid time '{txt}' for {tag}. Use 24-hour HH:MM.")
        return None

def next_occurrence_utc(local_t: time, tz_str: str, days: list[str]):
    tz = ZoneInfo(tz_str or "UTC")
    now = datetime.now(tz)
    for i in range(8):
        cand_day = now + timedelta(days=i)
        if days and cand_day.strftime("%a") not in days:
            continue
        cand = datetime.combine(cand_day.date(), local_t, tzinfo=tz)
        if cand > now:
            return cand.astimezone(ZoneInfo("UTC"))
    tomorrow = now + timedelta(days=1)
    return datetime.combine(tomorrow.date(), local_t, tzinfo=tz).astimezone(ZoneInfo("UTC"))

def fetch_patient(uid: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              full_name, time_zone, patient_phone, shots_per_day,
              primary_basal_insulin_type, primary_bolus_insulin_type, scheduled_basal_times
            FROM patients WHERE user_id=%s
            """,
            (uid,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return dict(
        full_name=row[0],
        time_zone=row[1] or "Asia/Kolkata",
        phone=format_e164(row[2]),
        shots_per_day=row[3] or 0,
        basal_type=row[4],
        bolus_type=row[5],
        scheduled_basal_times=row[6],
    )

def fetch_future(uid: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT reminder_id, label, to_char(next_fire_utc,'YYYY-MM-DD HH24:MI UTC')
            FROM reminders
            WHERE user_id=%s AND is_active AND next_fire_utc > now()
            ORDER BY next_fire_utc
            """,
            (uid,),
        )
        return cur.fetchall()

def save_reminders(uid: int, tz: str, rows: list[dict]):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM reminders WHERE user_id=%s", (uid,))
        for r in rows:
            if r["repeat_mode"] == "one_off":
                local_dt = datetime.combine(r["date"], r["time"], tzinfo=ZoneInfo(tz))
                next_fire = local_dt.astimezone(ZoneInfo("UTC"))
                days_json = None
                loc_date = r["date"]
            else:
                next_fire = next_occurrence_utc(r["time"], tz, r["days"])
                days_json = json.dumps(r["days"]) if r["repeat_mode"] == "custom" else None
                loc_date = None

            cur.execute(
                """
                INSERT INTO reminders
                  (user_id, label, repeat_mode, days_of_week,
                   local_date, local_time, next_fire_utc)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (uid, r["label"], r["repeat_mode"], days_json, loc_date, r["time"], next_fire),
            )
        conn.commit()

def deactivate_reminder(reminder_id: int, uid: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE reminders SET is_active = FALSE WHERE reminder_id=%s AND user_id=%s",
            (reminder_id, uid),
        )
        conn.commit()

# ---------- Determine basal-vs-bolus window ----------
def _within_basal_window(patient_tz: str, scheduled: list[str] | None, window_min: int = 90) -> bool:
    if not scheduled:
        return False
    if isinstance(scheduled, str):
        try:
            scheduled = json.loads(scheduled)
        except Exception:
            scheduled = []
    now_local = datetime.now(ZoneInfo(patient_tz)).time()
    now_mins = now_local.hour * 60 + now_local.minute
    for hhmm in scheduled:
        try:
            hh, mm = map(int, hhmm.split(":"))
        except Exception:
            continue
        mins = hh * 60 + mm
        diff = min(abs(now_mins - mins), 1440 - abs(now_mins - mins))
        if diff <= window_min:
            return True
    return False

# UPDATED: accepts ai_remark and saves it in its own column
def insert_insulin_log(uid: int, units_taken: float, remarks_text: str | None, patient: dict,
                       ai_remark: str | None = None):
    tz = patient["time_zone"]
    on_basal = _within_basal_window(tz, patient.get("scheduled_basal_times"))
    if on_basal:
        purpose = "basal"
        insulin_type = patient.get("basal_type") or patient.get("bolus_type") or "other"
        dose_ctx = "manual_basal"
    else:
        purpose = "bolus"
        insulin_type = patient.get("bolus_type") or patient.get("basal_type") or "other"
        dose_ctx = "manual_bolus"

    ts_utc = datetime.now(ZoneInfo("UTC"))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO insulin_logs
              (user_id, timestamp_utc, insulin_type, prescribed_units,
               units_taken, purpose, dose_context, current_bg_mgdl, remarks, ai_remark)
            VALUES (%s,%s,%s,NULL,%s,%s,%s,NULL,%s,%s)
            """,
            (
                uid, ts_utc, insulin_type, float(units_taken),
                purpose, dose_ctx, remarks_text or None, ai_remark or None,
            ),
        )
        conn.commit()

# ─────────────────────────  UI  ─────────────────────────
st.set_page_config(page_title="InsulinMate • Onboarding + Reminders", page_icon="💉", layout="wide")
st.markdown(
    """
    <style>
      .cta-row {display:flex; gap:12px; justify-content:flex-end; align-items:center;}
      .cta-primary button {font-size:18px; padding:16px 20px; border-radius:12px;
                           background:#0ea5e9; color:white; border:0; box-shadow:0 2px 10px rgba(14,165,233,.35);}
      .cta-secondary button {font-size:14px; padding:10px 14px; border-radius:10px;
                             background:#065f46; color:white; border:0;}
      .advice-good {background:#064e3b; color:#d1fae5; padding:12px 14px; border-radius:12px;}
      .advice-warn {background:#7c2d12; color:#fde68a; padding:12px 14px; border-radius:12px;}
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("💉 InsulinMate — Patient Onboarding + Reminders")
ensure_tables()

# Tabs: Create / Login
tab_create, tab_login = st.tabs(["Create account", "Login"])

with tab_login:
    st.subheader("Login")
    uid_login = st.text_input("Enter your 6-digit user_id", placeholder="e.g., 100000", key="login_uid")
    if st.button("Continue", use_container_width=True, key="login_btn"):
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT user_id, full_name FROM patients WHERE user_id=%s", (uid_login,))
                row = cur.fetchone()
            if row:
                st.success(f"Welcome, {row[1]} (user_id {row[0]})")
                st.session_state["user_id"] = int(row[0])
            else:
                st.error("User not found. Double-check the user_id.")
        except Exception as e:
            st.error(f"Database error: {e}")

with tab_create:
    st.subheader("Create account")
    with st.form("create_form", clear_on_submit=False):
        full_name = st.text_input("Full name *")
        age_years = st.number_input("Age (years) *", 0, 120, 30, 1)
        gender = st.selectbox("Gender *", ["male","female","nonbinary","other","prefer_not_to_say"])
        diabetes_type = st.selectbox("Diabetes Type *", ["T1DM","T2DM","GDM","LADA","MODY","other"])
        shots_per_day = st.number_input("Insulin shots per day *", 0, 12, 2, 1)
        tdd_units = st.number_input("Total Daily Dose (U/day) *", 0.0, step=0.5, value=40.0, format="%.2f")
        target_bg_mgdl = st.number_input("Target BG (mg/dL) *", 70, 200, 110, 1)

        primary_basal_insulin_type = st.text_input("Primary basal insulin (optional)")
        primary_bolus_insulin_type = st.text_input("Primary bolus insulin (optional)")
        icr = st.number_input("ICR (g carbohydrate per 1U) (optional)", 0.0, step=0.5, value=0.0, format="%.2f")
        isf = st.number_input("ISF (mg/dL drop per 1U) (optional)", 0.0, step=0.5, value=0.0, format="%.2f")
        units_increment = st.selectbox("Preferred dose increment (optional)", ["", "0.5", "1.0"], index=0)

        tz = st.text_input("Time zone (IANA, e.g., Asia/Kolkata) *", value="Asia/Kolkata")
        patient_phone = st.text_input("Patient phone (10 digits, used for calls) *", placeholder="9493110947")

        st.markdown("**Scheduled basal times (optional)**")
        num_times = st.number_input("How many daily basal times?", 0, 4, 2, 1)
        basal_times = []
        for i in range(num_times):
            t = st.time_input(f"Basal time #{i+1}", value=dt.time(8,0) if i == 0 else dt.time(20,0), key=f"basal_{i}")
            basal_times.append(t.strftime("%H:%M"))

        emergency_contact_name = st.text_input("Emergency contact name (optional)")
        emergency_contact_phone = st.text_input("Emergency contact phone (optional)")
        clinician_name = st.text_input("Clinician name (optional)")
        clinician_contact = st.text_input("Clinician contact (optional)")

        submitted = st.form_submit_button("Create Patient", use_container_width=True)

    if submitted:
        if not full_name.strip():
            st.error("Full name is required.")
        elif not (patient_phone.strip().isdigit() and len(patient_phone.strip()) == 10):
            st.error("Enter a 10-digit patient phone number.")
        else:
            try:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO patients (
                          full_name, age_years, gender, diabetes_type,
                          primary_basal_insulin_type, primary_bolus_insulin_type,
                          shots_per_day, tdd_units, target_bg_mgdl,
                          icr_g_per_unit, isf_mgdl_per_unit, preferred_units_increment,
                          time_zone, scheduled_basal_times, patient_phone,
                          emergency_contact_name, emergency_contact_phone,
                          clinician_name, clinician_contact
                        )
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        RETURNING user_id;
                        """,
                        (
                            full_name.strip(),
                            int(age_years),
                            gender,
                            diabetes_type,
                            primary_basal_insulin_type or None,
                            primary_bolus_insulin_type or None,
                            int(shots_per_day),
                            float(tdd_units),
                            int(target_bg_mgdl),
                            None if icr <= 0 else icr,
                            None if isf <= 0 else isf,
                            None if units_increment == "" else float(units_increment),
                            tz or None,
                            json.dumps(basal_times) if basal_times else None,
                            patient_phone.strip(),
                            emergency_contact_name or None,
                            emergency_contact_phone or None,
                            clinician_name or None,
                            clinician_contact or None,
                        ),
                    )
                    new_id = cur.fetchone()[0]
                    conn.commit()
                st.success(f"✅ Patient created. Assigned user_id: **{new_id}**")
                st.session_state["user_id"] = int(new_id)
            except Exception as e:
                st.error(f"Database error: {e}")

# ─────────────────────────  REMINDERS + SHOT LOGGING  ─────────────────────────
st.markdown("---")
uid = st.session_state.get("user_id")
if not uid:
    st.info("Login or create an account above to manage reminders and log shots.")
    st.stop()

patient = fetch_patient(uid)
if not patient:
    st.error("User not found in patients.")
    st.stop()

# Header: name + big CTAs on the right
left, right = st.columns([7, 5])
with left:
    st.success(f"Logged in as **{patient['full_name']}** (user_id {uid})  •  TZ: **{patient['time_zone']}**")
with right:
    shot_cta = st.button("💉  Add insulin shot", key="cta_shot", use_container_width=True)
    rem_cta  = st.button("⏰  Add reminder",    key="cta_rem",  use_container_width=True)

if shot_cta:
    st.session_state["show_shot_modal"] = True
if rem_cta:
    st.session_state["show_reminder_builder"] = not st.session_state.get("show_reminder_builder", False)

# ── SHOT MODAL: Step 1 (collect units/remarks)
if st.session_state.get("show_shot_modal") and not st.session_state.get("shot_confirming"):
    st.markdown("### Log insulin shot")
    with st.form("log_shot_form", clear_on_submit=False):
        units = st.number_input("Units taken", min_value=0.0, step=0.5, format="%.2f", key="shot_units")
        remarks = st.text_area("Remarks (optional)", key="shot_remarks")
        c1, c2 = st.columns(2)
        save = c1.form_submit_button("Save")
        cancel = c2.form_submit_button("Cancel")

    if save:
        now_local = datetime.now(ZoneInfo(patient["time_zone"]))
        advice = get_insulin_timing_advice(
            user_id=uid,
            proposed_units=float(units),
            remarks=remarks.strip() or "",
            now_iso=now_local.isoformat(),
        )
        st.session_state["pending_shot"] = {"units": float(units), "remarks": remarks.strip()}
        st.session_state["shot_advice"] = advice
        st.session_state["shot_confirming"] = True
        st.experimental_rerun() if hasattr(st, "experimental_rerun") else st.rerun()

    if cancel:
        st.session_state["show_shot_modal"] = False
        st.session_state.pop("pending_shot", None)
        st.session_state.pop("shot_advice", None)
        st.session_state.pop("shot_confirming", None)
        st.rerun()

# ── SHOT MODAL: Step 2 (AI confirmation “Are you sure?”)
if st.session_state.get("shot_confirming"):
    st.markdown("### Are you sure?")
    advice = st.session_state.get("shot_advice") or {}
    rec = (advice.get("recommendation") or "unknown").lower()
    wait_min = advice.get("wait_minutes", 0)
    reason = advice.get("reason", "No additional details.")

    if rec == "take_now":
        st.markdown(f"<div class='advice-good'><b>AI says:</b> Take the shot now.<br/>{reason}</div>", unsafe_allow_html=True)
    elif rec == "wait":
        st.markdown(
            f"<div class='advice-warn'><b>AI says:</b> Wait ~{wait_min} minutes before taking the shot.<br/>{reason}</div>",
            unsafe_allow_html=True,
        )
    else:
        st.info(f"AI couldn't decide. {reason}")

    c1, c2 = st.columns(2)
    proceed = c1.button("Proceed", key="confirm_proceed", use_container_width=True)
    cancel2 = c2.button("Cancel",  key="confirm_cancel",  use_container_width=True)

    if proceed:
        try:
            units = st.session_state["pending_shot"]["units"]
            remarks = st.session_state["pending_shot"]["remarks"]

            ai_short = None
            if rec == "wait":
                ai_short = f"wait {wait_min} min — {reason}"
            elif rec == "take_now":
                ai_short = f"proceed — {reason}"
            else:
                ai_short = f"undetermined — {reason}"

            insert_insulin_log(uid, units, remarks, patient, ai_remark=ai_short)
            st.success("Shot logged to insulin_logs.")
        except Exception as e:
            st.error(f"Insert error: {e}")
        finally:
            for k in ("show_shot_modal", "pending_shot", "shot_advice", "shot_confirming"):
                st.session_state.pop(k, None)
            st.rerun()

    if cancel2:
        for k in ("show_shot_modal", "pending_shot", "shot_advice", "shot_confirming"):
            st.session_state.pop(k, None)
        st.rerun()

# ── SIDEBAR: Active reminders
with st.sidebar:
    st.header("📋 Active reminders")
    rows = fetch_future(uid)
    if rows:
        for rid, label, ts in rows:
            cols = st.columns([3, 2])
            cols[0].write(f"• **{label}** → {ts}")
            if cols[1].button("Deactivate", key=f"deact_{rid}"):
                deactivate_reminder(rid, uid)
                st.rerun()
    else:
        st.caption("No future reminders")

# ── REMINDER BUILDER (only when clicked)
if st.session_state.get("show_reminder_builder"):
    st.markdown("---")
    st.subheader("Add reminder")
    shots = st.number_input("How many reminders?", 0, 12, patient["shots_per_day"], 1)
    rows_to_save: list[dict] = []

    with st.form("builder"):
        for i in range(int(shots)):
            st.markdown(f"### Reminder {i+1}")
            label = st.text_input("Label", f"shot_{i+1}", key=f"lbl{i}")
            sched = st.radio("Type", ["Repeating", "One-off"], horizontal=True, key=f"sched{i}")

            if sched == "Repeating":
                freq = st.radio("Frequency", ["Every day", "Custom weekdays"], horizontal=True, key=f"freq{i}")
                days = DOW if freq == "Every day" else st.multiselect("Weekdays", DOW, key=f"dow{i}")
                t = parse_hhmm(st.text_input("Time (24h HH:MM)", "08:00", key=f"time{i}"), f"reminder {i+1}")
                if t:
                    rows_to_save.append(
                        dict(label=label, repeat_mode=("everyday" if freq == "Every day" else "custom"),
                             days=days, time=t)
                    )
            else:
                d = st.date_input("Date", date.today(), key=f"date{i}")
                t = parse_hhmm(st.text_input("Time (24h HH:MM)", "08:00", key=f"otime{i}"), f"one-off {i+1}")
                if t:
                    rows_to_save.append(
                        dict(label=label, repeat_mode="one_off", days=[], date=d, time=t)
                    )

        if st.form_submit_button("💾 Save reminders"):
            if rows_to_save:
                save_reminders(uid, patient["time_zone"], rows_to_save)
                st.success("Reminders saved.")
                st.rerun()
            else:
                st.warning("No valid rows to save.")

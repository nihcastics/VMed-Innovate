# # reminder_worker.py
# import time
# import psycopg
# from datetime import datetime
# from twilio.rest import Client
# from twilio.base.exceptions import TwilioRestException

# # ─── CONFIG ─────────────────────────────────────────────────
# DB = dict(host="localhost", port=5432, dbname="inter",
#           user="postgres", password="ashu5995", sslmode="disable")

# SID  = "ACf299618a4c2123587d2b494ab1ca1291"
# TOK  = "0b25f046692caa9ddad057d90427ed97"
# FROM = "+19377350308"

# POLL_SECONDS = 30

# def conn():
#     return psycopg.connect(**DB)

# client = Client(SID, TOK)

# def to_e164(num: str) -> str:
#     return num if num.startswith("+") else "+91" + num

# print("🩺 reminder_worker running — polling every", POLL_SECONDS, "seconds")
# while True:
#     try:
#         # 1) Fetch all due reminders across all users
#         with conn() as c, c.cursor() as cur:
#             cur.execute("""
#                 SELECT r.reminder_id, r.user_id, r.label, p.patient_phone
#                 FROM reminders r
#                 JOIN patients  p USING (user_id)
#                 WHERE r.is_active = TRUE
#                   AND r.next_fire_utc <= now()
#             """)
#             due = cur.fetchall()

#         for rid, uid, label, phone in due:
#             # 2) Claim it atomically (turn off BEFORE dialing)
#             claimed = False
#             with conn() as c, c.cursor() as cur:
#                 cur.execute("""
#                     UPDATE reminders
#                     SET is_active = FALSE, last_called_utc = now()
#                     WHERE reminder_id = %s
#                       AND is_active = TRUE
#                       AND next_fire_utc <= now()
#                     RETURNING reminder_id
#                 """, (rid,))
#                 claimed = cur.fetchone() is not None
#                 c.commit()

#             if not claimed:
#                 # Another worker/thread grabbed it
#                 continue

#             # 3) Dial
#             try:
#                 phone_e164 = to_e164(phone)
#                 twiml = f'<Response><Say voice="alice">Reminder. {label}. Take your insulin.</Say></Response>'
#                 client.calls.create(to=phone_e164, from_=FROM, twiml=twiml)
#                 print(f"{datetime.utcnow().isoformat()}Z  ✓ called {phone_e164}  ({label})  reminder_id={rid}")
#             except TwilioRestException as e:
#                 # We already deactivated the reminder; just log the error.
#                 print(f"{datetime.utcnow().isoformat()}Z  ✗ Twilio error {e.code}: {e.msg} (rid={rid})")
#             except Exception as e:
#                 print(f"{datetime.utcnow().isoformat()}Z  ✗ Unexpected error: {e} (rid={rid})")

#     except Exception as loop_err:
#         print("⚠️ worker top-level error:", loop_err)

#     time.sleep(POLL_SECONDS)

import time
import re
import psycopg
from datetime import datetime, timedelta
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

# ─── CONFIG ─────────────────────────────────────────────────
DB = dict(host="localhost", port=5432, dbname="inter",
          user="postgres", password="ashu5995", sslmode="disable")

SID  = "AC167fcc1960fe1f6b9119c02388f4c7e1"
TOK  = "203ee862ddc358209bd4c8c1d0ebf44e"
FROM = "+17178768103"  # Must be a Twilio voice-enabled number or verified caller ID

POLL_SECONDS = 30            # how often to poll DB for due reminders
STATUS_WAIT_SECONDS = 75     # how long to wait for call to reach a terminal status
STATUS_POLL_INTERVAL = 3     # how often to poll Twilio for status

def conn():
    return psycopg.connect(**DB)

client = Client(SID, TOK)

def to_e164(num: str) -> str:
    """Normalize to E.164; assume India (+91) if 10 digits; pass-through if already +..."""
    if not num:
        raise ValueError("Empty phone")
    s = re.sub(r"\D", "", num)  # digits only
    if num.startswith("+"):
        return num
    if len(s) == 10:
        return "+91" + s
    if len(s) > 10 and num.startswith("+"):
        return num
    # As a fallback, if they stored '91XXXXXXXXXX' without '+'
    if len(s) == 12 and s.startswith("91"):
        return "+" + s
    raise ValueError(f"Unrecognized phone format: {num}")

def place_call_and_wait(phone_e164: str, label: str):
    """
    Queue a call, then poll Twilio for real status.
    Returns (final_status, error_code_or_None, sid)
    """
    twiml = f'<Response><Say voice="alice">Reminder. {label}. Take your insulin.</Say></Response>'
    call = client.calls.create(to=phone_e164, from_=FROM, twiml=twiml)
    print(f"{datetime.utcnow().isoformat()}Z  ↪ queued Call SID={call.sid} to {phone_e164} ({label})")

    deadline = time.time() + STATUS_WAIT_SECONDS
    last_status = None
    error_code = None
    while time.time() < deadline:
        cur = client.calls(call.sid).fetch()
        if cur.status != last_status:
            print(f"   • status: {cur.status}"
                  + (f"  err={cur.error_code}" if getattr(cur, 'error_code', None) else ""))
            last_status = cur.status
        if cur.status in ("completed", "failed", "busy", "no-answer", "canceled"):
            error_code = getattr(cur, "error_code", None)
            return cur.status, error_code, call.sid
        time.sleep(STATUS_POLL_INTERVAL)

    # Timed out waiting — return whatever we last saw
    cur = client.calls(call.sid).fetch()
    error_code = getattr(cur, "error_code", None)
    return cur.status, error_code, call.sid

print("🩺 reminder_worker running — polling every", POLL_SECONDS, "seconds")
while True:
    try:
        # 1) Fetch all due reminders across all users
        with conn() as c, c.cursor() as cur:
            cur.execute("""
                SELECT r.reminder_id, r.user_id, r.label, p.patient_phone
                FROM reminders r
                JOIN patients  p USING (user_id)
                WHERE r.is_active = TRUE
                  AND r.next_fire_utc <= now()
            """)
            due = cur.fetchall()

        for rid, uid, label, phone in due:
            # 2) Claim it atomically (turn off BEFORE dialing)
            with conn() as c, c.cursor() as cur:
                cur.execute("""
                    UPDATE reminders
                    SET is_active = FALSE, last_called_utc = now()
                    WHERE reminder_id = %s
                      AND is_active = TRUE
                      AND next_fire_utc <= now()
                    RETURNING reminder_id
                """, (rid,))
                claimed = cur.fetchone() is not None
                c.commit()

            if not claimed:
                continue  # another worker grabbed it

            # 3) Dial + poll status
            try:
                phone_e164 = to_e164(phone)
                final_status, err_code, sid = place_call_and_wait(phone_e164, label)
                print(f"{datetime.utcnow().isoformat()}Z  ⇢ final status for {sid}: {final_status}"
                      + (f" (error_code={err_code})" if err_code else ""))

                # Optional retry logic if it failed/no-answer/busy — uncomment if you want retries:
                # if final_status in ("failed", "no-answer", "busy", "canceled"):
                #     with conn() as c, c.cursor() as cur:
                #         cur.execute("""
                #             UPDATE reminders
                #             SET is_active = TRUE, next_fire_utc = now() + interval '5 minutes'
                #             WHERE reminder_id = %s
                #         """, (rid,))
                #         c.commit()

            except ValueError as ve:
                print(f"{datetime.utcnow().isoformat()}Z  ✗ Phone formatting error for rid={rid}: {ve}")
            except TwilioRestException as e:
                print(f"{datetime.utcnow().isoformat()}Z  ✗ Twilio REST error for rid={rid}: {e.code} {e.msg}")
            except Exception as e:
                print(f"{datetime.utcnow().isoformat()}Z  ✗ Unexpected error for rid={rid}: {e}")

    except Exception as loop_err:
        print("⚠️ worker top-level error:", loop_err)

    try:
        time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("⏹ worker stopped by user")
        break

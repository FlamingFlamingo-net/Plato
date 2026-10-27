"""API checks for Plato v1 rules and invite hook.

Run against a THROWAWAY server (never the real one):
  docker run -d --rm --name pb-check -p 127.0.0.1:8091:8090 \
    -v "$PWD/pb_hooks:/pb/pb_hooks" \
    -v "$PWD/pb_migrations:/pb/pb_migrations" pocketbase-local:0.40.5
  python tools/api_check.py http://127.0.0.1:8091
  docker stop pb-check
"""
import io
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8091"
results = []


def call(method, path, body=None, token=None, files=None, retry=True):
    for attempt in range(8):
        s, r = _call(method, path, body, token, files)
        if s != 429 or not retry:
            return s, r
        time.sleep(8)  # rate limit hit (real server setting); wait and try again
    return s, r


def _call(method, path, body=None, token=None, files=None):
    headers = {}
    data = None
    if files:
        boundary = uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in (body or {}).items():
            buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for k, (fname, content, ctype) in files.items():
            buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode())
            buf.write(content + b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and r.headers.get_content_type() == "application/json" else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def pw():
    return secrets.token_urlsafe(16)


def nutri(name):
    email = f"zz-{uuid.uuid4().hex[:8]}@test.local"
    p = pw()
    s, r = call("POST", "/api/collections/nutritionists/records",
                {"email": email, "password": p, "passwordConfirm": p, "name": name})
    assert s == 200, r
    s, r = call("POST", "/api/collections/nutritionists/auth-with-password", {"identity": email, "password": p})
    assert s == 200, r
    return r["token"], r["record"]["id"]


def jpeg():
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (64, 64), (240, 138, 75)).save(b, "JPEG")
    return b.getvalue()


ta, a_id = nutri("ZZ Test Ana")
tb, b_id = nutri("ZZ Test Beto")


def new_patient(tok, nid, name):
    p = pw()
    return call("POST", "/api/collections/patients/records",
                {"name": name, "sex": "female", "birth_date": "1990-01-01 12:00:00.000Z", "height_cm": 160, "nutritionist": nid, "password": p, "passwordConfirm": p}, tok)


s, p1 = new_patient(ta, a_id, "ZZ Paciente Uno")
check("nutritionist A creates a patient", s == 200, p1)
s, p2 = new_patient(tb, b_id, "ZZ Paciente Dos")
check("nutritionist B creates a patient", s == 200, p2)
s, r = new_patient(ta, b_id, "ZZ Robado")
check("A cannot create a patient owned by B", s >= 400, r)
s, r = call("POST", "/api/collections/patients/records",
            {"name": "x", "sex": "male", "nutritionist": a_id, "password": "12345678", "passwordConfirm": "12345678"})
check("a visitor cannot self-register as patient", s >= 400, r)

s, r = call("GET", "/api/collections/patients/records", token=ta)
check("A lists only own patients", s == 200 and [x["id"] for x in r["items"]] == [p1["id"]], r)
s, r = call("GET", f"/api/collections/patients/records/{p1['id']}", token=tb)
check("B opening A's patient gets not found", s == 404, s)

s, m = call("POST", "/api/collections/measurements/records",
            {"patient": p1["id"], "date": f"{date.today()} 12:00:00.000Z", "weight_kg": 72.5, "body_fat_pct": 30, "waist_cm": 84}, ta)
check("A adds a measurement for own patient", s == 200, m)
s, r = call("POST", "/api/collections/measurements/records",
            {"patient": p2["id"], "date": f"{date.today()} 12:00:00.000Z", "weight_kg": 60}, ta)
check("A cannot add a measurement to B's patient", s >= 400, r)

meals = {str(d): {"breakfast": f"Avena día {d}", "lunch": "Pollo con verduras", "dinner": "Sopa"} for d in range(1, 8)}
s, diet = call("POST", "/api/collections/diets/records", {"patient": p1["id"], "title": "Plan base", "meals": meals}, ta)
check("A saves a weekly diet", s == 200, diet)
s, r = call("POST", "/api/collections/diets/records", {"patient": p1["id"], "meals": {}}, ta)
check("second diet for the same patient is refused", s >= 400, r)

s, note = call("POST", "/api/collections/patient_notes/records", {"patient": p1["id"], "text": "Nota privada"}, ta)
check("A writes a private note", s == 200, note)

s, inv = call("POST", "/api/plato/invite", {"patient": p1["id"]}, ta)
check("A creates an invite link", s == 200 and len(inv.get("token", "")) == 40, inv)
s, r = call("POST", "/api/plato/invite", {"patient": p1["id"]}, tb)
check("B cannot create an invite for A's patient", s == 404, r)
s, r = call("GET", f"/api/plato/invite/{inv['token']}")
check("invite check greets the patient by first name", s == 200 and r.get("name") == "ZZ" and r.get("nutritionist") == "ZZ Test Ana", r)
s, r = call("GET", "/api/collections/invites/records", token=ta)
check("invites are not readable through the API", s == 200 and r["items"] == [] or s >= 400, r)

p_email = f"zz-pac-{uuid.uuid4().hex[:6]}@test.local"
p_pw = pw()
s, j = call("POST", "/api/plato/join", {"token": inv["token"], "email": p_email, "password": p_pw})
check("patient joins with the link and is signed in", s == 200 and j.get("token") and j["record"]["id"] == p1["id"], j)
tp = j.get("token")
s, r = call("POST", "/api/plato/join", {"token": inv["token"], "email": p_email, "password": p_pw})
check("the same link a second time is refused", s == 400 and "ya se usó" in r.get("message", ""), r)
s, r = call("POST", "/api/collections/patients/auth-with-password", {"identity": p_email, "password": p_pw})
check("patient can sign in with email and password", s == 200, r)

s, r = call("GET", "/api/collections/patients/records", token=tp)
check("patient sees only themself", s == 200 and [x["id"] for x in r["items"]] == [p1["id"]], r)
s, r = call("GET", f"/api/collections/nutritionists/records/{a_id}", token=tp)
check("patient can read their nutritionist's name", s == 200 and r.get("name") == "ZZ Test Ana", r)
s, r = call("GET", f"/api/collections/nutritionists/records/{b_id}", token=tp)
check("patient cannot read another nutritionist", s == 404, s)
s, r = call("GET", f"/api/collections/patient_notes/records/{note['id']}", token=tp)
check("patient opening a private note gets not found", s == 404, s)
s, r = call("GET", "/api/collections/patient_notes/records", token=tp)
check("patient note list is empty", s == 200 and r["items"] == [], r)
s, r = call("GET", "/api/collections/measurements/records", token=tp)
check("patient sees own measurements", s == 200 and len(r["items"]) == 1, r)
s, r = call("GET", "/api/collections/diets/records", token=tp)
check("patient sees own diet", s == 200 and len(r["items"]) == 1, r)
s, r = call("PATCH", f"/api/collections/diets/records/{diet['id']}", {"title": "hack"}, tp)
check("patient cannot edit the diet", s == 404, s)

img = jpeg()
today = date.today().isoformat()
s, log = call("POST", "/api/collections/meal_logs/records", {"patient": p1["id"], "date": today, "slot": "lunch", "note": "Rico"},
              tp, files={"photo": ("lunch.jpg", img, "image/jpeg")})
check("patient logs a meal with a photo", s == 200, log)
s, r = call("POST", "/api/collections/meal_logs/records", {"patient": p2["id"], "date": today, "slot": "lunch"},
            tp, files={"photo": ("x.jpg", img, "image/jpeg")})
check("patient cannot log for another patient", s >= 400, r)
s, r = call("POST", "/api/collections/meal_logs/records", {"patient": p1["id"], "date": today, "slot": "lunch", "seen_at": "2026-01-01 00:00:00Z"},
            tp, files={"photo": ("x.jpg", img, "image/jpeg")})
check("patient cannot mark their own log as seen", s >= 400, r)

s, r = call("GET", f"/api/files/meal_logs/{log['id']}/{log['photo']}")
check("photo is not public without a file token", s in (401, 403, 404), s)
s, ft = call("POST", "/api/files/token", {}, ta)
s, r = call("GET", f"/api/files/meal_logs/{log['id']}/{log['photo']}?token={ft['token']}")
check("nutritionist opens the photo with a file token", s == 200 and isinstance(r, bytes) and r[:2] == b"\xff\xd8", s)

s, r = call("GET", "/api/collections/meal_logs/records", token=tb)
check("B sees no meal logs of A's patient", s == 200 and r["items"] == [], r)
s, r = call("PATCH", f"/api/collections/meal_logs/records/{log['id']}", {"note": "editado"}, ta)
check("nutritionist cannot change the patient's note", s == 404, s)
s, r = call("PATCH", f"/api/collections/meal_logs/records/{log['id']}", {"seen_at": f"{today} 18:00:00.000Z"}, ta)
check("nutritionist marks the log as seen", s == 200 and r.get("seen_at"), r)
s, r = call("PATCH", f"/api/collections/meal_logs/records/{log['id']}", {"seen_at": ""}, tp)
check("patient cannot clear seen", s == 404, s)
s, r = call("POST", "/api/collections/patients/records",
            {"name": "x", "sex": "male", "nutritionist": a_id, "password": "12345678", "passwordConfirm": "12345678"}, tp)
check("patient cannot create patients", s >= 400, r)
s, r = call("PATCH", f"/api/collections/patients/records/{p1['id']}", {"joined": False}, ta)
check("nutritionist cannot fake the joined flag", s == 404, s)

s, inv2 = call("POST", "/api/plato/invite", {"patient": p1["id"]}, ta)
s, r = call("GET", "/api/collections/patients/records", token=tp)
s2, r2 = call("GET", f"/api/plato/invite/{inv2['token']}")
check("reset access: new link works and says rejoin", s2 == 200 and r2.get("rejoin") is True, r2)
p_pw2 = pw()
s, j2 = call("POST", "/api/plato/join", {"token": inv2["token"], "email": p_email, "password": p_pw2})
check("patient rejoins with the same email", s == 200, j2)
s, r = call("GET", "/api/collections/patients/records", token=tp)
check("old patient session stops working after reset", s in (200, 401) and (s == 401 or r["items"] == []), (s, r))
s, r = call("POST", "/api/collections/patients/auth-with-password", {"identity": p_email, "password": p_pw})
check("old password stops working after reset", s == 400, s)
tp = j2["token"]

s, r = call("DELETE", f"/api/collections/meal_logs/records/{log['id']}", token=tp)
check("patient deletes own log the same day", s == 204, (s, r))

# ---- security fixes (audit 2026-10-23) ----
known = pw()
s, r = call("POST", "/api/collections/patients/records",
                                {"name": "ZZ Preset", "sex": "male", "birth_date": "1990-01-01 12:00:00.000Z", "nutritionist": a_id, "email": f"zz-preset-{uuid.uuid4().hex[:5]}@test.local",
                                 "password": known, "passwordConfirm": known}, ta)
check("nutritionist cannot choose a patient's email (no signing in as the patient)", s >= 400, (s, r))
for field, value in [("emailVisibility", True), ("verified", False), ("email", "x@test.local")]:
    s, r = call("PATCH", f"/api/collections/patients/records/{p1['id']}", {field: value}, ta)
    check(f"nutritionist cannot change the patient's {field}", s == 404, s)
s, r = call("PATCH", f"/api/collections/patients/records/{p1['id']}", {"height_cm": 161}, ta)
check("nutritionist can still edit the patient's details", s == 200, (s, r))

codes = [call("POST", "/api/collections/nutritionists/auth-with-password", {"identity": "zz-nobody@test.local", "password": f"wrong{i}"}, retry=False)[0] for i in range(15)]
check("15 wrong sign-ins in a minute get slowed down (429)", 429 in codes, sorted(set(codes)))
codes = [call("GET", f"/api/plato/invite/{secrets.token_hex(20)}", retry=False)[0] for i in range(25)]
check("25 guessed invite links in a minute get slowed down (429)", 429 in codes, sorted(set(codes)))

# ---- close a patient's account (spec "Feature: Close a patient's account") ----
time.sleep(61)  # let the invite-link rate limit from the check above reset
s, pc = new_patient(ta, a_id, "ZZ Paciente Cierre")
s, inv = call("POST", "/api/plato/invite", {"patient": pc["id"]}, ta)
pc_email, pc_pw = f"zz-cierre-{uuid.uuid4().hex[:6]}@test.local", pw()
s, jc = call("POST", "/api/plato/join", {"token": inv["token"], "email": pc_email, "password": pc_pw})
tpc = jc["token"]
s, mlog = call("POST", "/api/collections/meal_logs/records", {"patient": pc["id"], "date": today, "slot": "dinner"},
               tpc, files={"photo": ("d.jpg", img, "image/jpeg")})
s, inv_open = call("POST", "/api/plato/invite", {"patient": pc["id"]}, ta)  # an open link that closing must void

s, r = call("POST", f"/api/plato/patients/{pc['id']}/close", {}, tb)
check("C7 another nutritionist cannot close the patient", s == 404, s)
s, r = call("DELETE", f"/api/collections/patients/records/{pc['id']}", token=ta)
check("C8 an active patient cannot be deleted directly", s == 404, s)
s, r = call("POST", f"/api/plato/patients/{pc['id']}/close", {}, ta)
check("C1 nutritionist closes the account", s == 200 and r.get("archived_at"), (s, r))
s, r = call("POST", f"/api/plato/patients/{pc['id']}/close", {}, ta)
check("C1 closing twice is refused", s == 400, s)
s, r = call("GET", "/api/collections/patients/records?filter=" + urllib.parse.quote('archived_at != ""'), token=ta)
check("C1 patient shows up as archived", s == 200 and [x["id"] for x in r["items"]] == [pc["id"]], r)
s, r = call("GET", "/api/collections/patients/records", token=tpc)
check("C2 the patient's old session stops working", s == 401 or (s == 200 and r["items"] == []), (s, r))
s, r = call("POST", "/api/collections/patients/auth-with-password", {"identity": pc_email, "password": pc_pw})
check("C2 the patient's old password stops working", s == 400, s)
s, r = call("GET", f"/api/plato/invite/{inv_open['token']}")
check("C2 an invite link made before closing stops working", s == 400, (s, r))
s, r = call("POST", "/api/collections/measurements/records",
            {"patient": pc["id"], "date": f"{today} 12:00:00.000Z", "weight_kg": 70}, ta)
check("C3 no new measurement for a closed account", s >= 400, s)
s, r = call("PATCH", f"/api/collections/patients/records/{pc['id']}", {"height_cm": 170}, ta)
check("C3 a closed account's details are read-only", s == 404, s)
s, r = call("PATCH", f"/api/collections/meal_logs/records/{mlog['id']}", {"seen_at": f"{today} 18:00:00.000Z"}, ta)
check("C3 a closed account's meal logs are read-only", s == 404, s)
s, r = call("POST", "/api/collections/patient_notes/records", {"patient": pc["id"], "text": "x"}, ta)
check("C3 no new note for a closed account", s >= 400, s)
s, r = call("GET", f"/api/collections/meal_logs/records/{mlog['id']}", token=ta)
check("C3 the nutritionist can still read a closed account's data", s == 200, s)
s, r = call("PATCH", f"/api/collections/patients/records/{pc['id']}", {"archived_at": ""}, ta)
check("C3 reopening is not possible by editing the record", s == 404, s)
s, r = call("POST", "/api/plato/invite", {"patient": pc["id"]}, ta)
check("C4 no invite link for a closed account", s == 400, (s, r))
s, r = call("POST", f"/api/plato/patients/{pc['id']}/reopen", {}, tb)
check("C7 another nutritionist cannot reopen", s == 404, s)
s, r = call("POST", f"/api/plato/patients/{pc['id']}/reopen", {}, ta)
check("C5 nutritionist reopens the account", s == 200, (s, r))
s, inv2 = call("POST", "/api/plato/invite", {"patient": pc["id"]}, ta)
pc_pw2 = pw()
s, j2 = call("POST", "/api/plato/join", {"token": inv2["token"], "email": pc_email, "password": pc_pw2})
check("C5 after reopening, a new link works and the patient is back in", s == 200 and j2.get("token"), (s, j2))
s, r = call("GET", f"/api/collections/meal_logs/records/{mlog['id']}", token=j2["token"])
check("C5 reopening keeps the old meal logs", s == 200, s)
s, r = call("POST", f"/api/plato/patients/{pc['id']}/close", {}, ta)
s, r = call("DELETE", f"/api/collections/patients/records/{pc['id']}", token=tb)
check("C7 another nutritionist cannot delete", s == 404, s)
s, ft = call("POST", "/api/files/token", {}, ta)
s, r = call("GET", f"/api/files/meal_logs/{mlog['id']}/{mlog['photo']}?token={ft['token']}")
check("C6 (before delete) the photo still opens for the nutritionist", s == 200, s)
s, r = call("DELETE", f"/api/collections/patients/records/{pc['id']}", token=ta)
check("C6 nutritionist deletes the closed account for good", s == 204, (s, r))
s, ft = call("POST", "/api/files/token", {}, ta)
s, r = call("GET", f"/api/files/meal_logs/{mlog['id']}/{mlog['photo']}?token={ft['token']}")
check("C6 after delete the photo address returns not found", s == 404, s)
s, r = call("GET", f"/api/collections/meal_logs/records/{mlog['id']}", token=ta)
check("C6 after delete the meal log is gone", s == 404, s)

# ---- activity log (spec "Feature: Patient activity dashboard", slice 1) ----
from datetime import timedelta


def joined_patient(tok, nid, name):
    s, p = new_patient(tok, nid, name)
    s, inv = call("POST", "/api/plato/invite", {"patient": p["id"]}, tok)
    s, j = call("POST", "/api/plato/join", {"token": inv["token"], "email": f"zz-{uuid.uuid4().hex[:8]}@test.local", "password": pw()})
    assert s == 200, j
    return p, j["token"]


pa, tpa = joined_patient(ta, a_id, "ZZ Paciente Actividad")
pz, tpz = joined_patient(tb, b_id, "ZZ Paciente Ajena")
d0 = str(date.today())
run = {"patient": pa["id"], "date": d0, "kind": "run", "minutes": 30, "terrain": "flat", "distance_km": 5, "note": "Parque"}
s, act = call("POST", "/api/collections/activity_logs/records", run, tpa)
check("A1 patient logs a run (30 min, flat, 5 km)", s == 200 and act.get("distance_km") == 5 and act.get("terrain") == "flat", (s, act))
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "patient": pz["id"]}, tpa)
check("A6 a patient cannot log activity for someone else", s >= 400, s)
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "seen_at": f"{d0} 10:00:00.000Z"}, tpa)
check("A6 a patient cannot mark their own activity seen", s >= 400, s)
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "patient": pa["id"]}, ta)
check("A6 a nutritionist cannot log activity for a patient", s >= 400, s)
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "date": str(date.today() - timedelta(days=6))}, tpa)
check("A7 6 days back is allowed", s == 200, (s, r))
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "date": str(date.today() - timedelta(days=12))}, tpa)
check("A7 12 days back is refused", s == 400, (s, r))
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "date": str(date.today() + timedelta(days=3))}, tpa)
check("A7 a future date is refused", s == 400, (s, r))
s, r = call("POST", "/api/collections/activity_logs/records", {**run, "minutes": 0}, tpa)
check("A7 minutes must be 1-600", s == 400, s)
s, r = call("POST", "/api/collections/activity_logs/records", {"patient": pa["id"], "date": d0, "kind": "other", "minutes": 20}, tpa)
check("A7 'Otra' without a name is refused", s == 400, (s, r))
s, oth = call("POST", "/api/collections/activity_logs/records",
              {"patient": pa["id"], "date": d0, "kind": "other", "kind_other": "  Escalar  ", "minutes": 45}, tpa)
check("A7 'Otra' with a name is saved (trimmed)", s == 200 and oth.get("kind_other") == "Escalar", (s, oth))
s, gym = call("POST", "/api/collections/activity_logs/records",
              {"patient": pa["id"], "date": d0, "kind": "gym", "kind_other": "x", "minutes": 50, "terrain": "hills", "distance_km": 3, "intensity": "vigorous"}, tpa)
check("A7 details that do not apply (gym: terrain, distance, name) are dropped",
      s == 200 and gym.get("terrain") == "" and not gym.get("distance_km") and gym.get("kind_other") == "" and gym.get("intensity") == "vigorous", (s, gym))
s, r = call("GET", "/api/collections/activity_logs/records?filter=" + urllib.parse.quote(f'patient = "{pa["id"]}"'), token=ta)
check("A3 the nutritionist lists the patient's activity", s == 200 and r["totalItems"] == 4, (s, r.get("totalItems")))
s, r = call("GET", "/api/collections/activity_logs/records", token=tb)
check("A5 another nutritionist sees none of it", s == 200 and all(x["patient"] != pa["id"] for x in r["items"]), r)
s, r = call("GET", f"/api/collections/activity_logs/records/{act['id']}", token=tpz)
check("A5 another patient cannot open it", s == 404, s)
s, r = call("PATCH", f"/api/collections/activity_logs/records/{act['id']}", {"minutes": 90}, ta)
check("A4 the nutritionist cannot change the activity", s == 404, s)
s, r = call("PATCH", f"/api/collections/activity_logs/records/{act['id']}", {"seen_at": f"{d0} 18:00:00.000Z"}, tb)
check("A5 another nutritionist cannot mark it seen", s == 404, s)
s, r = call("PATCH", f"/api/collections/activity_logs/records/{act['id']}", {"seen_at": f"{d0} 18:00:00.000Z"}, ta)
check("A4 the nutritionist marks it seen", s == 200 and r.get("seen_at"), (s, r))
s, r = call("PATCH", f"/api/collections/activity_logs/records/{act['id']}", {"seen_at": ""}, tpa)
check("A6 the patient cannot change seen", s >= 400, s)
s, r = call("DELETE", f"/api/collections/activity_logs/records/{oth['id']}", token=ta)
check("A8 the nutritionist cannot delete the patient's activity", s == 404, s)
s, r = call("DELETE", f"/api/collections/activity_logs/records/{oth['id']}", token=tpa)
check("A8 the patient deletes their own activity the same day", s == 204, s)
s, r = call("POST", f"/api/plato/patients/{pa['id']}/close", {}, ta)
s, r = call("GET", f"/api/collections/activity_logs/records/{act['id']}", token=ta)
check("A9 a closed account's activity stays readable", s == 200, s)
s, r = call("PATCH", f"/api/collections/activity_logs/records/{gym['id']}", {"seen_at": f"{d0} 18:00:00.000Z"}, ta)
check("A9 a closed account's activity is read-only", s == 404, s)
s, r = call("DELETE", f"/api/collections/patients/records/{pa['id']}", token=ta)
s, r = call("GET", f"/api/collections/activity_logs/records/{act['id']}", token=ta)
check("A9 deleting the patient deletes their activity", s == 404, s)

# ---- progress photos (spec "Feature: Patient activity dashboard", slice 2) ----
time.sleep(61)  # the /api/plato/ rate limit (20 a minute) is shared by invite, join and close; let it reset
pp, tpp = joined_patient(ta, a_id, "ZZ Paciente Progreso")
front = {"patient": pp["id"], "date": d0, "pose": "front", "note": "Semana 1"}
s, ph = call("POST", "/api/collections/progress_photos/records", front, tpp, files={"photo": ("f.jpg", img, "image/jpeg")})
check("F1 patient uploads a progress photo (front)", s == 200 and ph.get("pose") == "front", (s, ph))
s, r = call("POST", "/api/collections/progress_photos/records", {**front, "patient": pz["id"]}, tpp, files={"photo": ("f.jpg", img, "image/jpeg")})
check("F6 a patient cannot upload for someone else", s >= 400, s)
s, r = call("POST", "/api/collections/progress_photos/records", front, ta, files={"photo": ("f.jpg", img, "image/jpeg")})
check("F6 a nutritionist cannot upload for a patient", s >= 400, s)
s, r = call("POST", "/api/collections/progress_photos/records", {**front, "date": str(date.today() - timedelta(days=5))}, tpp,
            files={"photo": ("f.jpg", img, "image/jpeg")})
check("F1 an old date is refused (progress photos are of today)", s == 400, (s, r))
s, r = call("POST", "/api/collections/progress_photos/records", {**front, "seen_at": f"{d0} 10:00:00.000Z"}, tpp,
            files={"photo": ("f.jpg", img, "image/jpeg")})
check("F6 a patient cannot mark their own photo seen", s >= 400, s)
s, r = call("POST", "/api/collections/progress_photos/records", front, tpp)
check("F1 a progress photo needs the photo", s == 400, s)
s, ftk = call("POST", "/api/files/token", {}, ta)
s, r = call("GET", f"/api/files/progress_photos/{ph['id']}/{ph['photo']}")
check("F5 the photo file does not open without a file token", s == 404, s)
s, r = call("GET", f"/api/files/progress_photos/{ph['id']}/{ph['photo']}?token={ftk['token']}")
check("F2 the nutritionist opens the photo with a file token", s == 200, s)
s, ftb = call("POST", "/api/files/token", {}, tb)
s, r = call("GET", f"/api/files/progress_photos/{ph['id']}/{ph['photo']}?token={ftb['token']}")
check("F5 another nutritionist's file token gets not found", s == 404, s)
s, r = call("GET", "/api/collections/progress_photos/records", token=tb)
check("F5 another nutritionist lists none of it", s == 200 and all(x["patient"] != pp["id"] for x in r["items"]), r)
s, r = call("GET", f"/api/collections/progress_photos/records/{ph['id']}", token=tpz)
check("F6 another patient cannot open it", s == 404, s)
s, r = call("PATCH", f"/api/collections/progress_photos/records/{ph['id']}", {"pose": "back"}, ta)
check("F4 the nutritionist cannot change the photo", s == 404, s)
s, r = call("PATCH", f"/api/collections/progress_photos/records/{ph['id']}", {"seen_at": f"{d0} 18:00:00.000Z"}, ta)
check("F4 the nutritionist marks it seen", s == 200 and r.get("seen_at"), (s, r))
s, r = call("DELETE", f"/api/collections/progress_photos/records/{ph['id']}", token=tpp)
check("F7 setting off (default): the patient cannot delete their progress photo", s == 404, s)
s, r = call("PATCH", f"/api/collections/nutritionists/records/{b_id}", {"allow_progress_delete": True}, ta)
check("F7 a nutritionist cannot change another nutritionist's setting", s == 404, s)
s, r = call("PATCH", f"/api/collections/nutritionists/records/{a_id}", {"allow_progress_delete": True}, ta)
check("F7 the nutritionist turns on 'patients may delete progress photos'", s == 200 and r.get("allow_progress_delete") is True, (s, r))
s, r = call("DELETE", f"/api/collections/progress_photos/records/{ph['id']}", token=tpp)
check("F7 setting on: the patient deletes their progress photo", s == 204, s)
s, ftk = call("POST", "/api/files/token", {}, ta)
s, r = call("GET", f"/api/files/progress_photos/{ph['id']}/{ph['photo']}?token={ftk['token']}")
check("F7 after delete the photo address returns not found", s == 404, s)
s, r = call("PATCH", f"/api/collections/nutritionists/records/{a_id}", {"allow_progress_delete": False}, ta)
s, ph2 = call("POST", "/api/collections/progress_photos/records", {**front, "pose": "side"}, tpp, files={"photo": ("s.jpg", img, "image/jpeg")})
s, r = call("DELETE", f"/api/collections/progress_photos/records/{ph2['id']}", token=tb)
check("F7 another nutritionist cannot delete it", s == 404, s)
s, r = call("DELETE", f"/api/collections/progress_photos/records/{ph2['id']}", token=ta)
check("F7 the nutritionist can always delete a progress photo", s == 204, s)
s, ph3 = call("POST", "/api/collections/progress_photos/records", {**front, "pose": "back"}, tpp, files={"photo": ("b.jpg", img, "image/jpeg")})
s, r = call("POST", f"/api/plato/patients/{pp['id']}/close", {}, ta)
s, r = call("POST", "/api/collections/progress_photos/records", front, tpp, files={"photo": ("f.jpg", img, "image/jpeg")})
check("F8 a closed account cannot upload", s >= 400, s)
s, r = call("GET", f"/api/collections/progress_photos/records/{ph3['id']}", token=ta)
check("F8 a closed account's progress photos stay readable", s == 200, s)
s, r = call("PATCH", f"/api/collections/progress_photos/records/{ph3['id']}", {"seen_at": f"{d0} 18:00:00.000Z"}, ta)
check("F8 a closed account's progress photos are read-only", s == 404, s)
s, r = call("DELETE", f"/api/collections/patients/records/{pp['id']}", token=ta)
s, r = call("GET", f"/api/collections/progress_photos/records/{ph3['id']}", token=ta)
check("F8 deleting the patient deletes their progress photos", s == 404, s)

# ---- saved diet templates (spec "Feature: Saved diet templates") ----
week = {"1": {"breakfast": "Avena", "lunch": "Pollo con verduras"}, "3": {"dinner": "Sopa de verduras"}}
s, tpl = call("POST", "/api/collections/diet_templates/records", {"nutritionist": a_id, "title": "ZZ Fase 1", "meals": week}, ta)
check("T1 nutritionist saves a template", s == 200 and tpl.get("meals") == week, (s, tpl))
s, r = call("POST", "/api/collections/diet_templates/records", {"nutritionist": a_id, "title": "ZZ Fase 1", "meals": {}}, ta)
check("T1 the same name twice is refused (the screen asks replace / copy)", s == 400, s)
s, r = call("POST", "/api/collections/diet_templates/records", {"nutritionist": b_id, "title": "ZZ Robada", "meals": {}}, ta)
check("T5 a template cannot be created for another nutritionist", s >= 400, s)
s, r = call("POST", "/api/collections/diet_templates/records", {"nutritionist": a_id, "title": "", "meals": {}}, ta)
check("T1 a template needs a name", s == 400, s)
s, r = call("GET", "/api/collections/diet_templates/records", token=ta)
check("T1 the nutritionist lists their templates", s == 200 and [x["id"] for x in r["items"]] == [tpl["id"]], r)
s, r = call("GET", "/api/collections/diet_templates/records", token=tb)
check("T5 another nutritionist lists none", s == 200 and r["items"] == [], r)
s, r = call("GET", f"/api/collections/diet_templates/records/{tpl['id']}", token=tb)
check("T5 another nutritionist cannot open it", s == 404, s)
s, r = call("PATCH", f"/api/collections/diet_templates/records/{tpl['id']}", {"title": "x"}, tb)
check("T5 another nutritionist cannot change it", s == 404, s)
s, r = call("DELETE", f"/api/collections/diet_templates/records/{tpl['id']}", token=tb)
check("T5 another nutritionist cannot delete it", s == 404, s)
s, r = call("PATCH", f"/api/collections/diet_templates/records/{tpl['id']}", {"nutritionist": b_id}, ta)
check("T5 a template cannot be handed to another nutritionist", s == 404, s)
pt, tpt = joined_patient(ta, a_id, "ZZ Paciente Plantilla")
s, r = call("GET", "/api/collections/diet_templates/records", token=tpt)
check("T6 a patient cannot list templates", s == 200 and r["items"] == [], r)
s, r = call("GET", f"/api/collections/diet_templates/records/{tpl['id']}", token=tpt)
check("T6 a patient cannot open a template", s == 404, s)
s, r = call("PATCH", f"/api/collections/diet_templates/records/{tpl['id']}", {"title": "ZZ Fase 1 (bajar de peso)"}, ta)
check("T7 rename", s == 200 and r.get("title") == "ZZ Fase 1 (bajar de peso)", (s, r))
s, d = call("POST", "/api/collections/diets/records", {"patient": pt["id"], "title": tpl["title"], "meals": week}, ta)
s, r = call("DELETE", f"/api/collections/diet_templates/records/{tpl['id']}", token=ta)
check("T7 delete", s == 204, s)
s, r = call("GET", f"/api/collections/diets/records/{d['id']}", token=ta)
check("T7 deleting a template leaves the patient's diet intact", s == 200 and r.get("meals") == week, (s, r))

# ---- photo feedback (spec "Feature: Photo feedback") ----
pf, tpf = joined_patient(ta, a_id, "ZZ Paciente Feedback")
s, ml = call("POST", "/api/collections/meal_logs/records", {"patient": pf["id"], "date": d0, "slot": "lunch"}, tpf,
             files={"photo": ("l.jpg", img, "image/jpeg")})
s, pr = call("POST", "/api/collections/progress_photos/records", {"patient": pf["id"], "date": d0, "pose": "front"}, tpf,
             files={"photo": ("p.jpg", img, "image/jpeg")})
fb_url = f"/api/collections/meal_logs/records/{ml['id']}"
s, r = call("PATCH", fb_url, {"feedback_stars": 2, "feedback_text": "  ¡Buen plato! Más verdura en la cena.  "}, ta)
check("B1 nutritionist rates a meal photo ★★ with a comment", s == 200 and r.get("feedback_stars") == 2
      and r.get("feedback_text") == "¡Buen plato! Más verdura en la cena." and r.get("feedback_at") and not r.get("feedback_edited"), (s, r))
check("B1 giving feedback marks the photo seen", bool(r.get("seen_at")), r.get("seen_at"))
s, r = call("GET", fb_url, token=tpf)
check("B1 the patient sees the stars and the comment", s == 200 and r.get("feedback_stars") == 2 and r.get("feedback_text"), (s, r))
first_at = r.get("feedback_at")
time.sleep(1.1)
s, r = call("PATCH", fb_url, {"feedback_stars": 3}, ta)
check("B3 edit: new stars, 'editada', new time", s == 200 and r.get("feedback_stars") == 3 and r.get("feedback_edited") is True
      and r.get("feedback_at") > first_at, (s, r))
s, r = call("PATCH", fb_url, {"feedback_at": "2020-01-01 00:00:00.000Z", "feedback_edited": False}, ta)
check("B3 the feedback time and 'editada' cannot be faked", s == 200 and r.get("feedback_edited") is True and r.get("feedback_at") > first_at, (s, r))
s, r = call("PATCH", fb_url, {"feedback_stars": 0, "feedback_text": ""}, ta)
check("B3 remove: comment and stars cleared, feedback gone", s == 200 and not r.get("feedback_at") and not r.get("feedback_text")
      and not r.get("feedback_stars") and r.get("feedback_edited") is False, (s, r))
s, r = call("PATCH", fb_url, {"feedback_stars": 3}, ta)
check("B2 stars only is allowed", s == 200 and r.get("feedback_stars") == 3 and r.get("feedback_at"), (s, r))
s, r = call("PATCH", fb_url, {"feedback_stars": 4}, ta)
check("B5 4 stars is refused", s == 400, s)
s, r = call("PATCH", fb_url, {"feedback_stars": 1.5}, ta)
check("B5 half stars are refused", s == 400, s)
s, r = call("PATCH", fb_url, {"feedback_text": "x" * 501}, ta)
check("B5 a comment over 500 characters is refused", s == 400, s)
s, r = call("PATCH", fb_url, {"feedback_text": "Hola"}, tpf)
check("B4 the patient cannot write feedback", s == 404, s)
s, r = call("PATCH", fb_url, {"feedback_text": "Hola"}, tb)
check("B4 another nutritionist cannot write feedback", s == 404, s)
pr_url = f"/api/collections/progress_photos/records/{pr['id']}"
s, r = call("PATCH", pr_url, {"feedback_text": "Se nota tu constancia."}, ta)
check("B1 a progress photo takes a comment", s == 200 and r.get("feedback_text") == "Se nota tu constancia." and r.get("seen_at"), (s, r))
s, r = call("PATCH", pr_url, {"feedback_stars": 3}, ta)
check("B1 a progress photo does not take stars (refused)", s == 400, (s, r))
s, r = call("PATCH", pr_url, {"feedback_text": "x"}, tpf)
check("B4 the patient cannot write feedback on a progress photo", s == 404, s)
s, r = call("PATCH", fb_url, {"note": "cambiada"}, ta)
check("B4 feedback does not open the patient's own fields to the nutritionist", s == 404, s)
time.sleep(61)  # the shared /api/plato/ rate limit
s, r = call("POST", f"/api/plato/patients/{pf['id']}/close", {}, ta)
s, r = call("PATCH", fb_url, {"feedback_text": "Tarde"}, ta)
check("B6 closed account: no new feedback", s == 404, s)
s, r = call("GET", fb_url, token=ta)
check("B6 closed account: existing feedback stays readable", s == 200 and r.get("feedback_stars") == 3, (s, r))

# ---- age limits (spec "Feature: Age limits") ----
import os
import subprocess


def years_ago(n, days=0):
    # The server computes age on its own (UTC) date; use the same date so the edge cases hold at any local hour.
    from datetime import datetime, timezone
    t = datetime.now(timezone.utc).date() - timedelta(days=days)
    try:
        d = t.replace(year=t.year - n)
    except ValueError:  # 29 February
        d = t.replace(year=t.year - n, day=28)
    return f"{d} 12:00:00.000Z"


s, r = call("POST", "/api/collections/patients/records",
            {"name": "ZZ Sin Fecha", "sex": "male", "nutritionist": a_id, "password": "x" * 12, "passwordConfirm": "x" * 12}, ta)
check("E4 a new patient needs a birth date", s == 400, s)
pm, tpm = joined_patient(ta, a_id, "ZZ Paciente Menor")
s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": years_ago(17)}, ta)
check("E3 the nutritionist sets a birth date (17 years old)", s == 200, (s, r))
s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": ""}, ta)
check("E4 the birth date cannot be cleared", s == 404, s)
prog = {"patient": pm["id"], "date": d0, "pose": "front"}
s, r = call("POST", "/api/collections/progress_photos/records", prog, tpm, files={"photo": ("p.jpg", img, "image/jpeg")})
check("E1 a 17-year-old cannot upload a progress photo (plain message)", s == 400 and "Por tu edad" in r.get("message", ""), (s, r))
s, r = call("POST", "/api/collections/meal_logs/records", {"patient": pm["id"], "date": d0, "slot": "lunch"}, tpm,
            files={"photo": ("l.jpg", img, "image/jpeg")})
check("E1 a 17-year-old can still upload a meal photo", s == 200, (s, r))
s, r = call("POST", "/api/collections/activity_logs/records", {"patient": pm["id"], "date": d0, "kind": "walk", "minutes": 20}, tpm)
check("E1 a 17-year-old can still log activity", s == 200, (s, r))
s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": years_ago(18, days=1)}, ta)
s, r = call("POST", "/api/collections/progress_photos/records", prog, tpm, files={"photo": ("p.jpg", img, "image/jpeg")})
check("E2 18 years and a day: progress photos work", s == 200, (s, r))
s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": years_ago(18, days=-1)}, ta)
s, r = call("POST", "/api/collections/progress_photos/records", prog, tpm, files={"photo": ("p.jpg", img, "image/jpeg")})
check("E3 turning 18 tomorrow: locked again at once", s == 400, (s, r))
s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": years_ago(18)}, ta)
s, r = call("POST", "/api/collections/progress_photos/records", prog, tpm, files={"photo": ("p.jpg", img, "image/jpeg")})
check("E2 18th birthday today: progress photos work", s == 200, (s, r))
# An older patient with no birth date (created before this rule): needs the admin to blank it, so only on a throwaway container.
box = os.environ.get("PB_CONTAINER")
if box:
    su_email, su_pw = f"zz-su-{uuid.uuid4().hex[:6]}@test.local", "Zz" + secrets.token_hex(12)  # never starts with "-" (CLI flag)
    subprocess.run(["docker", "exec", box, "/pb/pocketbase", "superuser", "upsert", su_email, su_pw], capture_output=True, check=True)
    s, su = call("POST", "/api/collections/_superusers/auth-with-password", {"identity": su_email, "password": su_pw})
    s, r = call("PATCH", f"/api/collections/patients/records/{pm['id']}", {"birth_date": ""}, su["token"])
    s, r = call("POST", "/api/collections/progress_photos/records", prog, tpm, files={"photo": ("p.jpg", img, "image/jpeg")})
    check("E4 an older patient with no birth date is treated as a minor", s == 400 and "Falta tu fecha" in r.get("message", ""), (s, r))
else:
    print("SKIP E4 no-birth-date patient (set PB_CONTAINER=pb-check to run it)")

# ---- home banner profile (spec "Patient activity dashboard", slice 3) ----
s, r = call("PATCH", f"/api/collections/nutritionists/records/{a_id}", {"whatsapp": "614 000 0000", "instagram": "@consultorio.demo"}, ta,
            files={"cover": ("c.jpg", img, "image/jpeg")})
check("H1 the nutritionist saves a cover photo, WhatsApp and Instagram", s == 200 and r.get("cover") and r.get("instagram") == "@consultorio.demo", (s, r))
s, r = call("PATCH", f"/api/collections/nutritionists/records/{a_id}", {"instagram": "bad handle!"}, ta)
check("H1 an Instagram handle with spaces or symbols is refused", s == 400, s)
s, r = call("PATCH", f"/api/collections/nutritionists/records/{b_id}", {"whatsapp": "1"}, ta)
check("H1 a nutritionist cannot change another one's profile", s == 404, s)
s, me_a = call("GET", f"/api/collections/nutritionists/records/{a_id}", token=ta)
s, r = call("GET", f"/api/files/nutritionists/{a_id}/{me_a['cover']}")
check("H1 the cover photo does not open without a file token", s == 404, s)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)

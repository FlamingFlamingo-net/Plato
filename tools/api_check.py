"""API checks for AHT Fitness v1 rules and invite hook.

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
from pbadmin import create_nutritionist

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
    create_nutritionist(BASE, email, p, name)   # accounts are made by the admin
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

# ---- meal checklist (spec "Feature: Weekly goals", slice 1) ----
pm, tpm = joined_patient(ta, a_id, "ZZ Paciente Checklist")
yday = str(date.today() - timedelta(days=1))
ML = "/api/collections/meal_logs/records"
s, chk = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "breakfast"}, tpm)
check("M1 a check without photo saves (\"lo comí\")", s == 200 and not chk.get("photo"), (s, chk))
s, r = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "breakfast"}, tpm)
check("M1 a second check of the same meal and day is refused", s == 400, (s, r))
s, r = call("POST", ML, {"patient": pm["id"], "date": yday, "slot": "breakfast"}, tpm)
check("M2 yesterday's meal can be checked", s == 200, (s, r))
s, r = call("POST", ML, {"patient": pm["id"], "date": str(date.today() - timedelta(days=3)), "slot": "lunch"}, tpm)
check("M2 a meal from 3 days ago is refused", s == 400, (s, r))
s, r = call("POST", ML, {"patient": pm["id"], "date": str(date.today() + timedelta(days=2)), "slot": "lunch"}, tpm)
check("M2 a future day is refused", s == 400, (s, r))
s, r = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "extra"}, tpm)
check("M3 an extra with no photo and no note is refused", s == 400, (s, r))
s, ex1 = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "extra", "note": "Un pan dulce"}, tpm)
s2, ex2 = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "extra"}, tpm, files={"photo": ("e.jpg", img, "image/jpeg")})
check("M3 extras with a note or a photo save; more than one a day is fine", s == 200 and s2 == 200, (s, ex1, s2))
s, r = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "lunch"}, ta)
check("M4 the nutritionist cannot create checks", s in (400, 403, 404), s)
s, r = call("PATCH", f"{ML}/{chk['id']}", {"seen_at": f"{d0} 12:00:00.000Z"}, ta)
check("M5 the nutritionist marks the check as seen", s == 200 and r.get("seen_at"), (s, r))
s, r = call("PATCH", f"{ML}/{chk['id']}", {"note": "sin foto"}, tpm)
check("M5 the patient cannot edit a check without adding a photo", s == 400, (s, r))
s, r = call("PATCH", f"{ML}/{chk['id']}", {"note": "con foto"}, tpz, files={"photo": ("x.jpg", img, "image/jpeg")})
check("M5 another patient cannot add a photo to someone's check", s == 404, s)
s, r = call("PATCH", f"{ML}/{chk['id']}", {"slot": "dinner"}, tpm, files={"photo": ("x.jpg", img, "image/jpeg")})
check("M5 adding a photo cannot move the check to another meal", s == 404, s)
s, withp = call("PATCH", f"{ML}/{chk['id']}", {"note": "con foto"}, tpm, files={"photo": ("x.jpg", img, "image/jpeg")})
check("M5 the patient adds a photo to their check; it becomes new again for the nutritionist",
      s == 200 and withp.get("photo") and not withp.get("seen_at"), (s, withp))
s, r = call("PATCH", f"{ML}/{chk['id']}", {}, tpm, files={"photo": ("y.jpg", img, "image/jpeg")})
check("M5 a photo that is already there cannot be replaced by the patient", s == 404, s)
s, r = call("PATCH", f"{ML}/{ex1['id']}", {}, tpm, files={"photo": ("y.jpg", img, "image/jpeg")})
check("M5 an extra cannot get a photo later (it is a new extra instead)", s == 404, s)
s, chk2 = call("POST", ML, {"patient": pm["id"], "date": d0, "slot": "lunch"}, tpm)
s, r = call("PATCH", f"{ML}/{chk2['id']}", {"feedback_text": "Bien"}, ta)
check("M6 feedback on a check without photo is refused; on its photo it works",
      s == 400 and call("PATCH", f"{ML}/{chk['id']}", {"feedback_text": "Bien", "feedback_stars": 3}, ta)[0] == 200, (s, r))
s, r = call("DELETE", f"{ML}/{chk2['id']}", token=tpm)
check("M7 the patient undoes their check the same day", s == 204, s)

# ---- service + weekly goals (spec "Feature: Weekly goals", slice 2) ----
PR = "/api/collections/patients/records"
def monday(d):
    return d - timedelta(days=d.weekday())
s, gn = new_patient(ta, a_id, "ZZ Meta Nutri")          # no service sent (older screens)
check("G1 a new patient without a service gets Nutrición: all planned meals x 5 days on, activity off (30 min kept)",
      gn.get("service") == "nutrition" and gn.get("meal_goal_days") == 5 and (gn.get("goal_history") or [{}])[0].get("meal_per_day") == "all"
      and gn.get("activity_goal_days") == 0 and gn.get("activity_goal_min") == 30, gn)
check("G1 its goal history starts this week", len(gn.get("goal_history") or []) == 1 and gn["goal_history"][0]["from"] in
      (str(monday(date.today())), str(monday(date.today() + timedelta(days=1)))), gn.get("goal_history"))
pt = pw()
s, gt = call("POST", PR, {"name": "ZZ Meta Entreno", "sex": "male", "birth_date": "1990-01-01 12:00:00.000Z", "nutritionist": a_id,
                          "password": pt, "passwordConfirm": pt, "service": "training"}, ta)
check("G1 Entrenamiento: activity 30 min x 5 on, meals off", s == 200 and gt["activity_goal_days"] == 5 and gt["meal_goal_days"] == 0, (s, gt))
s, gb = call("POST", PR, {"name": "ZZ Meta Ambos", "sex": "male", "birth_date": "1990-01-01 12:00:00.000Z", "nutritionist": a_id,
                          "password": pt, "passwordConfirm": pt, "service": "both"}, ta)
check("G1 Nutrición + entrenamiento: both on", s == 200 and gb["activity_goal_days"] == 5 and gb["meal_goal_days"] == 5, (s, gb))
s, r = call("POST", PR, {"name": "ZZ Meta Hist", "sex": "male", "birth_date": "1990-01-01 12:00:00.000Z", "nutritionist": a_id,
                         "password": pt, "passwordConfirm": pt, "goal_history": [{"from": "2020-01-06"}]}, ta)
check("G2 nobody writes the goal history directly (create)", s in (400, 403, 404), s)
wk = str(monday(date.today()))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"activity_goal_days": 4, "activity_goal_min": 45, "goal_week": wk}, ta)
check("G3 the nutritionist sets 45 min x 4 days; this week's history entry follows (no duplicate)",
      s == 200 and r["activity_goal_days"] == 4 and len(r["goal_history"]) == 1 and r["goal_history"][-1]["act_min"] == 45, (s, r))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"activity_goal_min": 47}, ta)
check("G3 minutes must go in steps of 5", s == 400, (s, r))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"activity_goal_min": 305}, ta)
check("G3 more than 300 minutes a day is refused", s == 400, s)
s, r = call("PATCH", f"{PR}/{gb['id']}", {"meal_goal_days": 4, "goal_week": wk}, ta)
check("G3 the meal goal is all planned meals: history writes \"all\"", s == 200 and r["goal_history"][-1]["meal_per_day"] == "all" and r["goal_history"][-1]["meal_days"] == 4, (s, r.get("goal_history")))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"meal_goal_days": 0, "goal_week": wk}, ta)
check("G3 Sin meta (0 days) is allowed", s == 200 and r["meal_goal_days"] == 0, (s, r))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"activity_goal_days": 3, "goal_week": "2020-01-06"}, ta)
check("G4 a goal week far from now is ignored (the server uses the current week)",
      s == 200 and all(h["from"] != "2020-01-06" for h in r["goal_history"]), (s, r.get("goal_history")))
s, r = call("PATCH", f"{PR}/{gb['id']}", {"goal_history": []}, ta)
check("G2 nobody writes the goal history directly (update)", s == 404, s)
s, r = call("PATCH", f"{PR}/{gb['id']}", {"service": ""}, ta)
check("G5 the service cannot be cleared", s == 404, s)
s, r = call("PATCH", f"{PR}/{pm['id']}", {"activity_goal_days": 7}, tpm)
check("G5 the patient cannot change their own goals", s == 404, s)
s, r = call("PATCH", f"{PR}/{gb['id']}", {"activity_goal_days": 7}, tb)
check("G5 another nutritionist cannot change them", s == 404, s)
s, mine = call("GET", f"{PR}/{pm['id']}", token=tpm)
check("G5 the patient reads their goals", s == 200 and mine.get("service") and "goal_history" in mine, s)

# ---- snacks per diet (spec "Snacks per diet + meal goal = all planned meals") ----
DR = "/api/collections/diets/records"
s, sp = new_patient(ta, a_id, "ZZ Colaciones")
s, d = call("POST", DR, {"patient": sp["id"], "meals": {"1": {"breakfast": "Avena"}}}, ta)
check("N1 a diet created without a snack number gets 2", s == 200 and d.get("snacks") == 2, (s, d))
s, r = call("PATCH", f"{DR}/{d['id']}", {"snacks": 4}, ta)
check("N1 4 snacks saves", s == 200 and r["snacks"] == 4, (s, r))
s, r = call("PATCH", f"{DR}/{d['id']}", {"snacks": 0}, ta)
check("N1 0 snacks saves", s == 200 and r["snacks"] == 0, (s, r))
s, r = call("PATCH", f"{DR}/{d['id']}", {"snacks": 5}, ta)
check("N2 more than 4 snacks is refused", s == 400, s)
s, r = call("PATCH", f"{DR}/{d['id']}", {"snacks": -1}, ta)
check("N2 negative snacks is refused", s == 400, s)
s, r = call("POST", "/api/collections/diet_templates/records", {"nutritionist": a_id, "title": "ZZ Tpl Colaciones", "meals": {}}, ta)
check("N1 a template without a snack number gets 2", s == 200 and r.get("snacks") == 2, (s, r))
s, sn = joined_patient(ta, a_id, "ZZ Colación Nocturna")
pn, tpn = s, sn
for slot in ("snack_early", "snack_night"):
    s, r = call("POST", ML, {"patient": pn["id"], "date": d0, "slot": slot}, tpn)
    check(f"N3 a patient checks the new slot {slot}", s == 200, (s, r))
s, r = call("POST", ML, {"patient": pn["id"], "date": d0, "slot": "snack_midnight"}, tpn)
check("N3 an unknown slot is refused", s == 400, s)

# ---- Google Calendar subscription link (spec "Feature: Agenda", Slice 2) ----
def ics_get(token):
    req = urllib.request.Request(f"{BASE}/api/plato/calendar/{token}.ics")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode("utf-8").replace("\r\n ", ""), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, "", ""
time.sleep(61)  # the shared /api/plato/ rate limit (20 a minute): the calendar checks below use ~15
CF = "/api/collections/calendar_feeds/records"
AP = "/api/collections/appointments/records"
soon = f"{date.today() + timedelta(days=3)} 18:00:00.000Z"
s, keep = call("POST", AP, {"nutritionist": a_id, "patient": pn["id"], "starts_at": soon, "duration_min": 45, "type": "Consulta de mediciones"}, ta)
call("POST", "/api/collections/appointment_notes/records", {"appointment": keep["id"], "nutritionist": a_id, "text": "NOTA-PRIVADA-XYZ"}, ta)
s, gone = call("POST", AP, {"nutritionist": a_id, "patient": pn["id"], "starts_at": soon, "duration_min": 30, "type": "Cita cancelada ZZ"}, ta)
call("PATCH", f"{AP}/{gone['id']}", {"cancelled_at": "2000-01-01 00:00:00.000Z"}, ta)
s, en = call("POST", "/api/plato/calendar/enable", {}, ta)
check("C1 the nutritionist turns the calendar link on (secret of 40+ characters)", s == 200 and len(en.get("token", "")) >= 40, (s, en))
s, en2 = call("POST", "/api/plato/calendar/enable", {}, ta)
check("C1 turning it on again keeps the same address", s == 200 and en2.get("token") == en.get("token"), s)
s, ics, ct = ics_get(en["token"])
check("C2 the address returns a calendar (text/calendar) with the appointment, patient name and type",
      s == 200 and ct.startswith("text/calendar") and "BEGIN:VCALENDAR" in ics and f"UID:{keep['id']}@aht-fitness" in ics
      and "SUMMARY:Cita: ZZ Colación Nocturna — Consulta de mediciones" in ics, (s, ct, ics[:300]))
check("C2 start and end in UTC (45 minutes)", "DTSTART:" + soon.replace("-", "").replace(" ", "T").replace(":", "")[:15] + "Z" in ics
      and "DTEND:" + soon.replace("-", "").replace(" ", "T").replace(":", "")[:11] + "45" + "00Z" in ics, ics[:600])
check("C3 never the private note or a cancelled appointment", "NOTA-PRIVADA-XYZ" not in ics and gone["id"] not in ics and "Cita cancelada ZZ" not in ics, ics[:400])
s, r = call("GET", CF, token=tpn)
check("C4 a patient cannot read their nutritionist's link", s == 200 and r["totalItems"] == 0, (s, r))
s, r = call("GET", CF, token=tb)
check("C4 another nutritionist cannot read it", s == 200 and r["totalItems"] == 0, (s, r))
s, r = call("GET", CF)
check("C4 a guest cannot read it", s in (200, 401, 403) and (s != 200 or r["totalItems"] == 0), (s, r))
s, r = call("POST", CF, {"nutritionist": a_id, "token": "Z" * 48, "enabled": True}, ta)
check("C4 nobody writes a link directly (only the server makes them)", s in (400, 403), s)
s, r = call("POST", "/api/plato/calendar/enable", {}, tpn)
check("C4 a patient cannot turn a link on", s in (401, 403), s)
s, b_ics, _ = (lambda en_b: ics_get(en_b["token"]))(call("POST", "/api/plato/calendar/enable", {}, tb)[1])
check("C3 another nutritionist's calendar has none of these appointments", s == 200 and keep["id"] not in b_ics, s)
s, rot = call("POST", "/api/plato/calendar/rotate", {}, ta)
check("C5 Cambiar enlace: a new address works and the old one is gone",
      s == 200 and rot["token"] != en["token"] and ics_get(rot["token"])[0] == 200 and ics_get(en["token"])[0] == 404, s)
s, r = call("POST", "/api/plato/calendar/disable", {}, ta)
check("C6 Desactivar: no address works", s == 200 and ics_get(rot["token"])[0] == 404, s)
bad = [ics_get("x" * 48)[0], ics_get("short")[0], ics_get("..%2F..%2Fetc")[0]]
check("C6 a made-up or malformed address: not found", bad == [404, 404, 404], bad)

time.sleep(61)  # let the shared /api/plato/ rate limit reset after the calendar checks

# ---- closed sign-up: nutritionist accounts are made by the admin ----
ce = f"zz-{uuid.uuid4().hex[:8]}@test.local"; cp_ = pw()
s, r = call("POST", "/api/collections/nutritionists/records", {"email": ce, "password": cp_, "passwordConfirm": cp_, "name": "ZZ Intruso"})
check("S1 a guest cannot create a nutritionist account", s in (400, 403), (s, r))
s, r = call("POST", "/api/collections/nutritionists/records", {"email": ce, "password": cp_, "passwordConfirm": cp_, "name": "ZZ Intruso"}, ta)
check("S1 a nutritionist cannot create another one", s in (400, 403), (s, r))
s, r = call("POST", "/api/collections/nutritionists/records", {"email": ce, "password": cp_, "passwordConfirm": cp_, "name": "ZZ Intruso"}, tpm)
check("S1 a patient cannot create one", s in (400, 403), (s, r))

# ---- agenda, slice 1 (spec "Feature: Agenda — the nutritionist's own calendar") ----
AP, AN = "/api/collections/appointments/records", "/api/collections/appointment_notes/records"
s, pcl = new_patient(ta, a_id, "ZZ Cita Cerrada")
s, r = call("POST", f"/api/plato/patients/{pcl['id']}/close", {}, ta)
s, pcv = call("GET", f"{PR}/{pcl['id']}", token=ta)
when = f"{date.today() + timedelta(days=2)} 22:00:00.000Z"
appt = {"nutritionist": a_id, "patient": pm["id"], "starts_at": when, "duration_min": 60, "type": "Consulta nutricional presencial"}
s, ap = call("POST", AP, appt, ta)
check("A1 the nutritionist creates an appointment with their patient; the server stamps changed_at", s == 200 and ap.get("changed_at"), (s, ap))
s, nt = call("POST", AN, {"appointment": ap["id"], "nutritionist": a_id, "text": "Revisar dolor de rodilla"}, ta)
check("A1 a private note goes with it", s == 200, (s, nt))
s, r = call("POST", AP, {**appt, "patient": pz["id"]}, ta)
check("A2 not with another nutritionist's patient", s in (400, 403, 404), s)
s, r = call("POST", AP, {**appt, "nutritionist": b_id}, ta)
check("A2 not in another nutritionist's name", s in (400, 403, 404), s)
s, r = call("POST", AP, {**appt, "patient": pcl["id"]}, ta)
check("A2 not with a closed account", s in (400, 403, 404) and pcv.get("archived_at"), (s, pcv.get("archived_at")))
s, r = call("POST", AP, appt, tpm)
check("A3 a patient cannot create appointments", s in (400, 403, 404), s)
s, r = call("POST", AP, {**appt, "duration_min": 47}, ta)
check("A4 duration in steps of 5", s == 400, s)
s, r = call("POST", AP, {**appt, "duration_min": 300}, ta)
check("A4 more than 240 minutes is refused", s == 400, s)
s, r = call("POST", AP, {**appt, "type": "   "}, ta)
check("A4 a consultation type is required", s == 400, s)
s, mine = call("GET", f"{AP}?filter=" + urllib.parse.quote(f"patient = '{pm['id']}'"), token=tpm)
check("A5 the patient reads their appointment", s == 200 and mine["totalItems"] == 1 and mine["items"][0]["type"] == "Consulta nutricional presencial", (s, mine))
s, r = call("GET", f"{AN}?filter=" + urllib.parse.quote(f"appointment = '{ap['id']}'"), token=tpm)
check("A5 the patient never reads the private note (list is empty)", s == 200 and r["totalItems"] == 0, (s, r))
s, r = call("GET", f"{AN}/{nt['id']}", token=tpm)
check("A5 nor by id", s == 404, s)
s, r = call("GET", AP, token=tpz)
check("A5 another patient sees none of it", s == 200 and r["totalItems"] == 0, (s, r))
s, r = call("GET", AP, token=tb)
check("A5 another nutritionist sees none of it", s == 200 and r["totalItems"] == 0, (s, r))
s, r = call("PATCH", f"{AP}/{ap['id']}", {"duration_min": 30}, tpm)
check("A3 the patient cannot change it", s == 404, s)
time.sleep(1.1)
s, up = call("PATCH", f"{AP}/{ap['id']}", {"starts_at": f"{date.today() + timedelta(days=2)} 23:00:00.000Z"}, ta)
check("A6 moving the time updates changed_at (the patient sees it as new)", s == 200 and up["changed_at"] > ap["changed_at"], (s, up.get("changed_at"), ap["changed_at"]))
s, r = call("PATCH", f"{AP}/{ap['id']}", {"changed_at": "2020-01-01 00:00:00.000Z"}, ta)
check("A6 nobody writes changed_at directly", s == 404, s)
s, cx = call("PATCH", f"{AP}/{ap['id']}", {"cancelled_at": "2000-01-01 00:00:00.000Z"}, ta)
check("A7 cancelling stamps the server time (not the sent one)", s == 200 and cx["cancelled_at"][:4] != "2000", (s, cx.get("cancelled_at")))
s, r = call("PATCH", f"{AP}/{ap['id']}", {"patient": pz["id"]}, ta)
check("A2 it cannot be moved to another nutritionist's patient", s == 404, s)
TY = f"/api/collections/nutritionists/records/{a_id}"
s, r = call("PATCH", TY, {"appointment_types": [{"name": "Valoración", "minutes": 60}, {"name": "  ", "minutes": 60}]}, ta)
check("A8 an empty consultation type is refused (with a clear message)", s == 400 and "nombre" in json.dumps(r, ensure_ascii=False), (s, r))
s, r = call("PATCH", TY, {"appointment_types": [{"name": "Valoración", "minutes": 47}]}, ta)
check("A8 a type's minutes go in steps of 5 (15-240)", s == 400, s)
s, r = call("PATCH", TY, {"appointment_types": ["Valoración"]}, ta)
check("A8 a type needs a name and minutes (plain names refused)", s == 400, s)
s, r = call("PATCH", TY, {"appointment_types": [{"name": " Consulta de mediciones ", "minutes": 30}, {"name": "Seguimiento", "minutes": 45}, {"name": "consulta de mediciones", "minutes": 60}]}, ta)
check("A8 the types list saves (trimmed, duplicates removed)", s == 200 and r["appointment_types"] == [{"name": "Consulta de mediciones", "minutes": 30}, {"name": "Seguimiento", "minutes": 45}], (s, r.get("appointment_types")))
s, fresh_n = call("GET", f"/api/collections/nutritionists/records/{b_id}", token=tb)
ft = fresh_n.get("appointment_types") or []
check("A8 nutritionists start with the client's 5 types and their durations", len(ft) == 5 and {"name": "Consulta de mediciones", "minutes": 30} in ft and {"name": "Consulta de alto rendimiento deportivo", "minutes": 90} in ft, ft)
s, r = call("DELETE", f"{AP}/{ap['id']}", token=ta)
s2, r2 = call("GET", f"{AN}/{nt['id']}", token=ta)
check("A9 deleting the appointment deletes its note", s == 204 and s2 == 404, (s, s2))

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)

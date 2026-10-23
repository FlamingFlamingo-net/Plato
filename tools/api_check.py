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
import urllib.error
import urllib.request
import uuid
from datetime import date

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8091"
results = []


def call(method, path, body=None, token=None, files=None):
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
                {"name": name, "sex": "female", "height_cm": 160, "nutritionist": nid, "password": p, "passwordConfirm": p}, tok)


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

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)

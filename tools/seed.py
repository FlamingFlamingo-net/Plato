"""Seed AHT Fitness with demo data: one nutritionist, two fake patients. All names are fictional.

  python tools/seed.py http://127.0.0.1:8090 [out_dir]

Writes <out_dir>/DEMO-LOGINS.txt (emails + generated passwords; keep it private, it is git-ignored)
and <out_dir>/demo-tokens.json (session tokens for automated checks).
Run once per database: a second run fails because the demo email already exists.
"""
import io
import json
import secrets
import sys
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "seed")
OUT.mkdir(parents=True, exist_ok=True)


def call(method, path, body=None, token=None, files=None):
    headers, data = {}, None
    if files:
        b = uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in (body or {}).items():
            buf.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for k, (fn, content, ct) in files.items():
            buf.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n".encode() + content + b"\r\n")
        buf.write(f"--{b}--\r\n".encode())
        data, headers["Content-Type"] = buf.getvalue(), f"multipart/form-data; boundary={b}"
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read()[:300]!r}")


def food_photo(colors):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (800, 600), (214, 196, 170))
    d = ImageDraw.Draw(im)
    d.ellipse([150, 50, 650, 550], fill=(250, 248, 242), outline=(225, 220, 210), width=8)
    spots = [(330, 220, 90), (470, 260, 80), (380, 380, 85)]
    for (x, y, r), c in zip(spots, colors):
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85)
    return b.getvalue()


pw_nutri = secrets.token_urlsafe(12)
nutri_email = "laura.demo@plato.local"
call("POST", "/api/collections/nutritionists/records", {
    "email": nutri_email, "password": pw_nutri, "passwordConfirm": pw_nutri,
    "name": "Laura Méndez", "clinic_name": "Consultorio Demo",
})
tn = call("POST", "/api/collections/nutritionists/auth-with-password", {"identity": nutri_email, "password": pw_nutri})
token_n, nid = tn["token"], tn["record"]["id"]


def patient(name, sex, birth, height, service="nutrition"):
    p = secrets.token_hex(16)
    return call("POST", "/api/collections/patients/records", {
        "name": name, "sex": sex, "birth_date": f"{birth} 12:00:00.000Z", "height_cm": height,
        "nutritionist": nid, "password": p, "passwordConfirm": p, "service": service,
    }, token_n)


ana = patient("Ana López Ríos", "female", "1991-03-14", 162, "both")
carlos = patient("Carlos Ruiz Peña", "male", "1985-11-02", 175)

today = date.today()
for weeks, w, fat, waist in [(6, 78.4, 34.0, 92), (4, 77.1, 33.2, 90), (2, 76.0, 32.5, 88.5), (0, 75.2, 31.8, 87)]:
    call("POST", "/api/collections/measurements/records", {
        "patient": ana["id"], "date": f"{today - timedelta(weeks=weeks)} 12:00:00.000Z",
        "weight_kg": w, "body_fat_pct": fat, "waist_cm": waist,
    }, token_n)

week = {
    "breakfast": ["Avena con plátano y canela", "2 huevos a la mexicana, 1 tortilla, papaya", "Yogur natural con fresas y granola",
                  "Chilaquiles verdes horneados con pollo", "Molletes integrales con pico de gallo", "Hot cakes de avena con fruta", "Huevos rancheros, frijoles de olla"],
    "snack_am": ["1 manzana y 10 almendras", "Jícama con limón y chile", "1 pera", "Pepino con limón", "10 nueces", "1 taza de melón", ""],
    "lunch": ["Pechuga a la plancha, arroz integral, ensalada", "Sopa de lentejas, 2 tortillas, nopales", "Pescado empapelado con verduras",
              "Tinga de pollo en tostadas horneadas", "Caldo de res con verduras", "Tacos de bistec con verduras", "Pozole de pollo (sin grasa)"],
    "snack_pm": ["Gelatina light", "1 naranja", "Palomitas naturales (2 tazas)", "1 yogur griego", "Zanahoria rallada con limón", "", ""],
    "dinner": ["Quesadillas de nopal con queso panela", "Ensalada de atún con galletas integrales", "Sándwich integral de pavo",
               "Crema de calabaza sin crema", "Omelette de espinaca", "Tostadas de pollo", "Fruta picada con queso cottage"],
}
meals = {str(d + 1): {k: v[d] for k, v in week.items() if v[d]} for d in range(7)}
call("POST", "/api/collections/diets/records", {"patient": ana["id"], "title": "Plan para bajar de peso — fase 1", "meals": meals}, token_n)
call("POST", "/api/collections/patient_notes/records", {"patient": ana["id"], "text": "Refiere antojos por la noche. Revisar cena y horario de sueño en la próxima consulta."}, token_n)

# Ana accepts her invite (gets email + password) and logs yesterday's lunch.
inv = call("POST", "/api/plato/invite", {"patient": ana["id"]}, token_n)
pw_ana = secrets.token_urlsafe(12)
ana_email = "ana.demo@plato.local"
ja = call("POST", "/api/plato/join", {"token": inv["token"], "email": ana_email, "password": pw_ana})
token_a = ja["token"]
yesterday = (today - timedelta(days=1)).isoformat()
call("POST", "/api/collections/meal_logs/records",
     {"patient": ana["id"], "date": yesterday, "slot": "breakfast", "note": "Con poquito de miel"}, token_a,
     files={"photo": ("desayuno.jpg", food_photo([(222, 190, 140), (245, 215, 90), (200, 160, 120)]), "image/jpeg")})
call("POST", "/api/collections/meal_logs/records",
     {"patient": ana["id"], "date": yesterday, "slot": "lunch", "note": ""}, token_a,
     files={"photo": ("comida.jpg", food_photo([(240, 230, 210), (120, 170, 90), (230, 120, 70)]), "image/jpeg")})
call("POST", "/api/collections/activity_logs/records",
     {"patient": ana["id"], "date": yesterday, "kind": "walk", "minutes": 40, "terrain": "flat", "distance_km": 3.2,
      "intensity": "moderate", "note": "Con mi perro"}, token_a)

(OUT / "DEMO-LOGINS.txt").write_text(
    "AHT Fitness demo logins (fictional people). Keep this file private.\n\n"
    f"Nutritionist  {nutri_email}  {pw_nutri}\n"
    f"Patient (Ana) {ana_email}  {pw_ana}\n"
    "Patient (Carlos) has no app yet: open him and use Acceso to make his invite link.\n",
    encoding="utf-8")
(OUT / "demo-tokens.json").write_text(json.dumps({
    "nutritionist": {"token": token_n, "record": tn["record"]},
    "ana": {"token": token_a, "record": ja["record"]},
    "carlos_id": carlos["id"], "ana_id": ana["id"],
}), encoding="utf-8")
print(f"Seeded: nutritionist + Ana (joined, 4 measurements, diet, 2 meal photos) + Carlos (no app). Files in {OUT}")

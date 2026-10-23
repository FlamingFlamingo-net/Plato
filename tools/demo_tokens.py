"""Sign in the demo accounts from seed/DEMO-LOGINS.txt and write session tokens for tools/smoke.mjs.
Passwords are read from the file and never printed.
  python tools/demo_tokens.py http://127.0.0.1:8090 OUT.json
"""
import json, re, sys, urllib.request
from pathlib import Path

base, out = sys.argv[1], sys.argv[2]
txt = (Path(__file__).resolve().parent.parent / "seed/DEMO-LOGINS.txt").read_text(encoding="utf-8")
creds = dict(re.findall(r"^(Nutritionist|Patient \(Ana\))\s+\S+@\S+\s+(\S+)$", txt, re.M))
emails = dict(re.findall(r"^(Nutritionist|Patient \(Ana\))\s+(\S+@\S+)", txt, re.M))


def auth(col, who):
    req = urllib.request.Request(f"{base}/api/collections/{col}/auth-with-password", method="POST",
                                 data=json.dumps({"identity": emails[who], "password": creds[who]}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


n = auth("nutritionists", "Nutritionist")
a = auth("patients", "Patient (Ana)")
pats = json.load(urllib.request.urlopen(urllib.request.Request(
    f"{base}/api/collections/patients/records?sort=name", headers={"Authorization": n["token"]})))["items"]
Path(out).write_text(json.dumps({
    "nutritionist": {"token": n["token"], "record": n["record"]},
    "ana": {"token": a["token"], "record": a["record"]},
    "ana_id": a["record"]["id"],
}), encoding="utf-8")
print(f"signed in: {n['record']['name']} (nutritionist), {a['record']['name']} (patient); patients on server: {len(pats)}")

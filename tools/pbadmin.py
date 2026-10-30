"""Test helper: nutritionist accounts are made by the admin (public sign-up is closed).

create_nutritionist(base, email, password, name, clinic_name="", container=None) makes a throwaway superuser
inside the given container (PB_CONTAINER, default "pb-check"), creates the nutritionist with it, and removes
that superuser again (so seeding the real local server leaves no extra admin behind).
"""
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.request


def _post(base, path, body, token=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"Authorization": token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def create_nutritionist(base, email, password, name, clinic_name="", container=None):
    box = container or os.environ.get("PB_CONTAINER", "pb-check")
    su_email, su_pw = f"zz-admin-{secrets.token_hex(4)}@test.local", "Zz" + secrets.token_hex(12)
    subprocess.run(["docker", "exec", box, "/pb/pocketbase", "superuser", "upsert", su_email, su_pw], capture_output=True, check=True)
    try:
        s, su = _post(base, "/api/collections/_superusers/auth-with-password", {"identity": su_email, "password": su_pw})
        assert s == 200, (s, su)
        s, r = _post(base, "/api/collections/nutritionists/records",
                     {"email": email, "password": password, "passwordConfirm": password, "name": name, "clinic_name": clinic_name}, su["token"])
        assert s == 200, (s, r)
        return r
    finally:
        subprocess.run(["docker", "exec", box, "/pb/pocketbase", "superuser", "delete", su_email], capture_output=True)

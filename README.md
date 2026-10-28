# Plato (working name)

A nutritionist gives each patient a weekly diet. The patient follows it on the phone and sends a photo of each meal.
Spec: `specs/plato.md`.

## Start and stop

The app runs inside Docker. One server does the website, sign-in, database, and photos.

```bash
cd pocketbase   # the folder you cloned
docker compose up -d      # start
docker compose stop       # stop
docker compose logs -f    # see what the server is doing
```

## Open it

- On this computer: http://localhost:8090
- Demo logins: `seed/DEMO-LOGINS.txt` (fictional people, generated passwords). Keep that file private.
- Admin screen (all data, all accounts): http://localhost:8090/_/ — create your admin account the first time:
  `docker exec -it pocketbase /pb/pocketbase superuser upsert you@example.com YOUR_PASSWORD`

## Install the app

On the start page, tap **Instalar app** (Chrome, Edge, Android). On iPhone: Share → Add to Home Screen.
The installed app opens with no signal. Saving needs a connection.

To install on a **real phone**, the site must be on HTTPS (a tunnel or a real server). By default only this
computer can open the app. For a phone on the same Wi-Fi, change the port line in `docker-compose.yml` to
`"8090:8090"`, run `docker compose up -d`, open `http://<this-PC's-IP>:8090` on the phone, and change it back
afterwards. Without HTTPS the phone can use the app but not install it.

## Data

Everything is saved in `pb_data/` on this computer. **Do not delete that folder.** Back it up to a different place.
Use fake patients until you have a privacy notice (aviso de privacidad).

## Folders

| Folder | What it is |
|---|---|
| `pb_public/` | The website: plain HTML, CSS, JS. Basecoat UI copied into `vendor/`. No build step. |
| `pb_migrations/` | Database tables and who may read or change them. |
| `pb_hooks/` | Invite links (join and reset access). |
| `tools/` | Checks and demo data. Not part of the app. |
| `specs/` | The living product spec. |

## Checks (developer)

Run them against a **throwaway** server, never the real one:

```bash
docker run -d --rm --name pb-check -p 127.0.0.1:8091:8090 \
  -v "$PWD/pb_hooks:/pb/pb_hooks" \
  -v "$PWD/pb_migrations:/pb/pb_migrations" \
  -v "$PWD/pb_public:/pb/pb_public" pocketbase-local:0.40.5
PB_CONTAINER=pb-check python tools/api_check.py http://127.0.0.1:8091 # 200 checks: permissions, invites, rate limits, close account, activity, progress photos, templates, feedback, age limits, home profile, meal checklist, weekly goals
PHOTO=path/to/photo.jpg node tools/e2e.mjs http://127.0.0.1:8091 out --offline-after "docker stop pb-check"   # 22 screen checks
python tools/seed.py http://127.0.0.1:8091 out/seed                   # demo data + session tokens (fresh server)
PDF_PYTHON=python node tools/docs_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out   # 25 print + export checks
node tools/close_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out    # 12 close-account screen checks (fresh seed)
node tools/activity_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 17 activity-log screen checks (fresh seed)
PHOTO=photo.jpg node tools/progress_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 15 progress-photo screen checks (fresh seed)
node tools/templates_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 14 diet-template screen checks (fresh seed)
PHOTO=photo.jpg node tools/feedback_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 16 photo-feedback screen checks (fresh seed)
PB_CONTAINER=pb-check node tools/age_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 13 age-limit screen checks (fresh seed)
PHOTO=photo.jpg node tools/home_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 18 home-screen checks (fresh seed)
PHOTO=photo.jpg node tools/checklist_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 21 meal-checklist screen checks (fresh seed)
PB_CONTAINER=pb-check node tools/goal_check.mjs http://127.0.0.1:8091 out/seed/demo-tokens.json out # 27 weekly-goal screen checks (fresh seed)
```

`docs_check.mjs` reads the PDFs with `tools/pdf_info.py`, which needs PyMuPDF (`pip install pymupdf`); point `PDF_PYTHON` at that Python.

`api_check.py` needs Python with Pillow. `e2e.mjs` needs Node 22+ and Chrome; it is a test tool only.

## Release checklist

1. Bump `VERSION` in `pb_public/sw.js` and the `?v=` on CSS/JS links, so installed apps pick up new code.
2. Run both checks.
3. Restart: `docker compose restart pocketbase`.

## License

MIT. See `LICENSE`. Basecoat UI in `pb_public/vendor/` keeps its own MIT license.

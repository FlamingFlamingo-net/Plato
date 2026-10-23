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

To install on a **real phone**, the site must be on HTTPS (a tunnel or a real server). A phone on the same Wi-Fi
can open `http://<this-PC's-IP>:8090` and use the app, but it cannot install it without HTTPS.

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
python tools/api_check.py http://127.0.0.1:8091                       # 42 permission + invite checks
PHOTO=path/to/photo.jpg node tools/e2e.mjs http://127.0.0.1:8091 out --offline-after "docker stop pb-check"   # 22 screen checks
```

`api_check.py` needs Python with Pillow. `e2e.mjs` needs Node 22+ and Chrome; it is a test tool only.

## Release checklist

1. Bump `VERSION` in `pb_public/sw.js` and the `?v=` on CSS/JS links, so installed apps pick up new code.
2. Run both checks.
3. Restart: `docker compose restart pocketbase`.

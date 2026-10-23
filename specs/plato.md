# Plato (working name)

A nutritionist gives each patient a weekly diet. The patient follows it on the phone and sends a photo of each meal.

**Status:** built (v1) + security fixes. Parked: Online plan.
**Offline:** off.
**Source:** triage of nutrimind.net features, rows 1–10 (P0).

## v1 (floor)

Time to demo: 10 minutes. Two devices: a laptop (nutritionist) and a phone (patient).

1. On the laptop, open the site. Sign up as a nutritionist with email and password.
2. Click **New patient**. Type the name, sex, birth date, and height. Save.
3. Add a measurement: weight, body fat %, waist. Save.
4. Open the **Diet** tab. Type the meals for Monday to Sunday. Save.
5. Click **Copy invite link**. Send the link to the phone (WhatsApp or any chat).
6. On the phone, open the link. Set a password. Tap **Install app**.
7. The installed app shows **Today**: the meals for today, in order.
8. Tap **Log** on lunch. Take a photo. Add a short note. Send.
9. The plate on **Today** fills one slice.
10. On the laptop, open the patient. The **Meal log** tab shows the photo with the date and meal.
11. Click **Seen**. On the phone, the meal shows "Seen by your nutritionist" after a refresh.
12. The patient opens **Progress**. The weight chart shows the first point.

## Offline

Off. The app needs a connection to save.
The installed app opens with no signal. It shows "No connection. Try again when you are online."
A photo is not lost: the patient can retake it when the connection is back. v1 does not keep it on the phone.

## Look & feel

- Three words: fresh, warm, encouraging.
- Must not look like: a hospital record system or a spreadsheet.
- Signature: **the plate**. On Today, a round plate has one slice per meal. A slice fills when the patient logs that meal. Only this product has it.
- UI language: Spanish (Mexico). Spec and code comments: English.
- Voice: short and kind. "¡Bien! Comida registrada." Not "Registro creado exitosamente."

## Later (ceiling)

| Item | Why it can wait | What v1 must not block |
|---|---|---|
| Print / PDF of the weekly diet (P1) | Patients can read it in the app. | Keep diet meals as structured rows, not one text blob. |
| Exercise log (P1) | Not in the core loop. | Logs are per patient and per date. A second log type fits the same shape. |
| Goals and mood check-in (P1) | Nice for motivation. Not needed to demo. | Patient owns their own records. |
| Patient rates the day (P1) | Photos already show compliance. | Logs have a date field. |
| Appointments and "next appointment" (P1) | The nutritionist uses their own calendar today. | None. |
| Comments on a meal photo (P1) | "Seen" closes the loop in v1. | Each log has an id. Comments attach to it later. |
| Saved diet templates (P1) | Typing one diet is enough to demo. | Diets are their own records, not fields on the patient. A template is a diet with no patient. |
| Clinic logo (P1) | Looks are fine without it. | One nutritionist record holds clinic details. |
| Recipes, macros, food exchange tables, visual diets (P2) | They need a licensed food database. That is a content project. | Meals stay free text in v1. A later version links a meal to foods. |
| Clinical, lab, and body-photo records (P2) | Health data needs stricter rules and a privacy notice. | Private notes already live apart from shared data. |
| Sports and pediatric tools (P2) | Specialist users. | Measurements are one row per date. More fields fit later. |
| AI features (P2) | They cost money per use, and the nutritionist must check every result. | None. |

## Who

| Role | Can see | Can do |
|---|---|---|
| Visitor | Sign-in page. Join page from an invite link. | Sign up as a nutritionist. Accept an invite. |
| Nutritionist | Only their own patients and all of their data. | Add and edit patients, measurements, diets, and private notes. Copy and reset invite links. Mark meal logs as seen. |
| Patient | Only their own diet, measurements, and meal logs. Never private notes. Never other patients. | Log a meal with a photo and a note. Delete their own log within the same day. |
| Staff (you) | Admin screen. | Fix data and accounts. |

Patients do not sign up alone. A patient account starts from a nutritionist's invite link.

## Happy path

1. The nutritionist signs up.
2. The nutritionist adds a patient.
3. The nutritionist records the first measurement.
4. The nutritionist types the weekly diet.
5. The nutritionist sends the invite link.
6. The patient sets a password and installs the app.
7. The patient sees today's meals.
8. The patient logs a meal with a photo.
9. The nutritionist sees the photo and marks it seen.
10. The patient sees "seen" and their weight chart.

## Not now

- App Store and Play Store listings. The Install button does this job.
- Email. Invites and password resets go by link, sent by the nutritionist.
- Payments and licences.
- Clinics with many nutritionists.
- Chat.
- Food database, recipes, and nutrient math.
- AI.

## Risks

- **Health data.** Use fake patients until a privacy notice (aviso de privacidad) exists. Real patient data needs it under Mexican law.
- **Lost password.** v1 has no email. The nutritionist clicks **Reset access** and sends a new link. The old link stops working.
- **A leaked invite link** lets someone else claim the patient. Links work once and expire after 7 days.
- If the server is off, nobody can save. Photos taken then must be retaken.
- Photos live on the server disk. If the disk is lost without a backup, the photos are lost.
- A refused save shows the old value and a short reason. Typed text is not dropped.

## Acceptance

Run on the current release. Mark each step pass or fail. Last run: 2026-10-19, headless Chrome (laptop 1280 px + phone 390 px emulation), `tools/e2e.mjs` 22/22 and `tools/api_check.py` 42/42.

1. Do the v1 steps 1–12 on a laptop and a phone. **Pass** (phone emulated in Chrome). Real phone: not checked yet.
2. Refresh both devices. Expect every change to still show. **Pass.**
3. Sign up a second nutritionist in a private window. Expect an empty patient list. Open the first patient's page address directly. Expect "not found". **Pass** ("No encontrado").
4. Sign in as the patient. Open the private notes address directly. Expect "not found". **Pass** (API returns nothing; the nutritionist screen sends the patient away).
5. Use the invite link a second time. Expect "This link was already used." **Pass** ("Este enlace ya se usó").
6. Turn the phone network off. Open the installed app. Expect it to open and show the no-connection message. **Pass** with the server stopped in Chrome. Installed app on a real phone in airplane mode: not checked yet (needs HTTPS).

## Open questions

1. Product name? **Recommended:** keep "Plato" as the working name. Rename before launch.
2. UI language? **Recommended:** Spanish (Mexico) only in v1. English later.
3. Fixed meal slots? **Recommended:** yes, five: breakfast, morning snack, lunch, afternoon snack, dinner. The nutritionist can leave a slot empty.
4. Does a diet repeat every week? **Recommended:** yes. One active diet per patient. A new diet replaces it.
5. Can a patient see their measurements? **Recommended:** yes, all of them. Private things go in notes.

---

## Decisions (made during build)

- Open questions 1–5: the recommended answers apply (Plato, Spanish UI, five fixed slots, one weekly diet that repeats, patient sees all measurements).
- The diet is one record per patient with the week in a structured `meals` field (day → meal → text), not 35 separate rows. One save, no half-saved weeks. A later version can still link a meal to foods.
- Patients pick their own email when they accept the invite. The nutritionist never sees or types a patient password.
- Meal photos are private files: only the patient and their nutritionist can open them.
- A patient can delete their own photo on the same day (UTC). Small extra: the overview shows BMI when height is known.
- PocketBase JS SDK not used (not on the approved library list). Screens use plain `fetch` in `js/api.js`.
- Basecoat CSS 1.0.2 is a local copy in `pb_public/vendor/` so the installed app opens with no signal. No Tailwind, no Basecoat JS.

---

## Security (audit 2026-10-23, fixed)

`pb-audit` found five things. All are fixed in `pb_migrations/1761264000_plato_security.js` and `docker-compose.yml`. Checks: `tools/api_check.py` 49/49.

| # | Was | Now |
|---|---|---|
| 1 | A nutritionist could pick a patient's email and password, then sign in as that patient. | Only the invite link sets a patient's email. The patient picks it. |
| 2 | No limit on wrong passwords. | 10 sign-in tries per minute per address. Then: "Demasiados intentos. Espera un minuto." |
| 3 | A nutritionist could switch on "show email" for a patient. | Blocked. The nutritionist never sees the patient's email. |
| 4 | Invite links could be guessed without limit (very hard anyway: 40 random characters). | 20 invite-link requests per minute per address. |
| 5 | Anyone on the same Wi-Fi could open the server over plain HTTP. | Only this PC can open it. For a phone test, open it to the network for that session only. |

Risk to remember when it goes online: limits count per address. Behind a proxy, every user can look like one address. `pb-deploy` must set the trusted proxy header.

---

## Online (plan — not approved, nothing set up)

**Host:** Fly.io, one always-on machine in Dallas (`dfw`, closest to Mexico) with one 3 GB disk.
**Address:** `https://plato-<name>.fly.dev` (HTTPS included). Own domain later.
**Cost:** about US$4–5 a month (512 MB machine ≈ $3.70, disk $0.45, traffic cents). Backups free (Cloudflare R2, 10 GB free).
**Never delete:** the Fly volume `pb_data`. It holds every account, diet, and photo.

| Topic | Decision |
|---|---|
| Sleep | Off. The machine never stops (sign-in breaks if it sleeps). |
| Servers | Exactly one. Never scale out. |
| Install button | Works: HTTPS is included. |
| Photos | On the server disk (fine to a few GB). Cloud bucket later. |
| Backups | Nightly PocketBase backup to a **separate** R2 bucket, keep 7. Keys typed by the owner in the admin screen. |
| Rate limits | Count the real user address from Fly's `Fly-Client-IP` header, only on Fly. |
| Admin | Owner creates the admin account over `fly ssh console`. The agent never sees the password. |
| Email | Not needed in v1 (invites and resets are links). Needed before password-reset or admin 2-step codes. |
| Data | Starts empty. No demo data online. Fake patients only until the privacy notice exists. |

Risks:
- Health data is "sensitive" under Mexican law (LFPDPPP). Real patients need a privacy notice and their express consent. The notice must say the data is stored in the USA.
- One machine: if it restarts, the app is gone for about a minute.
- A host outage takes the app down until it returns. Backups protect data, not uptime.

Acceptance (online): open the address on a real phone, tap Instalar app, do the v1 demo, refresh; airplane mode opens the app; a backup file exists in the bucket.

Alternatives checked (2026-10-23): PocketHost (managed PocketBase, $9.99/mo or ~$5/mo yearly; 250 MB database cap) — simpler, costs more, less control. Hetzner US VPS — now about $20/mo after its June 2026 price rise. A small VPS (DigitalOcean etc., price not checked) — we would patch and secure the server ourselves.

---

## Build notes

- **Collections** (PocketBase):
  - `nutritionists` (auth): `name`, `clinic_name`.
  - `patients` (auth): `name`, `sex` (female|male), `birth_date`, `height_cm`, `nutritionist` → nutritionists.
  - `invites`: `patient` → patients, `token` (random, hidden), `expires` (date), `used` (bool).
  - `measurements`: `patient`, `date`, `weight_kg`, `body_fat_pct`, `waist_cm`.
  - `diets`: `patient` (unique), `title`, `meals` (JSON: `{"1": {"breakfast": "…", …}, … "7": {…}}`, 1 = Monday).
  - `meal_logs`: `patient`, `date`, `slot`, `photo` (file, max 5 MB, image only), `note`, `seen_at`.
  - `patient_notes`: `patient`, `text`. Separate collection so no rule can leak it to the patient.
- **Rules** (role words, then rule):
  - Nutritionist owns a patient: `patients` list/view/update: `id = @request.auth.id || nutritionist = @request.auth.id`. Create: nutritionists only, `@request.body.nutritionist = @request.auth.id`.
  - Measurements, diets: nutritionist of that patient reads and writes. The patient reads only. E.g. view: `patient = @request.auth.id || patient.nutritionist = @request.auth.id`.
  - Meal logs: the patient creates and reads their own. The nutritionist reads them and updates only `seen_at`. The patient deletes their own on the same day.
  - Patient notes: nutritionist of that patient only. The patient has no access.
  - Invites: no public access. A JS hook handles them.
- **Hook** (`pb_hooks/plato.pb.js` + `plato_lib.js`): `POST /api/plato/invite` (nutritionist; makes a new link and voids old ones), `GET /api/plato/invite/{token}` (greeting), `POST /api/plato/join` (token + email + password → signed in, link used). Permission rules cannot set another account's password, so a hook is the right tool.
- **Screens:**
  - Nutritionist (laptop first): `index.html` (sign in / sign up), `patients.html` (list with "new photos" count), `patient.html` (tabs: Overview + chart, Diet, Meal log, Notes, Access).
  - Patient (phone first): `join.html` (set password), `today.html` (plate + meals + Log), `log.html` (camera input `accept="image/*" capture`), `progress.html` (weight chart).
  - Charts: inline SVG drawn by our own small script. No chart library.
- **Install:** manifest; service worker caches the shell and `pb_public/vendor/`; Install button. The shell opens with no signal. That is not a data-offline test.
- **Data:** screens call PocketBase directly. No IndexedDB, no outbox.
- **Live updates:** none. A refresh is enough on every screen.
- **Photos:** on the server disk (`pb_data`). Back up `pb_data` to a different place.
- **Libraries:** Basecoat and Tailwind (approved). Open decision: PocketBase JS SDK is not on the approved list. Default: plain `fetch` calls in a small `js/api.js`.
- **Tasks:**
  1. Create collections and rules as a migration in `pb_migrations/`.
  2. Write `pb_hooks/invites.pb.js` (join + reset).
  3. Add `pb_public/vendor/` copies, `css/theme.css`, `js/api.js` (auth, fetch helpers).
  4. Build nutritionist screens: sign-in, patients, patient tabs.
  5. Build patient screens: join, today with the plate, log, progress.
  6. Add manifest, service worker, Install button, no-connection message.
  7. Seed one fake nutritionist and two fake patients for the demo.
  8. Run the acceptance list on a laptop and a real phone. Record pass/fail here.

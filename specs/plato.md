# Plato (working name)

A nutritionist gives each patient a weekly diet. The patient follows it on the phone and sends a photo of each meal.

**Status:** built (v1) + security fixes + patient export + print weekly diet + close account. Patient activity dashboard: slices 1 (activity log) and 2 (progress photos) built; slice 3 (home with feeds) approved, not built. Parked: Online plan, Legal.
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
| Print / PDF of the weekly diet (P1) | Patients can read it in the app. | Keep diet meals as structured rows, not one text blob. **Now specced:** see "Feature: Print the weekly diet". |
| Exercise log (P1) | Not in the core loop. | Logs are per patient and per date. A second log type fits the same shape. **Now specced** inside "Feature: Patient activity dashboard". |
| Goals and mood check-in (P1) | Nice for motivation. Not needed to demo. | Patient owns their own records. |
| Patient rates the day (P1) | Photos already show compliance. | Logs have a date field. |
| Appointments and "next appointment" (P1) | The nutritionist uses their own calendar today. | None. |
| Comments on a meal photo (P1) | "Seen" closes the loop in v1. | Each log has an id. Comments attach to it later. |
| Saved diet templates (P1) | Typing one diet is enough to demo. | Diets are their own records, not fields on the patient. A template is a diet with no patient. |
| Clinic logo (P1) | Looks are fine without it. | One nutritionist record holds clinic details. |
| Recipes, macros, food exchange tables, visual diets (P2) | They need a licensed food database. That is a content project. | Meals stay free text in v1. A later version links a meal to foods. |
| Clinical, lab, and body-photo records (P2) | Health data needs stricter rules and a privacy notice. | Private notes already live apart from shared data. **Body (progress) photos now specced** inside "Feature: Patient activity dashboard"; clinical and lab records stay P2. |
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

## Legal (parked — no action until before real patients)

Not legal advice. A map of what to ask a lawyer. Checked 2026-10-23.
**Rule until then:** fake data only. Invite no real patients.

### Must clear before real patients

| # | Topic | What it means for Plato | Ask the lawyer |
|---|---|---|---|
| L1 | Data protection law: LFPDPPP 2025 (in force 2025-03-21; authority SABG, ex-INAI) | Health data is sensitive. It needs a privacy notice and express consent. The notice says data is stored in the USA (Fly.io, Dallas). | What form of consent? Is a checkbox at join enough? |
| L2 | Roles | The nutritionist is the controller (*responsable*). Plato is the processor (*encargado*). | Terms of use and a processing contract with each nutritionist. A privacy notice for nutritionists' own data. |
| L3 | ARCO rights (access, correction, deletion, objection) | Patients can ask for their data or its deletion. Plato needs export and close-account (features below). | Response deadlines. Who answers: the nutritionist or us? How does the nutritionist check the requester's identity before handing over data? How should the file be delivered securely (in person, paper, WhatsApp, email)? |
| L4 | Clinical record retention (NOM-004-SSA3-2012) | Records are kept at least 5 years after the last consultation. This conflicts with deletion. | Are a nutritionist's notes and measurements a clinical record? Archive instead of delete? |
| L5 | Breaches | A leak brings notice duties and fines. | What to do and whom to tell if data leaks. |

### Lower urgency

| # | Topic | Note |
|---|---|---|
| L6 | Electronic health record certification (NOM-024-SSA3-2012, DGIS) | Plato is a diet tool, not a full record system. Ask if certification applies, mainly before selling to clinics or government. |
| L7 | Trademark | Check "Plato" with IMPI before buying a domain. |
| L8 | Nutrimind | Use features as ideas only. Never copy their text, images, recipes, or food tables. |
| L9 | Minors | Pediatric patients need a parent or guardian's consent. Keep minors out until then. |
| L10 | Charging money | Taxes and invoices (SAT, CFDI). PROFECO if selling to consumers. |
| L11 | AI features | Health advice from AI carries liability. The nutritionist always decides. |
| L12 | Users in Spain | GDPR applies. Separate project. |

Already fine: MIT license for our code; Basecoat keeps its own MIT license.

---

## Feature: Export a patient's data (built)

**What:** the nutritionist downloads everything Plato holds about one patient. Use it when the patient asks for their data (L3), or when the patient moves to another nutritionist.

**Who:** the nutritionist of that patient only. Patients do not export by themselves in this version (the nutritionist is the controller, L2).

**Demo loop (2 minutes):**
1. Open a patient. Open the **Acceso** tab.
2. Click **Exportar datos**.
3. A printable page opens: profile, measurements with the weight chart, the weekly diet, and every meal log with its photo, date, meal and note.
4. Click **Guardar PDF**. The browser saves an A4 PDF.
5. Click **Descargar datos (JSON)**. The browser saves one `.json` file with the same data, readable by other software.

**Rules:**
- The export uses the same access rules as the patient page. Another nutritionist gets "No encontrado".
- Private notes are left out by default. A checkbox **Incluir notas privadas** adds them in their own section, "Notas privadas de la nutrióloga/o". The nutritionist decides per export (open question 1).
- The patient's email is **not** in the export. Since the security fix the nutritionist cannot see it, and the patient already knows it. Passwords and invite links are never in it. (Changed during build.)
- Photos are in the PDF. The JSON lists each photo by date, meal and file name; the photos stay in the PDF.
- Nothing is changed by an export.

**Screens and files:** `pb_public/export.html` + `js/export.js` (A4 print styles, the profile's PDF rules). A button on the Acceso tab. No new collection, no hook: the page reads the APIs the nutritionist can already read.

**Acceptance:**
1. Export the demo patient Ana. Expect 4 measurements, the chart, 7 days of diet, 2 photos and no private notes. Tick **Incluir notas privadas**: expect 1 note. Expect the same counts in the JSON.
2. The PDF is A4 (595 × 842 pt), and no photo is cut across two pages.
3. As a second nutritionist, open Ana's export address. Expect "No encontrado".
4. Signed in as Ana, open the export address. Expect to be sent back to Today.

**Result (2026-10-24, `tools/docs_check.mjs`, throwaway server):** acceptance 1–4 pass. PDF: A4 portrait on every page; each photo whole on one page; no notes unless ticked; no email in PDF or JSON.

**Later:** the patient exports from their own app; one ZIP with full-size photos; a log of who exported and when.

**Not now:** automatic emails with the file (no email in v1).

---

## Feature: Close a patient's account (built)

**What:** the nutritionist closes a patient's account when the patient asks (L3) or stops treatment. Default is **archive**, not delete, because clinical records may need to stay 5 years (L4). Permanent deletion is a second, separate step.

**Who:** the nutritionist of that patient only.

**Demo loop (3 minutes):**
1. Open a patient. Open the **Acceso** tab. Click **Cerrar cuenta**.
2. A dialog explains in one paragraph: the patient can no longer sign in; the data is kept, read-only, for the retention period; nothing is deleted.
3. Type the patient's first name to confirm. Click **Cerrar cuenta**.
4. The patient leaves the main list. A **Archivados** filter shows them, with the closing date.
5. On the phone, the patient's app goes to the sign-in page with "Tu sesión terminó. … Si tu cuenta se cerró o cambiaste de teléfono, habla con tu nutrióloga o nutriólogo." The old email and password no longer work. (Changed during build: closing clears the email, so the server cannot tell a closed account from a wrong password at sign-in.)
6. To undo: open the archived patient, click **Reactivar**, then make a new invite link. The old password does not come back.
7. To delete for good: open the archived patient, click **Borrar definitivamente**, read the 5-year warning, type the full name. All data and photos are deleted. This cannot be undone.

**Rules:**
- Closing: the server clears the patient's email, sets a random password, ends every session (new token key), and voids open invite links. A hook does this; rules cannot.
- Archived patient: nobody can add measurements, diet changes, meal logs or notes. The nutritionist can still read and export.
- No invite link for an archived patient.
- Permanent delete works only on an archived patient. It removes the patient, measurements, diet, meal logs, photos, notes and invites (they already delete together).
- Closing and deleting need the typed name, so one wrong click does nothing.

**Data:** `patients` gets `archived_at` (date, empty = active). Write rules on measurements, diets, meal_logs and patient_notes add `patient.archived_at = ""`. Patient delete rule adds `archived_at != ""`.

**Screens and files:** dialogs on the Acceso tab; an Archivados filter on the patient list; a closed-account message in the patient app; `pb_hooks/plato.pb.js` gets `POST /api/plato/patients/{id}/close` and `/reopen`; one new migration.

**Acceptance:**
1. Close Carlos. Expect him gone from the list and present under Archivados.
2. Try his old session and his old password. Expect both to fail.
3. Try to add a measurement to him (screen and API). Expect refusal.
4. Try to make an invite link for him. Expect refusal.
5. Reactivate him, make a link, join again. Expect it to work.
6. Archive and delete permanently. Expect his photos' addresses to return "not found".
7. As a second nutritionist, try close, reopen and delete on Carlos. Expect "No encontrado".
8. Try to delete an active patient directly through the API. Expect refusal.

**Result (2026-10-25, throwaway server):** acceptance 1–8 pass at the API (`tools/api_check.py`, 24 checks) and on screen (`tools/close_check.mjs`, 12 checks). Archived patients: own list (**Archivados**), every tab read-only, export still works.

**Later:** the patient asks to close from their own app (the nutritionist approves); automatic deletion 5 years after the last consultation; a log of closings and deletions.

**Not now:** closing a nutritionist's own account.

### Decisions (both features, accepted 2026-10-23)

1. Private notes in the export: the nutritionist decides per export (checkbox, off by default). Confirm with the lawyer later (L3, L4).
2. Retention: warn about 5 years; do not block permanent deletion. Confirm with the lawyer later (L4).
3. Closing needs no reason. One confirm step: type the patient's name.
4. Reactivation keeps old meal logs. Nothing is deleted on close.

---

## Feature: Print the weekly diet (built)

**What:** one A4 sheet with the whole week's diet, to print or save as PDF. Patients put it on the fridge. Nutritionists hand it over at the visit. From the Later list (P1).

**Who:** the nutritionist (for their patient) and the patient (their own diet). Same read rules as today: nobody else.

**Demo loop (2 minutes):**
1. Nutritionist: open Ana. Open the **Dieta** tab. Click **Imprimir semana**.
2. A print page opens: one A4 sheet, landscape. Days are columns (Lunes … Domingo). Meals are rows (Desayuno … Cena), each with its plate colour.
3. The top shows: plan name, patient name, "Plan de Laura Méndez · Consultorio Demo", and the date printed.
4. Click **Imprimir / Guardar PDF**. The browser print dialog opens.
5. Patient: on the phone, open **Hoy**. Tap **Imprimir mi semana**. The same sheet opens. On the phone it shows as a scrollable preview with the same print button.

**Rules:**
- Landscape A4, 12 mm margins. One sheet for a normal diet.
- A very long diet flows to a second sheet. The day names repeat at the top of each sheet. A meal cell never splits across sheets.
- An empty meal shows "—". A day with no meals still shows its column.
- No diet yet: the page says "Aún no hay dieta" and the print button is off.
- Only the diet. No measurements, no photos, no private notes.
- Unsaved changes in the Diet tab: the button asks "Guarda la dieta antes de imprimir" and does not open the page.
- Colours print (print-color-adjust: exact). The sheet stays readable in black and white: meal names are text, not only colour.
- Needs a connection (Offline: off). Offline, the page shows the no-connection message.

**Screens and files:** `pb_public/diet-print.html` + `js/diet-print.js` (`?id=` for the nutritionist; the patient's own id when signed in as a patient). A button on the Diet tab and on Hoy. The weekly-diet block is written once and reused later by the patient export.

**Acceptance:**
1. Print Ana's diet as the nutritionist. Expect 1 page, A4 landscape (842 × 595 pt), 7 columns, 5 rows, her plan name and the nutritionist's name.
2. Print the same diet as Ana from the phone. Expect the same content.
3. A test diet with long text in every meal. Expect 2 pages, day names on both, no meal cut across pages.
4. A patient with no diet. Expect "Aún no hay dieta" and no print button.
5. As a second nutritionist, open Ana's print address. Expect "No encontrado".
6. Black-and-white check: print preview in grey still shows every meal name.

**Result (2026-10-24, `tools/docs_check.mjs`, throwaway server):** acceptance 1–6 pass, plus "save before printing". Normal diet: 1 page, A4 landscape. Long diet: 2 pages, day names on both, no meal split. On a phone the sheet scrolls sideways with a hint. Owner tested print preview in the browser (2026-10-24): looks fine. Real printer: not available. Real phone print dialog: not checked yet.

**Later:** clinic logo on the sheet; the nutritionist's phone and next appointment; a portrait "one day per page" option; a shopping list from the week.

**Not now:** sending the PDF by email or WhatsApp from the app.

### Decisions (accepted 2026-10-23 with "build export + print")

1. Landscape: 7 days side by side on one sheet.
2. Both the nutritionist and the patient can print.
3. No week dates. Show only "Impreso el …" (the diet repeats every week).
4. A small plate drawing in the top corner as the sheet's signature.

---

## Feature: Patient activity dashboard (approved 2026-10-25 — 3 slices)

**What:** one screen where the nutritionist sees the latest events from all their patients, newest first. Three event types:
1. **Meal photo** (exists today).
2. **Physical activity** (new). Example: "Corrí 30 min en terreno plano", with optional details such as distance and speed.
3. **Progress photo** (new). A body photo to follow the visual progress over time.

It replaces opening each patient one by one to look for new photos. It absorbs the Later items "Exercise log (P1)" and "body photos (P2)".

**Who:**
- The patient logs activity and progress photos from the phone, like meal photos.
- The nutritionist sees the dashboard (all patients) and each patient's own feed. Nobody else sees anything.

**Demo loop (8 minutes, laptop + phone):**
1. Phone (Ana): **Registrar** now asks "¿Qué quieres registrar?": **Comida · Actividad · Foto de progreso**.
2. **Actividad:** pick **Correr**, type 30 min, pick terrain **Plano**. Tap **Más detalles**: distance 5 km. The app shows the speed: 10 km/h (6:00 min/km). Add a note. Send.
3. **Foto de progreso:** pick the pose **Frente**, take the photo, send. A hint says what to wear and to use the same place and light each time.
4. Laptop: after sign-in, the nutritionist lands on **Actividad**: a list of events from all patients, newest first, grouped by day. Each event shows the patient, the type, the time, and its content: photo, activity summary ("Correr · 30 min · 5 km · 10 km/h · plano"), or progress photo.
5. Filters: by type (Todo · Comidas · Actividad · Fotos de progreso), by patient, and **Solo sin ver**.
6. Click **Marcar vista** on one event, or **Marcar todo como visto** for the list on screen. The "sin ver" counter goes down.
7. Click a patient's name: their page opens on a new **Registros** tab with the same feed for that patient only.
8. Phone: **Progreso** now shows progress photos side by side by date, next to the weight chart.

**Physical activity — fields:**
| Field | Required | Values |
|---|---|---|
| Activity | yes | Caminar, Correr, Bicicleta, Nadar, Gimnasio / pesas, Yoga / estiramiento, Baile, Deporte en equipo, Otra (type a name) |
| Duration | yes | minutes, 1–600 |
| Date | yes | today by default; up to 7 days back |
| Intensity | no | Ligera · Moderada · Intensa |
| Terrain | no | Plano · Subidas · Mixto · Caminadora / bici fija (only for walk, run, bike) |
| Distance | no | km (walk, run, bike, swim) |
| Speed | shown, not typed | from distance and duration: km/h; for running and walking also pace (min/km) |
| Note | no | free text, 300 characters |

**Progress photo — fields:** photo (required, 5 MB max, shrunk on the phone like meal photos), pose (Frente · Perfil · Espalda · Otra), date (today), note (optional).

**Rules:**
- Same lock as meal photos: a patient creates and sees only their own events; the nutritionist sees only their own patients' events; files are private (protected) and open only with a file token.
- The nutritionist changes nothing in an event except "seen".
- The patient can delete their own activity on the same day (like meals).
- Progress photos: by default the patient **cannot** delete them. The nutritionist has a setting **Permitir que mis pacientes borren sus fotos de progreso** (off by default); when on, the patient can delete them at any time. The nutritionist can always delete a progress photo, e.g. when the patient asks or uploads the wrong one.
- Closed accounts: no new events; existing events stay readable (same as the close-account rules).
- The dashboard shows the latest 50 events and a **Cargar más** button. It refreshes when the nutritionist comes back to the tab, and with an **Actualizar** button. (Not live; see open question 1.)
- Export (patient data): adds activity and progress photos. Progress photos have their own checkbox **Incluir fotos de progreso**, off by default (open question 3).
- The weekly diet print does not change.

**Screens and files:**
- Patient: `log.html` gets the type picker and the two new forms (or `activity.html` and `progress-photo.html`, decided at build). `progress.html` gets the photo strip. `today.html` shows today's activity under the meals.
- Nutritionist: new `activity.html` (the dashboard, the new home after sign-in), a **Registros** tab on `patient.html` (replaces **Comidas**), the patient list keeps its "sin ver" badge and counts all types.
- Data: new collections `activity_logs` and `progress_photos`, same shape and rules as `meal_logs`. One shared feed module merges the three by time.

**Acceptance:**
1. Ana logs "Correr, 30 min, plano, 5 km". The dashboard shows "Correr · 30 min · 5 km · 10 km/h · 6:00 min/km · plano" under her name.
2. Ana logs a progress photo (Frente). The dashboard shows it; her **Progreso** screen shows it with its date.
3. Filters: "Actividad" shows only activity; "Ana" shows only Ana; "Solo sin ver" hides seen events.
4. "Marcar todo como visto" sets seen on every event on screen; the counters go to 0; Ana's phone shows "Vista por tu nutrióloga/o" on each.
5. A second nutritionist's dashboard is empty. Opening Ana's progress photo address with their file token: not found.
6. Carlos cannot see Ana's events. Ana cannot mark her own events seen.
7. Setting off (default): Ana cannot delete her progress photo (no button; the server refuses). The nutritionist deletes it: it disappears from the dashboard and its file address returns not found. Setting on: Ana deletes one a week later, same result.
8. Close Ana's account: she can log nothing new; the dashboard still shows her old events.
9. 60 events: the first page shows 50, **Cargar más** shows the rest, newest first, no duplicates.

**Risks:**
- Progress photos are the most sensitive data in Plato (bodies, sometimes in underwear). Legal L1 applies before real patients; the join screen should mention them in the privacy notice. Until then: fake photos only.
- Storage: photos are the main cost driver online (about 0.3–0.6 MB each after shrinking). 100 patients × 3 photos a day ≈ 1–2 GB a month. Fine on a 3 GB disk for a pilot; a cloud bucket later.

**Later:** live updates on the dashboard; comments on any event; weekly activity totals and goals ("150 min de actividad a la semana"); calories burned from activity; side-by-side before/after comparison with the same pose; reminders to log.

**Not now:** step counters, smartwatch or Google Fit / Apple Health import; GPS routes; automatic body measurements from photos.

### Decisions (owner, 2026-10-25)

1. **Not live.** The feeds refresh when the nutritionist comes back to the tab, plus an **Actualizar** button.
2. **The dashboard is the nutritionist's home** after sign-in, shaped by the owner's vision below.
3. **Export:** progress photos only when **Incluir fotos de progreso** is ticked (off by default).
4. **Deleting progress photos:** a nutritionist setting, off by default (patients cannot delete). The client decides per clinic.
5. **Three slices**, each built, tested and committed on its own: (1) activity log, (2) progress photos, (3) home with feeds.

### Home screen (owner's vision — slice 3)

- **Big banner** at the top with a picture submitted by the user.
- **A grid of buttons**, each opening a "feed": **Catálogo**, **Agenda**, **Actividades**, **Fotos**, **Recientes**, and **"Pending dashboard"** (untitled for now).
- **Below the grid:** card items, loaded by the feed selected.
- **Banner picture:** the nutritionist's own (owner, 2026-10-25).
- **Agenda:** shown but disabled until appointments exist. It must look disabled without relying on text: greyed out, a lock icon, not clickable, `aria-disabled="true"` (owner, 2026-10-25).
- **Catálogo:** to be defined with the client.
- Suggested refinements and open details are in the next section; settle them before slice 3.

### Upgrades over Nutrimind's home (owner approved all 8, 2026-10-25)

Reference: Nutrimind's home (banner image + 6 menu buttons + a "Tip Nutrimind" card). Plato does not copy it 1:1:
1. **Banner = photo only.** Name, clinic and contact are live text from the nutritionist's profile on top of the photo (readable on phones and by screen readers; no redesign when a phone number changes; logo shown once).
2. **Short banner**: about a quarter of the laptop screen.
3. **Buttons show live counts** ("Actividades · 3 nuevas", "Fotos · 2 sin ver").
4. **Buttons are tabs** that switch the cards below (selected one highlighted); **Recientes** is open by default.
5. **No marketing card.** That space holds a **"Hoy" summary**: unseen logs, today's appointments (once Agenda exists), patients who went quiet.
6. **One accent colour** (Plato green). Colour only means state: a badge for new, grey + lock for disabled.
7. **Labels say what is behind them** (e.g. "Lo último de tus pacientes" instead of "Recientes"/"Dashboard"); final wording at build.
8. **Accessible controls**: solid bordered buttons, visible keyboard focus, the selected tab announced to screen readers.

Ideas offered, not decided: Nutrimind's "Mis catálogos" is probably the nutritionist's libraries (foods, recipes, diet templates), not the patient list (ask the client). "Pending dashboard" could become **Pendientes**: unseen logs, patients without the app or with an expired link, no diet, no log in 3+ days.

A throwaway clickable mockup (fake data, outside the app) is shown to the client before slice 3.

**Layout decisions from the mockup review (owner, 2026-10-25):**
- The tab grid (left) and the right column line up as one block: same top edge, same bottom edge. The tabs stretch to fill the height.
- The right column is the **Hoy** panel with a separate **Marcar todo como visto** button under it (a small gap between them), exactly as wide as Hoy. The bottom of the button lines up with the bottom of the tab grid.
- The button is always in that spot (the layout does not jump between tabs). It marks as seen only what the selected tab shows, shows how many ("(6)"), and is greyed out when there is nothing to mark (e.g. Pendientes, Catálogo).
- On a phone: tabs (2 columns), then Hoy, then the button.
- Mockup file (not in the repo): `../Plato-mockups/home-dashboard.html (next to the repo)`.

### Open questions (slice 3 only; slices 1 and 2 do not depend on them)

1. ~~Banner picture~~ → the nutritionist's own.
2. **Catálogo:** owner will ask the client what it should show. **Fotos** = progress photos only, or meal photos too? (still open)
3. ~~Agenda~~ → disabled look (grey + lock), not hidden.
4. Suggested: keep the banner short on a laptop (about 1/4 of the screen) with a greeting and the "sin ver" counters, and make the grid a compact row of buttons, so the cards stay visible without scrolling. On the phone the grid becomes 2 or 3 columns.

### Slice 1 — activity log (built 2026-10-25)

- Patient: **Registrar** has a **Comida | Actividad** switch; the activity form is its own page (`activity.html`). Details (intensity, terrain, distance) sit under **Más detalles**; terrain and distance appear only for activities where they apply. Speed and pace are shown while typing.
- Patient **Hoy**: "Actividad de hoy" list with seen status and same-day delete.
- Nutritionist: the patient page's **Comidas** tab is now **Registros** (meals and activity in one feed, newest first; "Marcar vista" on each). The patient list adds an "N actividades nuevas" badge. Export (PDF and JSON) adds an "Actividad física" section.
- Server: the date window, the "Otra" name and dropping details that don't apply are checked by a hook (`pb_hooks/activity.pb.js`), not only on screen.
- **Result (throwaway server):** API 96/96 (23 new activity checks: acceptance 1, 3-6, 8 for activity), screens `tools/activity_check.mjs` 17/17, and all earlier suites still pass (demo 22/22, print + export 25/25, close account 12/12, security probe 0 findings).

### Slice 2 — progress photos (built 2026-10-25)

- Patient: **Registrar** switch is now **Comida | Actividad | Progreso**. The progress form (`progress-photo.html`) has the pose (Frente, Perfil, Espalda, Otra; Frente picked), the tip about clothes, place and light, and "Solo tú y tu nutrióloga o nutriólogo pueden ver esta foto". Always dated today (server checks).
- Patient **Progreso**: "Fotos de progreso" grid by date with **Agregar foto**. Delete button only when the nutritionist allows it; otherwise "¿Quieres borrar una foto? Pídeselo a tu nutrióloga o nutriólogo."
- Nutritionist: progress photos in **Registros** ("Foto de progreso · Frente", portrait crop) with Marcar vista and a delete button (always allowed). Patient list badge "N fotos de progreso". New **Ajustes** page (link in the header) with the switch **Permitir que mis pacientes borren sus fotos de progreso** (off by default; saved on change).
- Export: **Incluir fotos de progreso** (off by default). When off, the photos are not even downloaded.
- Decision taken during build: the nutritionist can also delete a progress photo of a **closed** account (a deletion request can come after closing). Everything else on a closed account stays read-only.
- **Result (throwaway server):** API 120/120 (24 new: acceptance 2, 4-8 for progress photos), screens `tools/progress_check.mjs` 15/15, and all earlier suites still pass (see the commit plan run).

### Reminders for the owner

- **"Pending dashboard"**: an untitled feature with a placeholder button on the home grid. **Remind the owner to define it** before slice 3 is built, and again at each slice review until it is defined.

---

## Feature: Food catalogue and import (FUTURE — parked until the data source is chosen)

**Status (owner, 2026-10-25):** long-term feature. Direction agreed (decisions below); not scheduled. Blocked on the choice of official data source.

**What:** the nutritionist's **catalogue** (the "Catálogo" tab): dishes and meals built from an **ingredient database from official sources** (the owner supplies the data later). Dishes, meals or a whole diet can be **imported** from a simple file that an AI agent can write: "add the following meal to my catalogue". **Plato computes the nutrition**, never the agent.

**Why:** typing diets is the slowest job (Nutrimind's "dietas automáticas" and "recetas" are its strongest pull). Numbers must be trustworthy and traceable to a source.

**Who:**
- Admin (owner): loads and updates the ingredient database. Read-only for everyone else.
- Nutritionist: imports and edits dishes and meals in **their own** catalogue; uses them in diets. Can **share a dish to the global catalogue** so new nutritionists can copy from what earlier users built (decision 2).
- Patient: sees the dishes in their diet (name, servings). Calories and macros only when the nutritionist turns them on for that patient (decision 4).

### Three levels

| Level | Example | Holds |
|---|---|---|
| **Platillo** (dish) | Taco de lomo en salsa verde, **1 taco** | ingredients with quantity **per serving**, a **serving unit** |
| **Comida** (meal) | Tacos × 3 + frijoles × 1 taza | dishes × servings |
| **Dieta** (diet) | the week | meals per day and slot (today's free text keeps working) |

**Multi-serving dishes:** a dish has a serving unit (`taco`, `pieza`, `taza`, `porción`) and the label **"Se sirve por piezas"** when it is naturally multiplied. The catalogue keeps **1 taco**; a meal or diet says **"× 3"** and Plato multiplies. "5 tacos" is never saved as its own dish.

### Import format (`plato-import`, version 1)

JSON, one file per import, any of the three levels. Ingredients are referenced by the database's **id** (preferred) or exact **name**; quantities in `g`, `ml` or `pieza` (only when the ingredient has a standard piece weight in the database).

```json
{
  "format": "plato-import",
  "version": 1,
  "dishes": [
    {
      "name": "Taco de lomo de cerdo en salsa verde",
      "serving_unit": "taco",
      "multi_serving": true,
      "ingredients": [
        { "ingredient": "Tortilla de maíz", "amount": 1, "unit": "pieza" },
        { "ingredient": "Lomo de cerdo, cocido", "amount": 50, "unit": "g" },
        { "ingredient": "Tomate verde (tomatillo), crudo", "amount": 1, "unit": "pieza" },
        { "ingredient": "Cilantro, crudo", "amount": 10, "unit": "g" },
        { "ingredient": "Jugo de limón", "amount": 10, "unit": "ml" }
      ],
      "notes": "Salsa: tomatillo y cilantro molidos con el limón."
    }
  ],
  "meals": [
    { "name": "Comida: tacos de lomo", "items": [ { "dish": "Taco de lomo de cerdo en salsa verde", "servings": 3 } ] }
  ],
  "diet": null
}
```

- `diet` (optional): `{ "title": "...", "days": { "1": { "lunch": [ { "meal": "Comida: tacos de lomo" } ] }, ... } }` (1 = Monday, slots as today), applied to one patient chosen on screen.
- The file never carries nutrition numbers. If it does, they are ignored.
- The agent finds ingredient names/ids in a downloadable **ingredient list** (`Descargar lista de ingredientes`, JSON/CSV) or, later, a lookup API.

### Import screen (nutritionist)

1. **Catálogo → Importar**: paste the text or choose a `.json` file.
2. **Check first, save after.** Plato shows a preview: each dish with its ingredients matched to the database, **nutrition per serving** (and per meal), and problems in plain words:
   - "No encontré 'tomatillo' en la base. ¿Quisiste decir 'Tomate verde, crudo'?" (suggestions only; nothing is guessed silently)
   - "'Cilantro' no tiene peso por pieza: usa gramos."
   - "Ya tienes un platillo con ese nombre: reemplazar, guardar como copia o saltar."
3. Nothing is saved while there is an unresolved problem. **Guardar en mi catálogo** saves everything in one go (all or nothing).
4. Each dish keeps **which database version** its numbers came from; if the database is updated, the dish shows "Valores actualizados" and recalculates (open question Q6).

### Nutrition shown

Per serving, per meal, per day: energy (kcal), protein, fat, carbohydrates, fiber, and whatever else the official data includes (sodium, sugars, etc.). Columns follow the source the owner provides. Rounded for display; exact values kept.

### Acceptance

1. Import the taco file above: preview shows 5 matched ingredients and kcal/protein/fat/carbs **per taco**, computed from the database (checked by hand against the source for this one taco).
2. A meal "Tacos × 3" shows exactly 3 × the taco values.
3. A file with an unknown ingredient cannot be saved; the message names it and suggests close matches.
4. `pieza` for an ingredient without a piece weight is refused with the reason.
5. A file with nutrition numbers in it: the numbers are ignored; Plato's own values are shown.
6. Another nutritionist cannot see or use my dishes. A patient cannot open the catalogue.
7. Import a diet for Ana: her week shows the dishes with servings ("Tacos de lomo × 3"); her free-text meals elsewhere are untouched.
8. Bad JSON or wrong `format`/`version`: a plain message, nothing saved.

### Risks

- **Data licence.** USDA FoodData Central is public domain. Mexican tables (SMAE book, INCMNSZ/BAM tables) may be copyrighted: check the licence of whatever source is supplied before loading it (Legal L8/L9 territory).
- **Wrong numbers hurt people.** Plato only computes from the database; the preview shows the source per ingredient; the owner checks a sample by hand on first load.
- **Raw vs cooked, piece weights, ml → g.** The database must say the state ("cocido", "crudo") and carry piece weights and densities where needed; otherwise grams are required.
- **Calories for patients** can harm people with eating disorders: off by default, per patient (decision 4).

**Later:** an API key so an agent adds dishes directly (no paste); food-exchange equivalents (sistema mexicano de equivalentes) computed from the same data; recipe photos and preparation steps; shopping list from a diet; targets per patient (kcal/macros) with the diet's totals compared.

**Not now:** Plato generating diets by itself (AI); barcode scanning; restaurant/brand databases.

### Decisions (owner, 2026-10-25)

1. **Data source: open.** The owner is still choosing the official source(s). Suggested format when ready: a CSV with id, name, state (raw/cooked), values per 100 g, piece weight, density, source and version; Plato gets a loader and a checker.
2. **Ingredients belong to the platform** (one shared, read-only database loaded by the admin). **Dishes and meals belong to each nutritionist.** Added by the owner: a nutritionist can **make a dish global** so other (new) nutritionists can copy it into their own catalogue. Copies are independent; numbers still come from the shared ingredient database. (To spec later: who can un-share, credit to the author, moderation.)
3. **Diet structure: hybrid.** Each meal slot holds catalogue dishes with servings and/or free text; today's diets keep working.
4. **Patients see calories and macros only if turned on**, with a per-patient switch for the nutritionist (off by default). **The patient's screens must look complete and cohesive in both cases**: designed for "with numbers" and "without numbers" as two first-class layouts, not a layout with holes when the numbers are hidden.
5. **Hand-over: paste or upload** the file in the first version; an agent API key later.
6. **Recalculate** saved dishes when the database changes, with a visible "Valores actualizados el …" note.
7. **Three slices:** (a) ingredient database + loader + list download, (b) dishes and meals in the catalogue with import + preview, (c) diets using catalogue items with servings and daily totals.

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

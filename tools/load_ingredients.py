"""Load an ingredient dataset into AHT Fitness (owner/agent tool, never part of the app).

  python tools/load_ingredients.py --base URL --csv data/ingredients-ejemplo.csv [--dataset ejemplo] [--apply]
  python tools/load_ingredients.py --base URL --remove-dataset ejemplo [--apply]

Needs an admin session token in the environment variable PB_SUPERUSER_TOKEN (never on the command line).
Default is a DRY RUN: it checks the file and prints a summary; nothing is saved without --apply.
--apply replaces every row of the dataset in one go (same name+state = updated, so tags a nutritionist put on it stay;
rows no longer in the file are deleted, and so are their links). Platform (starter) tags come from the 'tags' column.
Column names of a different source: edit data/ingredients-columns.json (OUR name -> THEIR header).
"""
import argparse, csv, io, json, os, sys, unicodedata, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--csv")
ap.add_argument("--columns", default=str(Path(__file__).resolve().parent.parent / "data" / "ingredients-columns.json"))
ap.add_argument("--dataset", default="ejemplo")
ap.add_argument("--source", default=None)
ap.add_argument("--version", default=None)
ap.add_argument("--apply", action="store_true")
ap.add_argument("--remove-dataset", metavar="DATASET")
args = ap.parse_args()
TOKEN = os.environ.get("PB_SUPERUSER_TOKEN", "")
if not TOKEN:
    sys.exit("Set PB_SUPERUSER_TOKEN (an admin session token) first.")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={"Authorization": TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path.split('?')[0]} -> {e.code} {e.read().decode()[:300]}")


def all_rows(coll, flt):
    out, page = [], 1
    while True:
        r = call("GET", f"/api/collections/{coll}/records?perPage=200&page={page}&filter={urllib.parse.quote(flt)}")
        out += r["items"]
        if page >= r["totalPages"]:
            return out
        page += 1


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).lower().strip()


if args.remove_dataset:
    ds = args.remove_dataset
    ings = all_rows("ingredients", f'dataset = "{ds}"')
    tags = all_rows("tags", f'dataset = "{ds}" && nutritionist = ""')
    print(f"Dataset '{ds}': {len(ings)} ingredients, {len(tags)} platform tags. " + ("Deleting..." if args.apply else "DRY RUN (add --apply to delete)."))
    if args.apply:
        for r in ings:
            call("DELETE", f"/api/collections/ingredients/records/{r['id']}")
        for r in tags:
            call("DELETE", f"/api/collections/tags/records/{r['id']}")
        print("Done. Nutritionists' own tags are untouched.")
    sys.exit(0)

if not args.csv:
    sys.exit("Give --csv or --remove-dataset.")
cols = {k: v for k, v in json.loads(Path(args.columns).read_text(encoding="utf-8")).items() if not k.startswith("_")}
text = Path(args.csv).read_text(encoding="utf-8-sig")
reader = csv.DictReader(io.StringIO(text))
headers = reader.fieldnames or []
errors, warnings, rows, seen = [], [], [], {}
for k in ["name", "state", "kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"]:
    if cols.get(k) not in headers:
        errors.append(f"Missing column for '{k}' (looked for '{cols.get(k)}').")
if errors:
    sys.exit("\n".join(errors))
extra_cols = [h for h in headers if h.startswith("extra:")]


def num(row, key, line, required=True, hi=None):
    raw = ((row.get(cols[key]) if key in cols else "") or "").strip()
    if not raw:
        if required:
            errors.append(f"Line {line}: '{key}' is empty.")
        return None
    try:
        v = float(raw)
    except ValueError:
        errors.append(f"Line {line}: '{key}' is not a number: {raw!r}.")
        return None
    if v < 0 or (hi is not None and v > hi):
        errors.append(f"Line {line}: '{key}' out of range: {raw}.")
    return v


for i, row in enumerate(reader, start=2):
    name = (row[cols["name"]] or "").strip()
    state = (row[cols["state"]] or "").strip()
    if not name:
        errors.append(f"Line {i}: name is empty.")
        continue
    if state not in ("crudo", "cocido", "otro"):
        errors.append(f"Line {i}: state must be crudo, cocido or otro (got {state!r}).")
    key = (name.lower(), state)
    if key in seen:
        errors.append(f"Line {i}: '{name}' ({state}) is repeated (first on line {seen[key]}).")
    seen[key] = i
    kcal, p, f, c, fi = (num(row, k, i, hi=h) for k, h in (("kcal", 1000), ("protein_g", 100), ("fat_g", 100), ("carbs_g", 100), ("fiber_g", 100)))
    piece = num(row, "piece_g", i, required=False, hi=5000)
    dens = num(row, "density_g_ml", i, required=False, hi=5)
    if None not in (kcal, p, f, c) and kcal is not None:
        exp = 4 * (p or 0) + 4 * (c or 0) + 9 * (f or 0)
        if abs(kcal - exp) > max(15, 0.3 * exp):
            warnings.append(f"Line {i}: {name}: kcal {kcal:g} but the macros say about {exp:.0f}.")
    extra = {}
    for h in extra_cols:
        v = (row.get(h) or "").strip()
        if v:
            try:
                extra[h[6:]] = float(v)
            except ValueError:
                errors.append(f"Line {i}: {h} is not a number: {v!r}.")
    groups = []
    for part in [x for x in ((row.get(cols.get("groups", "groups")) or "").split(";")) if x.strip()]:
        g, _, pg = part.partition(":")
        try:
            if not g.strip() or float(pg) <= 0:
                raise ValueError
            groups.append({"group": g.strip(), "portion_g": float(pg)})
        except ValueError:
            errors.append(f"Line {i}: groups must look like 'Cereales:30;Carnes:60' (got {part!r}).")
    tags, tn = [], set()
    for t in [x.strip() for x in ((row.get(cols.get("tags", "tags")) or "").split(";")) if x.strip()]:
        if len(t) > 30:
            errors.append(f"Line {i}: tag longer than 30 characters: {t!r}.")
        elif norm(t) not in tn:
            tn.add(norm(t))
            tags.append(t)
    rows.append(dict(name=name, state=state, kcal=kcal, protein_g=p, fat_g=f, carbs_g=c, fiber_g=fi, extra=extra or None,
                     piece_g=piece or 0, density_g_ml=dens or 0, groups=groups or None, dataset=args.dataset,
                     source=args.source or ("EJEMPLO (inventado)" if args.dataset == "ejemplo" else args.dataset),
                     version=args.version or ("0" if args.dataset == "ejemplo" else ""), _tags=tags))

tag_names = {}
for r in rows:
    for t in r["_tags"]:
        tag_names.setdefault(norm(t), t)
print(f"{len(rows)} ingredients, {len(tag_names)} platform tags, {sum(1 for r in rows if r['groups'])} with exchange groups. Dataset '{args.dataset}'.")
for w in warnings:
    print("WARNING", w)
if errors:
    print("REFUSED: nothing was loaded.")
    for e in errors:
        print(" ", e)
    sys.exit(1)
if not args.apply:
    print("DRY RUN: nothing saved (add --apply).")
    sys.exit(0)

ds = args.dataset
old = {(r["name"].lower(), r["state"]): r for r in all_rows("ingredients", f'dataset = "{ds}"')}
ids, keep = {}, set()
body_keys = ("name", "state", "kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "extra", "piece_g", "density_g_ml", "groups", "dataset", "source", "version")
for r in rows:
    k = (r["name"].lower(), r["state"])
    keep.add(k)
    body = {x: r[x] for x in body_keys}
    if k in old:
        ids[k] = call("PATCH", f"/api/collections/ingredients/records/{old[k]['id']}", body)["id"]
    else:
        ids[k] = call("POST", "/api/collections/ingredients/records", body)["id"]
gone = [v for k, v in old.items() if k not in keep]
for v in gone:
    call("DELETE", f"/api/collections/ingredients/records/{v['id']}")
oldtags = {norm(t["name"]): t for t in all_rows("tags", f'dataset = "{ds}" && nutritionist = ""')}
tagid = {}
for n, name in tag_names.items():
    tagid[n] = oldtags[n]["id"] if n in oldtags else call("POST", "/api/collections/tags/records", {"name": name, "dataset": ds, "nutritionist": ""})["id"]
for n, t in oldtags.items():
    if n not in tag_names:
        call("DELETE", f"/api/collections/tags/records/{t['id']}")
have_rows = all_rows("item_tags", f'nutritionist = "" && kind = "ingredient" && tag.dataset = "{ds}"')
have = {(l["tag"], l["item"]) for l in have_rows}
want = {(tagid[norm(t)], ids[(r["name"].lower(), r["state"])]) for r in rows for t in r["_tags"]}
for tg, it in sorted(want - have):
    call("POST", "/api/collections/item_tags/records", {"tag": tg, "item": it, "kind": "ingredient", "nutritionist": ""})
for l in have_rows:
    if (l["tag"], l["item"]) not in want:
        call("DELETE", f"/api/collections/item_tags/records/{l['id']}")
updated = len([k for k in keep if k in old])
print(f"LOADED: {len(rows)} ingredients ({len(rows) - updated} new, {updated} updated, {len(gone)} removed), {len(tag_names)} tags, {len(want)} tag links.")

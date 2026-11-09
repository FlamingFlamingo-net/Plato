"""Turn USDA FoodData Central foods into an ingredients CSV for tools/load_ingredients.py (owner/agent tool, never part of the app).

Two steps, both read the API key from the environment variable FDC_API_KEY (never a file, never printed):

  python tools/fdc_fetch.py resolve --wishlist data/usda-wishlist.txt --out data/usda-picks.csv
      For each wishlist line ("search words | Display name | must;contain;words | state | fiber0") finds the best SR Legacy / Foundation
      food and writes fdc_id + the USDA description, so a person can check every pick before anything is downloaded.
  python tools/fdc_fetch.py fetch --picks data/usda-picks.csv --out data/ingredients-usda.csv
      Downloads the picked foods (batches of 10, cached in .fdc-cache/) and writes the CSV: values per 100 g, extra
      nutrients, household portions, the USDA id, and starter tags computed from the numbers.

  python tools/fdc_fetch.py check     # offline self-test on tools/fixtures/fdc-sample.json (no key needed)

Source: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (public domain, CC0).
"""
import argparse, csv, io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://api.nal.usda.gov/fdc/v1"
SOURCE = "USDA FoodData Central"
DATASETS = {"SR Legacy": ("usda-sr-legacy", "SR Legacy 2018"), "Foundation": ("usda-foundation", "Foundation")}

# nutrient numbers (a food may carry an alternative one: first that has an amount wins)
KCAL = ("208", "957", "958")
MACROS = {"protein_g": ("203",), "fat_g": ("204",), "carbs_g": ("205", "205.2"), "fiber_g": ("291", "293")}   # Foundation foods report fibre as 293 (AOAC method)
EXTRAS = {  # our key -> USDA numbers (per 100 g)
    "sodium_mg": ("307",), "sugars_g": ("269", "269.3", "269.2"), "saturated_fat_g": ("606",), "cholesterol_mg": ("601",),
    "calcium_mg": ("301",), "iron_mg": ("303",), "potassium_mg": ("306",), "magnesium_mg": ("304",), "zinc_mg": ("309",),
    "vitamin_c_mg": ("401",), "vitamin_a_ug": ("320",), "vitamin_d_ug": ("328",), "folate_ug": ("417",), "vitamin_b12_ug": ("418",),
}
COOKED = re.compile(r"\b(cooked|boiled|baked|roasted|fried|grilled|broiled|steamed|stewed|braised|microwaved|simmered|poached|toasted)\b", re.I)
RAW = re.compile(r"\b(raw|uncooked)\b", re.I)
TAG_RULES = (("alta en fibra", lambda r: r["fiber_g"] >= 6), ("alta en proteína", lambda r: r["protein_g"] >= 20), ("bajo en sodio", lambda r: (r["_sodium"] is not None and r["_sodium"] <= 140)))


def state_of(description):
    if RAW.search(description):
        return "crudo"
    return "cocido" if COOKED.search(description) else "otro"


def amounts(food):
    out = {}
    for n in food.get("foodNutrients", []):
        num = str((n.get("nutrient") or {}).get("number") or n.get("number") or "")
        if num and n.get("amount") is not None:
            out.setdefault(num, float(n["amount"]))
    return out


def first(am, numbers):
    for num in numbers:
        if num in am:
            return am[num]
    return None


def portions_of(food, limit=6):
    out = []
    for p in sorted(food.get("foodPortions", []), key=lambda p: p.get("sequenceNumber") or 99):
        label = (p.get("modifier") or "").strip()
        if not label:
            unit = ((p.get("measureUnit") or {}).get("name") or "").strip()
            label = "" if unit.lower() in ("undetermined", "racc", "") else unit
        grams, amount = p.get("gramWeight"), p.get("amount") or 1
        if not label or not grams or grams <= 0:
            continue
        label = label.replace(";", ",").replace(":", " ")
        item = (label, round(float(grams) / float(amount), 1))
        if item not in out and all(item[0] != o[0] for o in out):
            out.append(item)
    return out[:limit]


def to_row(food, display=None, fiber0=False):
    """One USDA food (raw API shape) -> (row dict for the CSV, list of problems). A row is None when a required value is missing."""
    am, problems = amounts(food), []
    kcal = first(am, KCAL)
    row = {"name": display or food["description"], "state": state_of(food["description"]), "kcal": kcal}
    for k, nums in MACROS.items():
        row[k] = first(am, nums)
    assumed = False
    if fiber0 and row.get("fiber_g") is None:   # USDA has no fibre value; the owner chose to list the food with 0 (marked in extras)
        row["fiber_g"], assumed = 0.0, True
    missing = [k for k in ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g") if row.get(k) is None]
    if missing:
        return None, [f"{food['fdcId']} {food['description'][:50]}: missing {', '.join(missing)}"]
    for k in ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"):
        row[k] = round(row[k], 2)
    row["extra"] = {k: round(v, 3) for k, nums in EXTRAS.items() if (v := first(am, nums)) is not None}
    if assumed:
        row["extra"]["fiber_assumed_zero"] = 1
    row["_sodium"] = row["extra"].get("sodium_mg")
    row["portions"] = portions_of(food)
    row["fdc_id"] = food["fdcId"]
    row["tags"] = [t for t, rule in TAG_RULES if rule(row)]
    ds, ver = DATASETS.get(food.get("dataType"), (None, None))
    row["dataset"], row["version"] = ds, ver
    return row, problems


CORE = ["name", "state", "kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "fdc_id", "portions", "tags"]


def write_csv(rows, out):
    extra_keys = sorted({k for r in rows for k in r["extra"]})
    w = csv.writer(out, lineterminator="\n")
    w.writerow(CORE + [f"extra:{k}" for k in extra_keys])
    for r in rows:
        w.writerow([r["name"], r["state"], r["kcal"], r["protein_g"], r["fat_g"], r["carbs_g"], r["fiber_g"], r["fdc_id"],
                    ";".join(f"{l}:{g:g}" for l, g in r["portions"]), ";".join(r["tags"])] + [r["extra"].get(k, "") for k in extra_keys])


# ---------------- network ----------------
def api(path, body=None, soft=False, **params):
    key = os.environ.get("FDC_API_KEY", "")
    if not key:
        sys.exit("Set the environment variable FDC_API_KEY first (it is never written to a file).")
    url = f"{BASE}{path}?{urllib.parse.urlencode({**params, 'api_key': key}, doseq=True)}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"} if body is not None else {})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                sys.exit("USDA says: too many requests (limit per hour). Wait an hour and run again; the cache keeps what was fetched.")
            if e.code >= 500 and attempt < 2:
                time.sleep(3); continue
            if soft and e.code == 400:
                return None   # one odd query must not stop a long run; the caller lists it
            sys.exit(f"USDA answered HTTP {e.code} for {path}.")
        except urllib.error.URLError as e:
            if attempt < 2:
                time.sleep(3); continue
            sys.exit(f"Could not reach USDA ({type(e.reason).__name__}).")


def resolve(wishlist, out):
    lines = [l.strip() for l in Path(wishlist).read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith("#")]
    rows, missing = [], []
    for line in lines:
        parts = [p.strip() for p in line.split("|")]
        query, display = parts[0], (parts[1] if len(parts) > 1 and parts[1] else "")
        must = [m.strip().lower() for m in (parts[2].split(";") if len(parts) > 2 else []) if m.strip()]
        state = parts[3].strip() if len(parts) > 3 else ""
        fiber0 = len(parts) > 4 and parts[4].strip().lower() == "fiber0"
        if state not in ("", "crudo", "cocido", "otro"):
            sys.exit(f"Wishlist line has a bad state {state!r} (use crudo, cocido or otro): {line}")
        want_foundation = query.startswith("@F ")
        query = query.removeprefix("@F ").strip()
        query = re.sub(r'[()%"/]', " ", query)   # USDA refuses searches with these characters
        query = re.sub(r"\s+", " ", query).strip()
        types = ["Foundation"] if want_foundation else ["SR Legacy"]
        d = api("/foods/search", soft=True, query=query, dataType=types, pageSize=8)
        if d is None:
            missing.append(f"{line}   <- USDA refused this query (HTTP 400): simplify the search words"); continue
        pick = next((f for f in d.get("foods", []) if all(m in f["description"].lower() for m in must)), None)
        if not pick:
            missing.append(line); continue
        rows.append((pick["fdcId"], pick["dataType"], pick["description"], display, query, state, "fiber0" if fiber0 else ""))
        time.sleep(0.15)
    with open(out, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n"); w.writerow(["fdc_id", "data_type", "usda_description", "display_name", "query", "state", "fiber0"]); w.writerows(rows)
    print(f"{len(rows)} picked, {len(missing)} not found.")
    for m in missing:
        print("  NOT FOUND:", m)


def fetch(picks, out, cache_dir):
    cache = Path(cache_dir); cache.mkdir(exist_ok=True)
    with open(picks, encoding="utf-8", newline="") as fh:
        picked = list(csv.DictReader(fh))
    need = [int(p["fdc_id"]) for p in picked if not (cache / f"{p['fdc_id']}.json").exists()]
    for i in range(0, len(need), 10):
        batch = need[i:i + 10]
        for food in api("/foods", {"fdcIds": batch, "format": "full"}):
            keep = {k: food.get(k) for k in ("fdcId", "dataType", "description", "foodPortions")}
            keep["foodNutrients"] = [{"nutrient": {"number": (n.get("nutrient") or {}).get("number")}, "amount": n.get("amount")} for n in food.get("foodNutrients", []) if n.get("amount") is not None]
            keep["foodPortions"] = [{k: p.get(k) for k in ("gramWeight", "amount", "modifier", "sequenceNumber", "measureUnit")} for p in food.get("foodPortions", [])]
            (cache / f"{food['fdcId']}.json").write_text(json.dumps(keep), encoding="utf-8")
        print(f"  fetched {min(i + 10, len(need))}/{len(need)}", flush=True)
        time.sleep(0.4)
    rows, problems, names = [], [], {}
    for p in picked:
        food = json.loads((cache / f"{p['fdc_id']}.json").read_text(encoding="utf-8"))
        row, probs = to_row(food, p.get("display_name") or None, fiber0=p.get("fiber0") == "fiber0")
        if row and p.get("state"):
            row["state"] = p["state"]
        problems += probs
        if not row:
            continue
        key = (row["name"].lower(), row["state"])
        if key in names:
            problems.append(f"{p['fdc_id']}: same name and state as {names[key]} ('{row['name']}'): give one a display name")
            continue
        names[key] = p["fdc_id"]; rows.append(row)
    with open(out, "w", encoding="utf-8", newline="") as fh:
        write_csv(rows, fh)
    print(f"{len(rows)} foods written to {out}. {len(problems)} problems.")
    for pr in problems:
        print("  PROBLEM:", pr)
    by = {}
    for r in rows:
        by[r["dataset"]] = by.get(r["dataset"], 0) + 1
    print("by dataset:", by, "(load each with --dataset and the matching --source/--version)")


def selfcheck():
    foods = json.loads((ROOT / "tools" / "fixtures" / "fdc-sample.json").read_text(encoding="utf-8"))
    by = {f["fdcId"]: f for f in foods}
    bad = []
    def eq(name, got, want):
        if got != want:
            bad.append(f"{name}: got {got!r}, want {want!r}")
    for desc, want in [("Beans, black, mature seeds, cooked, boiled, without salt", "cocido"), ("Bananas, raw", "crudo"), ("Rice, white, long-grain, regular, raw, enriched", "crudo"),
                       ("Beans, black, canned, sodium added", "otro"), ("Chicken, broilers or fryers, breast, meat only, roasted", "cocido"), ("Beans, dry", "otro")]:
        eq(f"state of {desc[:30]}", state_of(desc), want)
    beans, _ = to_row(by[173735])
    eq("beans kcal/protein/fat/carbs/fiber", (beans["kcal"], beans["protein_g"], beans["fat_g"], beans["carbs_g"], beans["fiber_g"]), (132.0, 8.86, 0.54, 23.71, 8.7))
    eq("beans extra sodium", beans["extra"]["sodium_mg"], 1.0)
    eq("beans state, id, dataset", (beans["state"], beans["fdc_id"], beans["dataset"]), ("cocido", 173735, "usda-sr-legacy"))
    eq("beans portions", beans["portions"], [("cup", 172.0)])
    eq("beans tags (fibre 8.7 -> alta en fibra; sodium 1 mg -> bajo en sodio)", beans["tags"], ["alta en fibra", "bajo en sodio"])
    ban, _ = to_row(by[173944], "Banana, raw")
    eq("banana display name", ban["name"], "Banana, raw")
    eq("banana portions: a label with a comma is kept, at most 6 listed, nearest-first order", (("cup, sliced", 150.0) in ban["portions"], len(ban["portions"]) <= 6), (True, True))
    eq("banana has no ':' or ';' in labels", all(":" not in l and ";" not in l for l, _ in ban["portions"]), True)
    egg, _ = to_row(by[748967])
    eq("egg (Foundation): dataset", egg["dataset"], "usda-foundation")
    eq("egg portion without a label falls back to the unit name or is skipped", [l for l, _ in egg["portions"]], ["whole without shell"])
    eq("egg tags (protein 12.4 g is below 20)", "alta en proteína" in egg["tags"], False)
    can, _ = to_row(by[2644285])
    eq("Foundation food with no 208 uses the Atwater energy (957) and fibre 293", (can["kcal"], can["fiber_g"]), (118.36, 6.69))
    # a food missing a required value is refused with a reason
    cut = dict(by[173735]); cut["foodNutrients"] = [n for n in cut["foodNutrients"] if n["nutrient"]["number"] != "291"]
    row, probs = to_row(cut)
    eq("missing fibre -> no row, a reason", (row, len(probs)), (None, 1))
    row0, _ = to_row(cut, fiber0=True)
    eq("fiber0: a food with no fibre value is listed with 0 and marked in extras", (row0["fiber_g"], row0["extra"].get("fiber_assumed_zero")), (0.0, 1))
    buf = io.StringIO(); write_csv([beans, ban, egg, can], buf)
    rows = list(csv.DictReader(io.StringIO(buf.getvalue())))
    eq("csv has 4 rows and the core columns", (len(rows), CORE[0], "extra:sodium_mg" in rows[0]), (4, "name", True))
    eq("csv portions look like label:grams;label:grams", rows[0]["portions"], "cup:172")
    eq("csv fdc_id", rows[0]["fdc_id"], "173735")
    key = os.environ.get("FDC_API_KEY", "")
    eq("the key is not in the sample or the output", bool(key) and key in buf.getvalue(), False)
    print("\n".join(("FAIL " + b) for b in bad) if bad else "fdc_fetch self-check: all passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("resolve"); a.add_argument("--wishlist", required=True); a.add_argument("--out", required=True)
    b = sub.add_parser("fetch"); b.add_argument("--picks", required=True); b.add_argument("--out", required=True); b.add_argument("--cache", default=str(ROOT / ".fdc-cache"))
    sub.add_parser("check")
    args = ap.parse_args()
    if args.cmd == "check":
        selfcheck()
    elif args.cmd == "resolve":
        resolve(args.wishlist, args.out)
    else:
        fetch(args.picks, args.out, args.cache)

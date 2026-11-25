"""Turn the SMAE table (one row = one equivalent) into the ingredient loader's CSV (values per 100 g).

  python tools/smae_to_csv.py <smae-alimentos.csv> <out.csv>

The input is the table read out of the SMAE book (columns: group, subgroup, name, qty_text, qty, unit,
peso_bruto_g, peso_neto_g, kcal, protein_g, fat_g, carbs_g, fiber_g, check, extras). SMAE is a copyrighted book:
keep the input and the output OFF the public repo. Only this converter lives here.

Writes <out.csv> plus <out>-no-cargados.csv (rows left out, with the reason). Then load with:
  python tools/load_ingredients.py --base URL --csv <out.csv> --dataset smae-v4 --source "SMAE 4a edición" --version 4 [--apply]

Rules (spec "SMAE and USDA side by side"):
- per 100 g = value / net weight x 100. Each row is one equivalent of its group: groups = "<group> · <subgroup>:<net g>".
- portions: "equivalente:<net g>" and, for a household unit, "<unit>:<net g / qty>". A row measured in ml sets density.
- raw / cooked from the name; otherwise "otro".
- no fibre in the book -> fiber_g 0 and extra fiber_missing = 1 (shown as "incompleta", never as an exact 0).
- calories that don't add up -> loaded as printed with extra por_confirmar = 1. Sugar / fat just over 100 g per 100 g
  (the book's rounding, up to 110) -> 100 and por_confirmar; anything more is left out. Drinks and sweets: blank protein / fat = 0.
- repeated name+state -> the serving is added to the name: "Leche entera (1 taza)".
- starter tags with the USDA thresholds (per 100 g): fibre >= 6, protein >= 20, sodium <= 140; only where the value exists.
"""
import csv, json, re, sys
from pathlib import Path

# SMAE extras per equivalent -> loader extra names (per 100 g), same names the USDA set uses where they mean the same.
SCALED = {"sodium_mg": "sodium_mg", "calcium_mg": "calcium_mg", "iron_mg": "iron_mg", "potassium_mg": "potassium_mg",
          "vit_a_ug_re": "vitamin_a_ug", "vit_c_mg": "vitamin_c_mg", "folic_acid_ug": "folate_ug", "cholesterol_mg": "cholesterol_mg",
          "sfa_g": "saturated_fat_g", "pufa_g": "polyunsaturated_fat_g", "sugar_per_equiv_g": "sugars_g", "selenium": "selenium_ug",
          "ethanol_g": "ethanol_g", "phosphorus_mg": "phosphorus_mg"}
UNIT_FIX = {"G": "g", "cuchrada": "cucharada", "pieza med": "pieza mediana", "galletas": "galleta", "hojas": "hoja", "cuchara": "cucharada"}
HOUSEHOLD = {"pieza", "taza", "cucharada", "cucharadita", "rebanada", "lata", "sobre", "frasco", "paquete", "copa", "bolsa", "barra",
             "rebanada delgada", "pieza mediana", "envase", "galleta", "pieza pequeña", "cápsula", "filete", "vasito", "hoja",
             "pieza chica", "bolsa individual", "mitades", "raja", "tarro o lata", "bolsita", "orejon", "bote sport"}
COOKED = re.compile(r"\b(cocid|hervid|asad|frit|horne|al vapor|guisad|capead|empanizad|rostizad|a la plancha|cocinad)", re.I)
BLANK_IS_ZERO = {"Bebidas alcohólicas", "Azúcares"}
RAW = re.compile(r"\bcrud", re.I)
TAG_RULES = (("alta en fibra", lambda r, x: not x.get("fiber_missing") and r["fiber_g"] >= 6),
             ("alta en proteína", lambda r, x: r["protein_g"] >= 20),
             ("bajo en sodio", lambda r, x: "sodium_mg" in x and x["sodium_mg"] <= 140))
OUT_COLS = ["name", "state", "kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "density_g_ml", "groups", "portions", "tags"]


def r4(v):
    return round(v + 0.0, 4)


def state_of(name):
    return "cocido" if COOKED.search(name) else "crudo" if RAW.search(name) else "otro"


def fnum(s):
    s = (s or "").strip()
    return float(s) if s else None


def convert(rows):
    """rows: dicts from the SMAE table. Returns (out_rows, skipped[(name, reason)])."""
    out, skipped, extra_keys = [], [], set()
    for src in rows:
        name = re.sub(r"\s+", " ", (src.get("name") or "")).strip()
        net, qty = fnum(src.get("peso_neto_g")), fnum(src.get("qty"))
        unit = UNIT_FIX.get((src.get("unit") or "").strip(), (src.get("unit") or "").strip())
        vals = {k: fnum(src.get(k)) for k in ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g")}
        if not name:
            skipped.append(("", "sin nombre")); continue
        if not net or net <= 0:
            skipped.append((name, "sin peso neto")); continue
        group = (src.get("group") or "").strip()
        if group in BLANK_IS_ZERO:   # the book leaves protein / fat blank when there is none (drinks, sweets)
            for k in ("protein_g", "fat_g"):
                vals[k] = 0.0 if vals[k] is None else vals[k]
        if any(vals[k] is None for k in ("kcal", "protein_g", "fat_g", "carbs_g")):
            skipped.append((name, "faltan calorías o macros")); continue
        f = 100.0 / net
        r = {k: r4(float(vals[k] or 0) * f) for k in ("kcal", "protein_g", "fat_g", "carbs_g")}
        x = {}
        if vals["fiber_g"] is None:
            r["fiber_g"], x["fiber_missing"] = 0, 1
        else:
            r["fiber_g"] = r4(vals["fiber_g"] * f)
        over = [k for k in ("protein_g", "fat_g", "carbs_g", "fiber_g") if r[k] > 100]
        if r["kcal"] > 1000 or any(r[k] > 110 for k in over):
            skipped.append((name, f"valores imposibles por 100 g (peso neto {net:g} g)")); continue
        for k in over:   # pure sugar / fat just over 100 g per 100 g: the book's rounding (8.4 g in 8 g)
            r[k], x["por_confirmar"] = 100, 1
        ex = json.loads(src.get("extras") or "{}") if (src.get("extras") or "").strip() else {}
        if ex.get("iron_mg") is None and ex.get("iron_nonheme_mg") is not None:
            ex["iron_mg"] = ex["iron_nonheme_mg"]
        for k, ours in SCALED.items():
            if isinstance(ex.get(k), (int, float)):
                x[ours] = r4(ex[k] * f)
        if x.get("sugars_g", 0) > 100:
            x["sugars_g"] = 100
        if isinstance(ex.get("glycemic_index"), (int, float)):
            x["glycemic_index"] = ex["glycemic_index"]   # an index, not an amount: not scaled
        if (src.get("check") or "").strip():
            x["por_confirmar"] = 1
        sub = (src.get("subgroup") or "").strip()
        label = f"{group} · {sub}" if sub else group
        portions = [f"equivalente:{r4(net):g}"]
        dens = ""
        if unit in HOUSEHOLD and qty and qty > 0:
            portions.append(f"{unit}:{r4(net / qty):g}")
        elif unit == "ml" and qty and qty > 0 and 0.3 <= net / qty <= 2:
            dens = f"{r4(net / qty):g}"
        tags = [t for t, ok in TAG_RULES if ok(r, x)]
        serving = f"{(src.get('qty_text') or '').strip()} {unit}".strip()
        out.append(dict(name=name, state=state_of(name), **r, density_g_ml=dens, groups=f"{label}:{r4(net):g}" if label else "",
                        portions=";".join(portions), tags=";".join(tags), _x=x, _serving=serving))
        extra_keys |= set(x)
    # repeated name + state: add the serving so both stay; if still repeated, number them
    seen = {}
    for r in out:
        seen.setdefault((r["name"].lower(), r["state"]), []).append(r)
    for group in seen.values():
        if len(group) > 1:
            for r in group:
                r["name"] = f"{r['name']} ({r['_serving']})" if r["_serving"] else r["name"]
    again = {}
    for r in out:
        k = (r["name"].lower(), r["state"])
        again[k] = again.get(k, 0) + 1
        if again[k] > 1:
            r["name"] = f"{r['name']} {again[k]}"
    for r in out:
        if len(r["name"]) > 120:
            r["name"] = r["name"][:117] + "..."
    return out, skipped, sorted(extra_keys)


def write(out, skipped, extra_keys, dst):
    dst = Path(dst)
    with dst.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(OUT_COLS + [f"extra:{k}" for k in extra_keys])
        for r in out:
            w.writerow([r[c] for c in OUT_COLS] + [r["_x"].get(k, "") for k in extra_keys])
    with dst.with_name(dst.stem + "-no-cargados.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "motivo"])
        w.writerows(skipped)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    out, skipped, keys = convert(src)
    write(out, skipped, keys, sys.argv[2])
    dupes = sum(1 for r in out if r["name"].endswith(")") and r["_serving"] and r["name"].endswith(f"({r['_serving']})"))
    print(f"{len(src)} rows read -> {len(out)} ingredients written, {len(skipped)} left out "
          f"({sum(1 for r in out if r['_x'].get('fiber_missing'))} without fibre, {sum(1 for r in out if r['_x'].get('por_confirmar'))} por confirmar, "
          f"{dupes} renamed with their serving, {sum(1 for r in out if r['tags'])} with starter tags).")

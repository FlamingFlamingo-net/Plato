# Golden examples for the natural-language skill

Each file pairs a plain-language `request` with the exact `expected` import file (`docs/plato-import.schema.json`) and the
calories per serving the app must compute for it (`expected_kcal_per_serving`, worked out by hand from the USDA values in
`data/ingredients-usda.csv`). They are the test set for the skill and are checked by `tools/dishapi_check.mjs`.

Rules the examples show: ingredients by `fdc_id` (never by guessed name); grams unless the request names a household
portion; the portion label copied exactly; amounts are for ONE serving; no nutrition numbers.

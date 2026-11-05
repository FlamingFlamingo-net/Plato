/// <reference path="../pb_data/types.d.ts" />
// One-time cleanup (spec "Fix: Emails ignore capitals"): existing nutritionist/patient emails become lowercase.
// Done in SQL on purpose: a normal save that changes an email signs that person out; this does not,
// and passwords are untouched. Two accounts that differ only by capitals are left as they are and logged.
// Undo: none needed (the original capitals carry no meaning); `migrate down` does nothing.

migrate((app) => {
  for (const table of ["nutritionists", "patients"]) {
    const clash = arrayOf(new DynamicModel({ e: "" }));
    app.db().newQuery(`SELECT LOWER(TRIM(email)) AS e FROM ${table} WHERE email != '' GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1`).all(clash);
    if (clash.length) console.warn(`[email-lowercase] ${table}: ${clash.length} email(s) differ only by capitals; left unchanged`);
    app.db().newQuery(`UPDATE ${table} SET email = LOWER(TRIM(email))
      WHERE email != '' AND email != LOWER(TRIM(email))
        AND LOWER(TRIM(email)) NOT IN (SELECT LOWER(TRIM(email)) FROM ${table} WHERE email != '' GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1)`).execute();
  }
}, (app) => {});

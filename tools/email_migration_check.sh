#!/usr/bin/env bash
# Checks the one-time email cleanup (spec "Fix: Emails ignore capitals", acceptance 5) on a throwaway server:
# 1. boot the code from <base-commit> (before the fix) with a throwaway data volume, make mixed-case accounts;
# 2. boot the current code on the same data (the migration runs), then check the result.
# Usage: bash tools/email_migration_check.sh <base-commit>     (needs the aht-test:run image; port 8091)
set -u
BASE_REF=${1:?base commit}
REPO=$(pwd -W 2>/dev/null || pwd); WT="$(cygpath -m "${TMPDIR:-$REPO/..}" 2>/dev/null || echo "${TMPDIR:-/tmp}")/email-wt-$$"; VOL=pb-email-check-$$
B=http://127.0.0.1:8091; pass=0; fail=0
ok() { if [ "$1" = 1 ]; then echo "PASS $2"; pass=$((pass+1)); else echo "FAIL $2  -> ${3:-}"; fail=$((fail+1)); fi; }
boot() { docker rm -f pb-check >/dev/null 2>&1; sleep 1
  docker run -d --rm --name pb-check -p 127.0.0.1:8091:8090 -v $VOL:/pb/pb_data -v "$1/pb_hooks:/pb/pb_hooks" -v "$1/pb_migrations:/pb/pb_migrations" -v "$1/pb_public:/pb/pb_public" aht-test:run >/dev/null; sleep 6; }
git worktree add -q --detach "$WT" "$BASE_REF"
boot "$WT"
docker exec pb-check /pb/pocketbase superuser upsert zz-admin@test.local ZzAdminCheck12345 >/dev/null
SU=$(curl -s -X POST $B/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"zz-admin@test.local","password":"ZzAdminCheck12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
mk() { curl -s -X POST $B/api/collections/nutritionists/records -H "Authorization: $SU" -H 'Content-Type: application/json' -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"CasoPrueba12345\",\"passwordConfirm\":\"CasoPrueba12345\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).email'; }
ok $([ "$(mk Mixto Mixto.Caso@Example.com)" = "Mixto.Caso@Example.com" ] && echo 1 || echo 0) "before the fix: an account saved with capitals keeps them"
mk Doble1 Doble@Example.com >/dev/null; mk Doble2 doble@example.com >/dev/null
TOKEN=$(curl -s -X POST $B/api/collections/nutritionists/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"Mixto.Caso@Example.com","password":"CasoPrueba12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
ok $([ ${#TOKEN} -gt 20 ] && echo 1 || echo 0) "before the fix: it signs in with the exact capitals (open session kept for later)"
boot "$REPO"
emails=$(curl -s "$B/api/collections/nutritionists/records?perPage=50&sort=email" -H "Authorization: $SU" | node -pe 'JSON.parse(require("fs").readFileSync(0)).items.map(r=>r.email).join(" ")')
ok $(echo " $emails " | grep -q " mixto.caso@example.com " && echo 1 || echo 0) "after the cleanup: the mixed-case account is lowercase" "$emails"
ok $(echo " $emails " | grep -q " Doble@Example.com " && echo " $emails " | grep -q " doble@example.com " && echo 1 || echo 0) "two accounts differing only by capitals are left unchanged" "$emails"
ok $(docker logs pb-check 2>&1 | grep -q "1 email(s) differ only by capitals" && echo 1 || echo 0) "…and logged"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/collections/nutritionists/auth-refresh -H "Authorization: $TOKEN")
ok $([ "$code" = 200 ] && echo 1 || echo 0) "the open session still works (nobody signed out)" "$code"
for id in mixto.caso@example.com Mixto.Caso@Example.com MIXTO.CASO@EXAMPLE.COM; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/collections/nutritionists/auth-with-password -H 'Content-Type: application/json' -d "{\"identity\":\"$id\",\"password\":\"CasoPrueba12345\"}")
  ok $([ "$code" = 200 ] && echo 1 || echo 0) "same password, signs in typed as $id" "$code"
done
docker rm -f pb-check >/dev/null 2>&1; docker volume rm $VOL >/dev/null; git worktree remove --force "$WT"
echo "$pass/$((pass+fail)) passed"; [ $fail = 0 ]

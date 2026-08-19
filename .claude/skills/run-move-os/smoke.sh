#!/usr/bin/env bash
# Smoke de la API MoveOS corriendo en localhost:3000 (solo lectura).
# Uso: bash .claude/skills/run-move-os/smoke.sh
set -euo pipefail
API=${API:-http://localhost:3000}

fail() { echo "✗ $1" >&2; exit 1; }

curl -sf "$API/health" | grep -q '"ok":true' || fail "health"
echo "✓ health"

TOKEN=$(curl -sf "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.dalego.co","password":"dalego123"}' | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "login admin demo"
echo "✓ login admin"

AUTH=(-H "Authorization: Bearer $TOKEN")

curl -sf "$API/exceptions" "${AUTH[@]}" | jq -e '.items | type == "array"' >/dev/null || fail "exceptions"
echo "✓ cockpit de excepciones"

N=$(curl -sf "$API/addresses/triage" "${AUTH[@]}" | jq '.orders | length')
echo "✓ triage de direcciones ($N pendientes)"

curl -sf "$API/addresses/validate" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"addressRaw":"Cra 13 # 54-20, Chapinero"}' | jq -e '.confidence' >/dev/null || fail "validate"
echo "✓ validación de dirección"

curl -sf "$API/orders?take=5" "${AUTH[@]}" | jq -e 'type == "array"' >/dev/null || fail "orders"
echo "✓ pedidos"

PTOKEN=$(curl -sf "$API/platform/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"ops@dalego.co","password":"dalego123"}' | jq -r .token)
curl -sf "$API/platform/flywheel" -H "Authorization: Bearer $PTOKEN" \
  | jq -e '.graph.totalPins' >/dev/null || fail "flywheel"
echo "✓ plataforma + flywheel"

echo "SMOKE OK"

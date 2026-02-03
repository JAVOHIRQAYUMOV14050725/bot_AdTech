#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:4002/api}"

echo "== Live/Ready checks"
curl -sS "${API_URL}/health/live"
echo
curl -sS "${API_URL}/health/ready"
echo

echo "== Register publisher + advertiser"
PUBLISHER_IDENTIFIER="${PUBLISHER_IDENTIFIER:-@publisher1}"
ADVERTISER_IDENTIFIER="${ADVERTISER_IDENTIFIER:-@advertiser1}"
PUBLISHER_TOKEN="$(
  curl -sS -X POST "${API_URL}/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":\"${PUBLISHER_IDENTIFIER}\",\"password\":\"publisher-pass\",\"role\":\"publisher\",\"username\":\"publisher1\"}" \
  | jq -r '.token'
)"
ADVERTISER_TOKEN="$(
  curl -sS -X POST "${API_URL}/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":\"${ADVERTISER_IDENTIFIER}\",\"password\":\"advertiser-pass\",\"role\":\"advertiser\",\"username\":\"advertiser1\"}" \
  | jq -r '.token'
)"

echo "== Auth me"
curl -sS "${API_URL}/auth/me" -H "Authorization: Bearer ${PUBLISHER_TOKEN}"
echo

echo "== RBAC guard (should be 401/403)"
curl -sS -o /dev/null -w "%{http_code}\n" "${API_URL}/admin/moderation/pending"

echo "== Channel create + verification request"
CHANNEL_IDENTIFIER="${CHANNEL_IDENTIFIER:-@smoketest}"
CHANNEL_ID="$(
  curl -sS -X POST "${API_URL}/channels" \
    -H "Authorization: Bearer ${PUBLISHER_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channelIdentifier\":\"${CHANNEL_IDENTIFIER}\",\"title\":\"SmokeTest Channel\"}" \
  | jq -r '.id'
)"
curl -sS -X POST "${API_URL}/channels/${CHANNEL_ID}/request-verification" \
  -H "Authorization: Bearer ${PUBLISHER_TOKEN}"
echo

echo "== Campaign create + creative + target"
CAMPAIGN_ID="$(
  curl -sS -X POST "${API_URL}/campaigns" \
    -H "Authorization: Bearer ${ADVERTISER_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"Smoke Campaign","totalBudget":"100.00"}' \
  | jq -r '.id'
)"
curl -sS -X POST "${API_URL}/campaigns/${CAMPAIGN_ID}/creatives" \
  -H "Authorization: Bearer ${ADVERTISER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"contentType":"text","contentPayload":{"text":"Smoke test post"}}'
echo
TARGET_ID="$(
  curl -sS -X POST "${API_URL}/campaigns/${CAMPAIGN_ID}/targets" \
    -H "Authorization: Bearer ${ADVERTISER_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channelId\":\"${CHANNEL_ID}\",\"price\":\"10.00\",\"scheduledAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" \
  | jq -r '.id'
)"

echo "== Moderation approve (requires ADMIN_TOKEN)"
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "Set ADMIN_TOKEN to a super_admin/admin JWT before running approve."
else
  curl -sS -X POST "${API_URL}/admin/moderation/${TARGET_ID}/approve" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}"
  echo
fi

echo "== Queue + worker heartbeat visibility (ready check)"
curl -sS "${API_URL}/health/ready"
echo

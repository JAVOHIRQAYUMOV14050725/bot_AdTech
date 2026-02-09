#!/usr/bin/env bash
set -euo pipefail

# Integration smoke test for marketplace flow.
# Required env vars:
# - API_BASE_URL (e.g. http://localhost:3000)
# - INTERNAL_API_TOKEN
# - ADVERTISER_ID
# - PUBLISHER_ID
# - CHANNEL_ID

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:?Missing INTERNAL_API_TOKEN}"
ADVERTISER_ID="${ADVERTISER_ID:?Missing ADVERTISER_ID}"
PUBLISHER_ID="${PUBLISHER_ID:?Missing PUBLISHER_ID}"
CHANNEL_ID="${CHANNEL_ID:?Missing CHANNEL_ID}"

correlation_id="cli-$(date +%s)"
idempotency_key="marketplace:${correlation_id}"

echo "1) Create deposit intent"
curl -sS "${API_BASE_URL}/internal/payments/deposit-intents" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
        \"userId\": \"${ADVERTISER_ID}\",
        \"amount\": \"25.00\",
        \"idempotencyKey\": \"deposit:${correlation_id}\"
      }" | jq .

echo "2) Create deal (auto-lock escrow)"
deal_response=$(curl -sS "${API_BASE_URL}/internal/addeals" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
        \"advertiserId\": \"${ADVERTISER_ID}\",
        \"publisherId\": \"${PUBLISHER_ID}\",
        \"channelId\": \"${CHANNEL_ID}\",
        \"amount\": \"25.00\",
        \"idempotencyKey\": \"${idempotency_key}\",
        \"correlationId\": \"${correlation_id}\"
      }")

echo "${deal_response}" | jq .
deal_id=$(echo "${deal_response}" | jq -r '.id')

echo "3) Accept deal"
curl -sS -X POST "${API_BASE_URL}/internal/addeals/${deal_id}/accept" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" | jq .

echo "4) Submit proof + settle"
curl -sS -X POST "${API_BASE_URL}/internal/addeals/${deal_id}/proof" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"proofText\": \"Posted in channel\"}" | jq .

curl -sS -X POST "${API_BASE_URL}/internal/addeals/${deal_id}/settle" \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" | jq .

echo "5) Verify payout + escrow"
echo "Run SQL checks:"
echo "SELECT wallet_id, SUM(amount) FROM ledger_entries GROUP BY wallet_id;"
echo "SELECT * FROM ad_deal_escrows WHERE ad_deal_id = '${deal_id}';"
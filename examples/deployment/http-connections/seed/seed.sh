#!/bin/sh
# Adds two pump shells, once; the work orders refer to their global asset IDs.
set -eu
until curl -sf "$BASYX_URL/shells" > /dev/null; do sleep 2; done
for pump in 1 2; do
  id="urn:example:aas:pump-$pump"
  key=$(printf '%s' "$id" | base64 | tr '+/' '-_' | tr -d '=\n')
  if curl -sf "$BASYX_URL/shells/$key" > /dev/null; then continue; fi
  curl -sf -X POST "$BASYX_URL/shells" -H 'Content-Type: application/json' -d "{
    \"modelType\": \"AssetAdministrationShell\",
    \"id\": \"$id\",
    \"idShort\": \"Pump$pump\",
    \"displayName\": [{ \"language\": \"en\", \"text\": \"Pump $pump\" }],
    \"assetInformation\": { \"assetKind\": \"Instance\", \"globalAssetId\": \"urn:example:asset:pump-$pump\" }
  }" > /dev/null
done
echo seeded

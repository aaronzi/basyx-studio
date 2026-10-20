# Signed app example

Studio without login, with a trust store and a directory of app packages
([ADR 0044](../../../docs/adr/0044-app-package-signatures-trust-store-and-updates.md)).
A team builds and signs its app in its own repository; the operator trusts the
team's public key for the team's app IDs; Studio verifies every package before
it installs it and updates installed apps in place. Developer mode
(`STUDIO_APPS_ALLOW_UNSIGNED`) stays off.

| File | Purpose |
| --- | --- |
| `compose.yaml` | Studio with `STUDIO_APPS_TRUSTED_PUBLISHERS` and `STUDIO_APP_PACKAGES` |
| `trust/trusted-publishers.yaml` | The trust store: one publisher, its key, its app IDs and a reserved permission |
| `packages/` | Packages Studio installs at startup, each with an optional `.sig` |
| `ci/release-app.yml` | A release workflow for the app's own repository |
| `smoke-test.mjs` | Signs packages with cosign and checks install, update and revocation end to end |

## Try it

You need [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)
2 or 3.

1. Create the team's key pair, and give Studio the public key:

   ```bash
   cosign generate-key-pair --output-key-prefix example-team
   cp example-team.pub trust/keys/
   ```

   Keep `example-team.key` with the team (in CI, as a secret), never next to
   the trust store.

2. Pack an app: a ZIP file with `studio-app.json` at its root, whose `id` is
   within the publisher's `appIds` (`org.example.*` here). Sign it:

   ```bash
   cosign sign-blob --key example-team.key --use-signing-config=false --tlog-upload=false \
     --output-signature org.example.my-app-1.0.0.zip.sig org.example.my-app-1.0.0.zip
   ```

   With cosign 2, leave out `--use-signing-config=false`.

3. Start Studio:

   ```bash
   docker compose up -d
   ```

4. Open <http://localhost:3000/?panel=apps>, pick the package and its
   signature, and select *Install app*. Studio checks both and shows the
   verified publisher and what the app requests; *Install* installs it.

   The same with the API, in two steps:

   ```bash
   curl -X POST 'http://localhost:3000/api/studio/v1/app-installations?inspect=true' \
     -H 'Content-Type: application/zip' -H "Studio-App-Signature: $(cat org.example.my-app-1.0.0.zip.sig)" \
     --data-binary @org.example.my-app-1.0.0.zip   # plus the session cookie and X-CSRF-Token
   ```

A higher version of the same app, signed by a key of the same publisher,
updates the installation in place: its ID, deep links and audit records stay.
The dialog marks permissions the new version adds.

To let the deployment install a package instead, copy it and its `.sig` into
`packages/` and restart Studio. Managed packages cannot be removed on the
*Apps* page; remove the file and restart.

## What Studio refuses

| Package | Answer |
| --- | --- |
| No signature, developer mode off | `app_unsigned_disabled` |
| Changed after signing, or signed by a key not in the trust store | `app_signature_invalid` |
| Signed by a trusted key, but for an app ID outside its `appIds` | `app_signer_not_allowed` |
| An update signed by another publisher, or an unsigned update of a signed app | `app_signer_not_allowed` |
| The same or a lower version of an installed app | `app_already_installed` |

Removing the key from `trusted-publishers.yaml` revokes the apps it signed at
the next start: their frames and calls are refused, and the *Apps* page says
why. A package signed with a key that is in the trust store restores them.

## Signing in another repository's CI

`ci/release-app.yml` is a GitHub Actions workflow for the app's repository. On
a `v*` tag it builds the app, packs it, signs the package with the team's key
from the repository's secrets, verifies the signature with the committed
`cosign.pub`, and attaches the package and its `.sig` to the release.

- Store `cosign.key` as the secret `COSIGN_PRIVATE_KEY` and its password as
  `COSIGN_PASSWORD`. cosign reads the key with `--key env://COSIGN_PRIVATE_KEY`.
- `--use-signing-config=false --tlog-upload=false` sign offline. Without them,
  cosign 3 fetches Sigstore's signing configuration, records the signature in
  the public Rekor log and needs `--bundle app.zip.sig`. Studio reads such a
  bundle too and ignores the log entry.
- Keyless signing (`cosign sign-blob` without `--key`) is not accepted: Studio
  verifies against the keys in its trust store only, which must be ECDSA P-256.
- Other CI systems run the same two cosign commands.

When a key is rotated, add the new public key to the publisher's `keys` first,
release with it, then remove the old key. Apps the old key signed are revoked
once it is removed, until they are released again with the new key.

## Smoke test

`smoke-test.mjs` creates a key pair with cosign, packs and signs two versions
of a small app, starts the stack with a Studio image of your choice and checks
through Studio's API that

- an unsigned upload is refused, and a signed package installs without
  developer mode;
- a higher version updates in place with the same installation ID;
- tampered packages, unknown keys and app IDs outside the key's patterns are
  refused;
- a signed package in `packages/` is installed as managed;
- removing the key revokes the apps it signed at the next start.

```bash
STUDIO_IMAGE=basyx-studio:dev node smoke-test.mjs
```

It uses `cosign` from the `PATH`, or the cosign container image when there is
none. `KEEP_STACK=1` leaves the stack running afterwards.

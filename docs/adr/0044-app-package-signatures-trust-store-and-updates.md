# 0044: App package signatures, trust store and updates

- Status: Proposed
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Amends: the marketplace signatures of
  [ADR 0004](0004-runtime-installable-apps.md); developer mode, the `unsigned`
  label and "one version per app ID" of
  [ADR 0016](0016-app-manifest-and-packages.md)
- Takes over: managed packages (M2) of the [MVP-7 plan](../development/mvp-7-plan.md)
- Requirements: APP-003, APP-011, APP-022, SAP-003

## Context

Studio installs apps from ZIP packages and checks their SHA-256 digests
(ADR 0016). Nothing says who built a package: uploads need developer mode
(`STUDIO_APPS_ALLOW_UNSIGNED`) and are labelled unsigned, and ADR 0004 leaves
signatures to a marketplace that does not exist yet. An installed app cannot
be updated; it has to be uninstalled, and the new installation gets a new ID,
which breaks deep links and separates audit records.

Teams that build apps in their own repositories
([external apps plan](../development/external-apps-plan.md)) need to release
them to hosted deployments without developer mode, and operators need to say
whose apps they accept. Self-hosted CI often has no public identity provider,
so keyless signing is not an option for everyone.

## Decision

### Signatures

- A signature is detached and covers the exact bytes of the package: ECDSA
  P-256 with SHA-256, DER-encoded and base64, as `cosign sign-blob --key`
  writes it. The file is `<package>.zip.sig`. Studio also reads a Sigstore
  bundle (`--bundle`, the default of cosign 3) and uses its message
  signature; the digest in the bundle must match the package. Transparency
  log entries and certificates in a bundle are ignored.
- Verification uses `node:crypto` only. Keys are PEM public keys
  (SubjectPublicKeyInfo) on P-256; other key types are refused when the trust
  store is read. A key's fingerprint is `sha256:<hex>` of its DER encoding,
  the value cosign shows as the key hint.
- Keyless signing (Fulcio, Rekor) is not used.

### Trust store

- `STUDIO_APPS_TRUSTED_PUBLISHERS` names a YAML file, read at startup like
  declared infrastructures (ADR 0037). Each publisher has a `name`, `keys` (PEM
  text or file paths relative to the file), `appIds` and optional
  `permissions`:

  ```yaml
  version: 1
  publishers:
    - name: Example GmbH
      keys: [keys/example.pub]
      appIds: [org.example.*]
      permissions: [studio.timeseries.read]
  ```

- `appIds` are app IDs or prefixes ending in `.*`; `*` allows every ID. A key
  signs only the app IDs of its publisher. A key may belong to one publisher
  only, and names are unique. Errors in the file stop Studio from starting.
- `permissions` grants reserved permissions to the publisher's apps (see
  below). Only `studio.timeseries.read` can be granted; `studio.containers`
  stays with the apps shipped with Studio (ADR 0033).
- Desktop reads the same variable but has no settings for it yet.

### Trust state

- An installation records its `trust`: `bundled` (shipped with Studio,
  ADR 0023), `signed` (verified against the trust store), `managed` (an
  unsigned package that the operator mounted) or `unsigned` (developer mode).
  Signed installations also record the trust store's publisher name and the
  key fingerprint. This replaces the `unsigned` column of ADR 0016.
- The manifest's `publisher` stays the app's own claim. The *Apps* page shows
  the trust store's name as the verified publisher.
- `managed` is a separate flag: a managed package that is signed has the
  trust `signed`.

### Uploads and consent

- Signed uploads install without `STUDIO_APPS_ALLOW_UNSIGNED`. The upload
  takes the signature in the `Studio-App-Signature` header (the content of the
  `.sig` file). Unsigned uploads still need developer mode. A signature that
  does not verify with any trusted key, or a key outside its `appIds`, is
  refused, also when unsigned packages are allowed.
- Uploading is two steps. `POST /app-installations?inspect=true` runs every
  check and returns the manifest, the verification result, the reserved
  permissions the trust store grants and, for an update, what changes: added
  and removed permissions, sandbox flags and a new backend. Nothing is stored.
  The *Apps* page shows this in a dialog and installs on confirmation. The API
  itself treats the administrator's second request as the confirmation.

### Updates

- Installing an app ID that is installed updates it in place: the installation
  ID stays, so deep links and audit records stay valid. Files are replaced in
  one transaction, and a running backend is stopped; it starts with the new
  files on the next call.
- An upload may update an installation when:
  - both are signed by keys of the same trust store publisher; or
  - the installation is unsigned and the update is signed; or
  - both are unsigned, in developer mode.
- The version must be higher. A revoked installation may be restored with the
  same version, signed again.
- Uploads do not replace bundled or managed installations; the deployment owns
  those.

### Managed packages

- `STUDIO_APP_PACKAGES` lists `.zip` files or directories of them. Studio
  installs or updates them at startup, by digest, with the installer
  `deployment`. A `<package>.zip.sig` next to a package is verified like an
  upload; a signature that is present must verify, and the package is skipped
  otherwise. Unsigned managed packages are accepted with the trust `managed`,
  because the operator vouches for them.
- Managed packages may go back to a lower version, take over an app ID that an
  administrator or Studio installed, and work with
  `STUDIO_APPS_ALLOW_INSTALL=false`. They cannot be removed in the UI.
- A managed app whose package is no longer configured is uninstalled at
  startup, like a declared infrastructure that is removed from its file. When
  a configured package cannot be read, nothing is removed.

### Reserved permissions and revocation

- `studio.timeseries.read` is allowed for bundled apps and for signed apps
  whose publisher grants it. The permission is shown in the consent dialog,
  marked when the trust store does not grant it.
- A signed installation is revoked when its key is no longer in the trust
  store, or its app ID is no longer within the key's `appIds`. The trust store
  is read at startup, so revocation takes effect at the next start. Files of a
  revoked app are not served, its views and modules are not offered, its calls
  are refused with `app_revoked`, and the *Apps* page says why. A package
  signed with a trusted key restores the installation. There are no revocation
  lists.

## Consequences

- An app can be released from another repository's CI with cosign or Studio's
  own tooling and installed in a hosted deployment without developer mode.
- Operators decide whose apps they accept, per app ID, and can withdraw that
  decision by removing a key.
- Deep links and audit records survive updates.
- Signatures cover the package bytes, not the stored files. Studio keeps no
  copy of the package or its signature, so it cannot verify an installation
  again later. Revocation relies on the key fingerprint recorded at install
  time.
- Changing the trust store needs a restart. Removing a key revokes every app it
  signed, including versions signed before a key rotation; the publisher has
  to sign them again with the new key.
- A consent step in the UI is not enforced by the API. Administrators who
  script installs confirm by calling it.

## Alternatives considered

- **Keyless signatures (Fulcio, Rekor):** tie signing to a public identity
  provider and transparency log, which many self-hosted CI systems cannot
  reach. They remain an option for the marketplace.
- **Minisign, SSH or GPG signatures:** need either a new dependency or a format
  no supply-chain tool around OCI artifacts uses. cosign's format lets OCI
  signatures follow.
- **Re-verifying stored installations against the stored package:** needs the
  package and its signature in the database next to the files, doubling the
  stored bytes, for a check that the key fingerprint already allows.
- **Keeping one version per app ID until the marketplace exists:** breaks deep
  links on every release and asks administrators to uninstall apps that users
  depend on.

# 0048: Declared app settings and connection status per installation

- Status: Proposed
- Date: 2026-10-21
- Deciders: BaSyx Studio maintainers
- Implements: G1–G4 of the
  [external apps follow-up plan](../development/external-apps-follow-up-plan.md)
  (phase D)
- Builds on: declared infrastructures and their export and import
  ([ADR 0037](0037-declared-infrastructures-export-and-import.md)), the
  update consent of [ADR 0044](0044-app-package-signatures-trust-store-and-updates.md),
  and the bindings of [ADR 0047](0047-http-connections-for-apps.md)
- Requirements: APP-025, CON-002, CON-003, DATA-001, DEP-005, SAP-002

## Context

An app built in its own repository compiles in what differs between
deployments: the asset types it selects shells by, the semantic IDs and
idShorts it reads, the IDs it sends to a third-party service. Two
deployments, or two infrastructures of one deployment, then need two builds
and two signatures, and a declarative deployment cannot configure the app at
all.

The manifest has no settings and the context none. An app also learns that a
connection is not bound only when a call fails (`connection_not_bound`),
so it cannot say "not configured" before the user acts.

ADR 0047 put connection bindings on the infrastructure, keyed by app ID, so
that they can be declared before the app is installed and survive
reinstalls. Settings that differ per infrastructure have the same needs.

## Decision

### Settings in the manifest

```json
"studioApi": "^0.1.9",
"settings": [
  {
    "key": "assetTypes",
    "type": "stringList",
    "scope": "infrastructure",
    "required": true,
    "title": { "en": "Asset types", "de": "Asset-Typen" },
    "description": { "en": "The asset types of the shells the app lists." }
  },
  { "key": "siteId", "type": "string", "scope": "infrastructure", "title": { "en": "Site ID" } },
  { "key": "units", "type": "string", "enum": ["metric", "imperial"], "default": "metric", "title": { "en": "Units" } },
  { "key": "pageSize", "type": "number", "default": 50, "title": { "en": "Shells per page" } }
]
```

- `settings` is a top-level manifest field with up to 32 entries. `key` is
  an identifier (`[a-z][A-Za-z0-9]{0,63}`, unique), so an app reads
  `settings.assetTypes`.
- `type` is `string`, `number` (a finite JSON number), `boolean` or
  `stringList`. `enum` lists 1 to 100 allowed strings for `string` and for
  the items of `stringList`. There is no free JSON Schema: Studio renders
  the forms and validates the values, and objects, references or formats
  would need a form generator and a second validator.
- `default` has the setting's type and, with `enum`, one of its values.
- `required` (default `false`) marks a setting the app cannot work without.
  Studio marks it in the forms and lists required settings without a value
  on the *Apps* page. It does not block the app: the app gets `null` and
  shows that it is not configured, because the value may come from an
  infrastructure that is configured later.
- `scope` is `installation` (default) or `infrastructure`. The plan called
  the second `target`; values are set on infrastructures, and workspaces
  have none, so the name says where they are set.
- `title` and `description` are localized like a connection's.
- Strings are up to 2,000 characters; a `stringList` holds up to 100 of
  them.
- The manifest declares Studio app API `^0.1.9` or higher to use
  `settings`; `studio-app pack` reports a lower range, as for ADR 0045's
  fields.

`studio-app pack`, `studio-app verify` and Studio's upload share the checks
(`@basyx/studio-app-kit/manifest`): the schema, unique keys, `enum` only for
`string` and `stringList`, and a `default` that the setting accepts. Studio
validates every stored value with the same function, `checkSettingValue`.

Settings are not permissions. Declaring one needs no permission, and adding
one on an update needs no grant of its own.

### Where values are set

| Scope | Per installation (*Apps* page, API) | Per infrastructure (dialog, declared YAML, import) | Workspaces |
| --- | --- | --- | --- |
| `installation` | yes | refused | installation value |
| `infrastructure` | yes, as the fallback | yes | installation value |

- **Per installation.** Administrators set values on the *Apps* page
  (`PUT /app-installations/{id}/settings`). They are stored with the
  installation (migration 0009), also for bundled and managed apps, whose
  packages the deployment owns but whose values are data. An in-place
  update keeps them; uninstalling removes them.
- **Per infrastructure.** An infrastructure's `apps` list holds the values
  of `infrastructure`-scoped settings by app ID, like ADR 0047's bindings
  hold connections by app ID: they survive reinstalls and can be written
  before the app is installed. The infrastructure dialog shows a form per
  installed app that declares such settings, and keeps the entries of apps
  that are not installed. Managed deployments and single-app mode
  (ADR 0046) declare them in YAML:

  ```yaml
  infrastructures:
    - key: plant-north
      name: Plant North
      # endpoints, security, connections as before
      apps:
        - app: org.example.asset-board
          settings:
            assetTypes: [https://example.org/types/pump, https://example.org/types/valve]
            siteId: north-0815
  ```

  Up to 50 entries, each app ID once.
- **Precedence.** The infrastructure value, else the installation value,
  else the manifest's `default`, else `null`. A value is either set or not;
  there is no explicit "unset" that hides a value of a lower level. An empty
  text or list is a value, so it does hide them; the forms keep it apart
  from a field without a value.

### Validation

A value of the wrong type is refused when it is saved:

- `PUT /app-installations/{id}/settings` refuses undeclared keys and values
  that the setting does not accept, with `invalid_request` and a violation
  per key (`values.pageSize`).
- An infrastructure's `apps` entries have a static shape (keys, strings,
  numbers, booleans, lists of strings, the limits above). When the app is
  installed, the values are also checked against its manifest: undeclared
  keys, `installation`-scoped keys and values of the wrong type are refused
  (`apps.0.settings.assetTypes`). This applies to the dialog, the API, the
  import's dry run and the declared file. Studio now installs the managed
  and bundled apps before it applies the declared infrastructures, so a
  declared value of the wrong type fails the start before anything is
  written, as an invalid entry does (ADR 0037).
- Values for apps that are not installed are kept as they are and checked
  when the app is installed or updated.

When a package changes:

- An update keeps installation values whose setting still exists and still
  accepts them; others are dropped in the same transaction.
- Infrastructure values that the new version no longer accepts are not
  rewritten (a declared infrastructure cannot be). Studio ignores them when
  it resolves the settings, and the infrastructure dialog marks them, so
  that the next save drops or corrects them.
- The update dialog (ADR 0044) lists the settings an update adds, removes,
  and changes in type, values or scope, and the installation values it
  drops. Confirming the update covers them; settings need no separate
  consent, because they grant nothing.

### How an app reads them (G3, G4)

```ts
const { settings, connections } = client.context
// settings: { assetTypes: ['https://example.org/types/pump'], siteId: null, units: 'metric', pageSize: 50 }
// connections: { forecast: { bound: false } }
```

- `AppContext.settings` maps every declared key to its resolved value, or
  `null`. It belongs to the frame's target, like the rest of the context: a
  frame on another target gets that target's values.
- `AppContext.connections` maps every declared connection ID to
  `{ bound: boolean }`: whether an `http` connection of the target's
  infrastructure binds it (ADR 0047). Nothing else: no URL, scheme or
  connection key (CON-002, CON-003). Workspaces and frames without a target
  bind nothing. Calls still check the binding, which can change while a
  frame is open.
- Studio's page reads both for the frame from
  `GET /app-installations/{id}/context?targetId=`, before it loads the
  frame, so the first context has them. The route answers signed-in users
  who may open the infrastructure, as a connection call checks. The page
  reads them again when an administrator saves settings or an
  infrastructure in it; other open frames get changed values when they load
  again or their target changes.
- Backends get the same values with each call, as `settings` and
  `connections` next to `studio` in their handler's context, resolved for
  the target of the call, after the same check that the user may open its
  infrastructure.
- No method `studio.settings.get`: the context is there when the app starts,
  synchronously, and the values are small.
- Both fields are absent before app API 0.1.9. An app that declares
  `settings` declares `^0.1.9` and gets them; an app that only reads
  `connections` checks for `undefined`.
- `@basyx/studio-sdk/testing`: `testContext()` has empty `settings` and
  `connections`, a test passes them in `context`, and `connectionsHandler`
  refuses a connection that the context marks unbound, as Studio does.

### Secrets

Settings are not for secrets. Their values are stored in plain text, shown
to administrators, exported with the infrastructures, written to the
declared file, and sent to every browser that opens the app. Studio cannot
tell a secret from another string and does not try. API keys, tokens and
passwords stay with connections (ADR 0047), whose credentials never leave
Studio's server; the SDK README and the deployment guide say so. A secret
setting that only a backend reads is listed under *Later* in the plan.

### Audit

- `app.settings.update` records the administrator, the installation, the
  app ID and the keys that changed, without values.
- Infrastructure values are part of the infrastructure: `infrastructure.update`
  (and `create`) records the app IDs whose values changed.
- An update that drops installation values records their keys in
  `app.update`.

### Export and import (ADR 0037)

`apps` is a field of the infrastructure file like `connections`: exported
with its values (they are not secrets), imported with the same checks as a
save, including the dry run against the installed apps.

## Consequences

- One signed package serves deployments that name asset types, semantic IDs
  and external IDs differently; the operator configures it on the *Apps*
  page, in the infrastructure dialog or in YAML, without a rebuild.
- An app shows "not configured" for a missing setting or an unbound
  connection before its first call.
- Opening an app frame costs one request more, cached per installation and
  target.
- A frame keeps the values it got until it reloads or its target changes.
- Values for apps that are not installed are checked late, at install; a
  value that an update no longer accepts is ignored until an administrator
  changes it.
- Managed and bundled apps are now installed before declared infrastructures
  are applied at startup.

## Alternatives considered

- **JSON Schema for settings:** an app could declare objects and nested
  structures, but Studio would need a form generator, and the values would
  no longer be simple to declare in YAML or to check in the dialog.
- **A method `studio.settings.get`:** asynchronous where the context is not,
  and a second way to learn about the target.
- **Values per installation only:** one deployment may run an app on
  several infrastructures whose asset types and external IDs differ.
- **Values inside connection bindings:** many settings have no connection,
  such as asset types or idShorts.
- **Infrastructure values keyed by installation ID:** lost on reinstall and
  not declarable before the app is installed, as ADR 0047 found for
  bindings.
- **Checking values only when resolving them:** a value of the wrong type
  would be accepted silently and show up as a missing setting in the app.
- **Secret settings:** need encryption at rest, a read for backends only and
  references as in the infrastructure file; connections already do this for
  credentials.

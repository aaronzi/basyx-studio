# Asset board

A target module that lists the shells of the asset types an administrator
sets, with the serial number from one of their specific asset IDs. One
package serves deployments and infrastructures that name their asset types
and IDs differently: they are settings
([ADR 0048](../../../docs/adr/0048-app-settings-and-connection-status.md)),
not part of the build.

- [`studio-app.json`](studio-app.json) declares four settings with
  `"studioApi": "^0.1.9"`: `assetTypes` (a list, per infrastructure,
  required), `serialIdName` (text, per infrastructure, default
  `serialNumber`), `pageSize` (a number, per installation) and `showOthers`
  (yes or no, per installation).
- [`ui/src/App.vue`](ui/src/App.vue) reads them from `context.settings`
  and follows context updates. Without asset types, it says that it is not
  configured instead of listing anything.
- [`ui/src/dev-studio.ts`](ui/src/dev-studio.ts) passes settings to the
  test Studio of `@basyx/studio-sdk/testing`, so `pnpm dev` runs the app
  without Studio.

Set the values on the *Apps* page (per installation), in an
infrastructure's dialog under *App settings*, or in the declared
infrastructures:

```yaml
version: 1
infrastructures:
  - key: plant-north
    name: Plant North
    template: mono-all
    endpoints: [{ type: aasEnvironment, url: https://north.example.org }]
    security: { mode: unsecured }
    apps:
      - app: org.eclipse.basyx.examples.asset-board
        settings:
          assetTypes: [https://example.org/types/pump, https://example.org/types/valve]
          serialIdName: plantSerial
  - key: plant-south
    name: Plant South
    template: mono-all
    endpoints: [{ type: aasEnvironment, url: https://south.example.org }]
    security: { mode: unsecured }
    apps:
      - app: org.eclipse.basyx.examples.asset-board
        settings:
          assetTypes: [https://example.org/types/compressor]
```

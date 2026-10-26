# Inventory: a full-page module with pages

A full-page module (`"layout": "fullPage"`,
[ADR 0045](../../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md))
with three pages of its own, built as the
[app kit's README](../../../packages/studio-app-kit/README.md#modules-with-pages)
describes:

| Page | Route | Shows |
| --- | --- | --- |
| Overview | `/` | How many shells, instances and types the target has |
| Shells | `/shells` | The target's shells, with a search |
| Shell | `/shells/<key>` | A shell's submodels and its IFC models in the 3D viewer |

- `ui/src/router.ts` puts the pages on Vue Router with
  `createStudioHistory(client, { history: 'push' })`: Studio's URL carries
  the page as the module's sub-path (`…/inventory/shells/<key>`), so a page
  can be linked, and the browser's back button returns to the previous page
  (`"studioApi": "^0.1.8"`).
  The shell ID is in the route as base64url, since sub-paths are path
  segments of letters, digits and `-._~`.
- `ui/src/App.vue` lays the module out with the kit's defaults and states
  none of them (`eslint.config.js` checks it like the bundled apps): a
  toolbar with the module's title, its pages as tabs and the target's name,
  since Studio shows no breadcrumbs above a full-page module. No app bar or
  rail of its own: Studio's stay above and beside the frame.
- `ui/src/i18n.ts` has the texts in nested sections, in English and German;
  numbers and dates are formatted with `formatLocale`, in the language of
  the texts.
- `ui/src/pages/ShellPage.vue` registers only the IFC parser of
  `@basyx/file-viewer` (`/model/vue/core` with `ifcParser`), so the package
  holds web-ifc's WebAssembly and none of STEP's.
- `ui/src/dev.ts` is a test Studio built from `studio-app.json`
  (`createTestStudio({ manifest })`) with a few shells and the IFC model of
  Studio's test fixtures.

```bash
pnpm --dir examples/apps/inventory dev   # the app on the test Studio; ?locale=de&dark
pnpm apps:build                          # examples/apps/dist/inventory.zip
```

Install the package on the *Apps* admin page (developer mode:
`STUDIO_APPS_ALLOW_UNSIGNED=true`); the module shows in a target's rail. The
unit tests are Studio's `test/apps/inventory.test.ts`.

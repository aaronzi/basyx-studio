# Package editing plan: details pane, headers, several packages, clipboard and transfers

- Status: Proposed
- Date: 2026-10-25
- Depends on:
  - the editor of [MVP-5](mvp-5-plan.md) (implemented), whose clipboard
    (C1, C2) copies submodel elements;
  - targets and workspaces ([ADR 0003](../adr/0003-aas-targets-and-workspaces.md)),
    the Workspace Worker ([ADR 0014](../adr/0014-workspace-worker-and-package-engine.md))
    and the workspace undo log ([ADR 0030](../adr/0030-workspace-undo-log.md)).
- Requirements: DATA-012 to DATA-016, UX-003, UX-005 and UX-006
  ([requirements](../requirements.md))
- Issue: [eclipse-basyx/basyx-studio#92](https://github.com/eclipse-basyx/basyx-studio/issues/92)

## Goal

Feedback from testing the desktop app found three areas to improve:

- **The details pane** opens empty, without a way to close it.
- **The shell and submodel headers** break up when the content area is narrow,
  above all in edit mode.
- **AASX packages** are edited one at a time, and only submodel elements can be
  copied. Joining shells, submodels and concept descriptions from several
  packages, or between a package and an infrastructure, is not possible.

> a user opens `motor.aasx` and `line.aasx` → both appear as groups in the
> shell list → they copy the shell *Servo Motor DM-3000* from `motor.aasx` →
> they paste it into `line.aasx` → a plan lists the shell, its five submodels,
> the concept descriptions they use and two attachments, with one identifier
> that already exists → they choose *new identifiers* for it → the report
> shows what was created → they save `line.aasx` and export one of its
> submodels as XML.

## Starting point

- **Details pane** (`ElementDetailsDrawer`, `ConceptDescriptionDrawer`):
  - It is temporary below the `lg` breakpoint. When the window grows past
    `lg`, Vuetify's resize watcher opens the drawer, which then shows the
    *Nothing selected* empty state. The empty state has no close button.
  - It stays open when the user switches from *Submodels* to another tab.
- **Headers** (`shells/[shellKey].vue`, `submodels/index.vue`):
  - Two near-identical copies. Which actions show inline or in the ⋮ menu
    depends on the viewport (`smAndUp`). The card's width also depends on the
    drawers: the list is 340 px and the details pane 440 px. A wide window with
    both drawers open still shows every action inline, and the title wraps
    after every word.
  - `WorkspaceActions` (saved chip, undo, redo, *Save*, *Save as*, *Close*)
    sits in each shell, submodel and concept description header, although it
    acts on the whole package.
- **Several packages**:
  - The server already handles any number of open packages. Each is a target
    (`ws-…`), and `GET /targets` lists them all.
  - The UI shows one target at a time: every view and list is scoped to the
    route's `targetId`.
- **Clipboard** (`app/stores/clipboard.ts`, `useElementTree`, `useStructureEdits`):
  - It holds one submodel element as AAS JSON, or one model reference.
  - Pasting an element works across targets, because the content is plain JSON.
  - Shells, submodels and concept descriptions cannot be copied. File contents
    are not carried along (MVP-5 C1).
- **Import and export**:

  | What | Infrastructure | Package |
  | --- | --- | --- |
  | Shell export (BaSyx `/serialization`) | AASX, JSON, XML | none (`export: false`) |
  | Submodel export | JSON, XML | JSON, XML |
  | Import (BaSyx `/upload`) | AASX, JSON, XML | none (`upload: false`) |

  *Insert from JSON* exists for elements, submodels and concept descriptions.
- **Cross-target copy** of whole shells (DATA-012 to DATA-015) was left for a
  Transfer MVP of its own (MVP-5, out of scope). This plan provides it.

## Decisions

### Details pane

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Open only with content | The drawer is open only while it shows something: a selection, a new element's form or the shell form. The *Nothing selected* state goes. Clearing the selection closes the drawer, and the resize watcher is off (`disable-resize-watcher`), so a change of breakpoint never opens it. Both drawers follow this rule. |
| D2 | Tabs | The pane belongs to the *Submodels* tab. On *Overview* it opens on demand from a tile, as today. Switching tabs closes it. *Changes* and *JSON* never show it. |

### Headers

| # | Topic | Decision |
| --- | --- | --- |
| H1 | One component | `ResourceHeader` renders the header of shells and submodels: avatar, title, meta line, identifiers and actions. The pages pass their actions as data. |
| H2 | Width of the content | The header measures the width it actually has: the window width (`useDisplay`) minus the drawers and the rail (`useLayout().mainRect`). It does not use viewport breakpoints. Three widths: wide, medium and narrow. |
| H3 | Actions by rank | Each action has a rank. Wide shows the three lowest ranks inline, medium two, and narrow shows only the ⋮ menu; the rest go into ⋮. *Edit* ranks first and *Export* second, as Export is the one action of view mode. *Delete* always stays in ⋮ (UX-003), and the QR code joins ⋮ at narrow width, where the identifiers are hidden. |
| H4 | Title and meta | At medium and narrow width the actions move to their own row below the title, so the title gets the card's full width and wraps at word boundaries only. The meta line stays on one line, truncated, with the full text in a tooltip. Vuetify has no line-clamp utility, and the project allows no custom CSS, so titles are not clamped. |
| H5 | Package bar | `WorkspaceActions` moves out of the resource headers into a package bar in the app bar, next to the target switcher. It shows while a package is the current target. The headers keep only actions on their own resource. |

### Several packages

| # | Topic | Decision |
| --- | --- | --- |
| M1 | Grouped lists | While a package is the current target, the shell, submodel and concept description lists show one collapsible group per open package. A group header shows the file name and an unsaved-changes marker, and has a menu with *Save*, *Save as* and *Close*. |
| M2 | One target per view | Selecting an item opens it in its own package's route (`/targets/<ws-id>/…`). The views stay scoped to one target. Only the lists combine packages, and the copy-and-paste of K1 to K8 joins them. |
| M3 | Loading | The current package's group is expanded and loaded. Other groups load their first page when expanded. Which groups are expanded is remembered for the session. Search in the list filters every expanded group. |
| M4 | Opening | *Open package* accepts several files at once (`multiSelections`). Each file opens as its own target. The target switcher lists open packages first, each with its unsaved marker. |
| M5 | Desktop only | Packages exist only on desktop (ADR 0014). Hosted Studio shows no groups. |

### Clipboard and transfers

| # | Topic | Decision |
| --- | --- | --- |
| K1 | Typed entries | The clipboard holds one entry: a shell, a submodel, a submodel element, a concept description or a reference. An entry names its kind, its source target and keys, and a label. An element entry keeps its AAS JSON (MVP-5 C1). For identifiables, the source is read when pasting, so the paste copies its current state and its files. |
| K2 | Where it pastes | An element pastes into a submodel, a collection, an entity's statements or an annotated relationship's annotations. Into a list it pastes only where its type matches the list's `typeValueListElement`. A submodel pastes into a target as a standalone submodel, and optionally also into the selected shell's references. A shell pastes into a target. A concept description pastes into a target's concept description repository. A reference pastes into reference fields. *Paste* appears only where the entry fits, with the reason in a tooltip where it does not. |
| K3 | Transfer API | Identifiables paste through `POST /transfers/plans` and `POST /transfers`, between any packages and infrastructures (DATA-012). `server/lib/transfers` builds both on the `AasTarget` interface, so live targets and workspaces need no code of their own. Routes check edit mode, rights and `createResources` on the destination. |
| K4 | Plan first | The plan lists each resource that would be written: the shell, the submodels it references and the concept descriptions their semantic IDs name. For each it gives the state (new, exists, unchanged, not readable) and the files it carries. The user selects the dependencies, then chooses a policy for identifier collisions: *skip*, *replace*, or *new identifiers*. Validation findings from AAS Core show before anything is written (DATA-013). |
| K5 | New identifiers | *New identifiers* gives each copied shell and submodel a new ID. It rewrites the references inside the copied set: the shell's submodel references and `derivedFrom`. Concept descriptions keep their IDs, because an ID names the concept. A colliding concept description is skipped unless the user chooses *replace*. Pasting a shell or submodel into its own target always uses new identifiers. |
| K6 | Files | Attachments and thumbnails are copied where both sides have `files`. Otherwise the File keeps its path and the report names it. |
| K7 | Report | The transfer runs resource by resource: concept descriptions, then submodels, then the shell. The report names each resource as created, replaced, skipped or failed, because independent infrastructures give no atomicity (DATA-014). After a transfer into an infrastructure, the registries are kept in step as after an upload (DATA-020). Into a package, the transfer is one entry in the undo log. |
| K8 | Safe retry | The plan has an ID, and executing it is idempotent. A retried plan skips resources the first run created, so an interrupted transfer does not create duplicates (DATA-015). |
| K9 | System clipboard | *Copy* also writes the AAS JSON to the system clipboard. *Paste from text* reads AAS JSON or XML from it, either an environment or a single element, and validates it with AAS Core. An environment then goes through the same plan. |
| K10 | Keyboard | ⌘C and ⌘V (Ctrl on Windows and Linux) copy and paste in the tree and the lists while they have focus. Paste needs edit mode (UX-006). |

### Import and export

| # | Topic | Decision |
| --- | --- | --- |
| E1 | Import into packages | *Import* takes an AASX, JSON or XML file into a package too. The Workspace Worker parses the file (`inspect`, ADR 0014), and its content becomes the source of a transfer plan, so collisions are resolved as in K4. Infrastructures keep the BaSyx upload. |
| E2 | Export from Studio | `server/lib/transfers/serialize.ts` writes a set of resources as an AAS environment: JSON and XML with AAS Core, AASX with the package library and the files. Packages use it, where BaSyx `/serialization` does not exist. All targets use it for what BaSyx cannot export: a submodel as AASX (with its concept descriptions and files), and elements and concept descriptions as JSON or XML. |
| E3 | Export menu | Each export menu lists the formats its resource supports: shells AASX, JSON, XML; submodels AASX, JSON, XML; elements and concept descriptions JSON, XML. The package bar adds *Export package as* AASX, JSON or XML. |
| E4 | Capabilities | Workspaces report `export: true`. `upload` stays reserved for the BaSyx upload, and packages import through transfers (`createResources`). |

## Delivery

One pull request, with one commit for each step:

1. **Details pane:** D1 and D2.
2. **Headers:** H1 to H5.
3. **Several packages:** M1 to M5.
4. **Transfers:** K3 to K8, the server library, routes and tests against
   workspaces and the test environment.
5. **Clipboard:** K1, K2, K9 and K10, and the plan and report dialogs.
6. **Import and export:** E1 to E4.

## Tests

- **Unit tests** for `server/lib/transfers`:
  - plan and execute between in-memory workspaces;
  - every collision policy;
  - identifier rewriting;
  - retry of a half-run plan.
- **Integration tests** (`pnpm test:integration`): a transfer from a
  package into `basyx-open`, and from `basyx-open` into a package, with the
  registries kept in step.
- **Desktop end-to-end test:** open two packages, copy a shell from one into
  the other, save, and reopen the package.
- **Web end-to-end tests:**
  - the header at three content widths, with and without the drawers;
  - the details pane opens only with content and closes on a tab change.

## Risks

| Risk | Mitigation |
| --- | --- |
| Large closures (a shell with many submodels) make the plan slow | The plan reads metadata only; contents are read while executing, one resource at a time |
| A source changes between plan and execution | Execution compares revisions with the plan and reports a changed resource as failed |
| Rewritten identifiers miss a reference | Only references inside the copied set are rewritten, as K5 lists them; the plan says so |
| Grouped lists load many targets | Collapsed groups load nothing (M3) |

## Out of scope

- Cut and move: a move is a copy followed by a delete, and the delete needs its
  own confirmation.
- Drag and drop between groups.
- A side-by-side view of two targets.
- Packages in hosted Studio.
- Merging two submodels element by element.
- Copying into a target that offers no `createResources`.

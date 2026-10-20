# 0049: Structural writes and attachments for apps

- Status: Proposed
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Amends: the methods and audit of
  [ADR 0018](0018-capability-bridge-and-authorization.md); the capability
  token of [ADR 0019](0019-backend-app-runner.md)
- Implements: A1 and A2 of the [MVP-7 plan](../development/mvp-7-plan.md),
  phase E of the [external apps plan](../development/external-apps-plan.md)
- Requirements: APP-017, APP-020, DATA-007, DATA-009, DATA-020, UX-006

## Context

Apps read AAS content and set the values of Properties
(`studio.aas.setElementValue`), but cannot add, rename or delete elements,
create or delete shells and submodels, or upload the content of a File
element. Products built as apps need all of it, and the bundled FileSystem
view (X3 of the external apps plan) is its first consumer.

Studio's editor already writes structure with revisions (ADR 0013,
ADR 0027), verifies content with AAS Core, keeps registries and discovery in
step (ADR 0020, DATA-020), generates identifiers by the infrastructure's
scheme (ADR 0028) and records workspace changes in the undo log (ADR 0030).
The MVP-7 plan asks apps to use the same paths, and Studio's edit mode
(UX-006) to be checked on the server, not only by the app's own controls.

Two things do not follow from the plan alone. Edit mode is a state of
Studio's page, which the server does not know. And the bytes of an
attachment must cross from the frame to the target without a frame
network request, while `/app-calls` takes JSON.

## Decision

- **Methods.** `studio.aas.createShell`, `createSubmodel` (optionally with
  the shell that references it), `putSubmodel`, `addElement`, `putElement`
  (a new idShort renames; a container keeps its children), `deleteElement`,
  `deleteSubmodel` and `deleteShell` call the editor's functions
  (`server/lib/aas/creation.ts` and the target's structural writes). They need
  `studio.aas.write` and the target capability the editor's route needs
  (`createResources`, `writeStructure`, `deleteShells`, `files`). Moving an
  element between parents is not a method: an app adds it at the new place
  and deletes the old one.
- **Revisions.** Writes are based on the revisions the editor uses: the
  element's revision for replace, delete and attachments, the parent's
  structure revision for adds, the whole submodel's revision for
  `putSubmodel`. Element snapshots gain `structureRevision` for containers,
  and `studio.aas.getSubmodelSnapshot` returns a submodel with its revision
  and the structure revision of its top level. `putAttachment` takes the
  File element's `revision`, which the plan's signature left out, so a
  concurrent change of the element conflicts as in the editor.
- **Edit mode on the server.** Studio's page sends its mode with every call
  (`mode` in `/app-calls`). The server refuses the new methods unless it is
  `edit`, with `app_edit_mode_required` (403). The frame cannot forge the
  mode: it has no session of its own and reaches the server only through
  the host bridge, which reads the mode from Studio's own state. A capability
  token carries the mode of the frame call that started the backend, so a
  backend's writes need edit mode as the frame's do. `setElementValue` is
  unchanged, so existing apps keep working.
- **Attachments.** `studio.aas.putAttachment({submodelId, idShortPath,
  fileName, contentType, data, revision})` takes the bytes as an
  `ArrayBuffer` or typed array, up to 8 MiB. Studio's page sends them to
  `PUT /app-calls/attachment`, with the file as the body and the rest of the
  call in the query, as the signed-in user. That route runs the same
  authorization as `/app-calls` and the attachment route's checks: the
  deployment's upload switch (`STUDIO_ALLOW_UPLOADS`), its upload limit and a
  plain media type. Backends cannot call it: they have no bytes on Studio's
  page.
- **Findings and sync.** AAS Core findings fail a call with
  `validation_failed` and `violations`; conflicts are `structure_conflict`,
  `revision_conflict`, `idshort_conflict` and `identifier_conflict`. Writes
  over several resources return their `steps`; a failed registry or discovery
  step is reported and audited, not thrown, as in the editor.
- **Audit.** Every structural write and upload is a `target.write` (or
  `workspace.write`) record with the installation, the method and what it
  changed: identifiers, paths, file name, media type and size, never content.
- **Version.** These are new optional methods, so the app API becomes
  0.1.5 and the packages 0.1.3. `@basyx/studio-sdk/testing` refuses the
  methods outside edit mode as Studio does, and `memoryAas()` provides them
  over in-memory content for dev servers and tests.

## Consequences

- An app changes structure with the same guarantees as the editor: no lost
  update, verified content, registries in step and undo on workspaces.
- The edit-mode check is as strong as Studio's page: it stops apps that
  ignore `context.mode`, not a user who scripts Studio's page itself, who
  could use the editor's routes anyway.
- BaSyx Go keeps a File's content at its idShort path: an idShort change of
  the File or of a collection above it, through `putElement` as through the
  editor, drops the content (measured against the test environment). Apps
  rename files and folders by `displayName`, as the Web UI's FileSystem view
  does.
- Moving a File between folders reads and uploads its content again, so
  files above 8 MiB cannot be moved by an app; it is not atomic either.
- Each attachment is one request with the whole file; there is no
  streaming (MVP-7 *Later*).

## Alternatives considered

- **No server-side mode check:** the plan asks for it, and an app that writes
  in view mode surprises users who rely on the mode as a safety switch.
- **A server-side edit-mode session flag:** Studio's mode is per tab, so a
  flag per session would be wrong as soon as two tabs differ.
- **Base64 in the JSON call:** a third more bytes, and the JSON body limit
  would have to grow for every call.
- **A `moveElement` across parents:** the AAS API has no move, so it would be
  add and delete on the server, and attachments do not follow an element
  between paths on every server; the app's explicit steps make that visible.

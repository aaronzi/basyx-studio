# 0013: Revision tokens and conditional writes

- Status: Accepted
- Date: 2026-10-08
- Deciders: BaSyx Studio maintainers
- Refines: the revision model of [ADR 0003](0003-aas-targets-and-workspaces.md)
- Requirements: DATA-003, DATA-009, DATA-016, UX-005

## Context

Editing needs to detect concurrent changes (DATA-009) for live infrastructures
and desktop workspaces alike, behind one Studio API. BaSyx Go now supports
RFC 9110 conditional requests, but with one revision per top-level resource: a
change to any element of a submodel changes the `ETag` of all its elements.
Other AAS servers, and the AAS API specification, have no ETags yet.

## Decision

- The Studio API always uses `If-Match` with an opaque Studio revision token,
  returned as `ETag` and in the element detail (`revision`).
- The token is the hash of the element as Studio read it (`h.<hash>`), never
  the downstream `ETag`.
- A live write reads the element again, compares its hash with the token, and
  writes with `If-Match` on the fresh downstream `ETag` (`strong`). If the
  downstream answers 412 although the element still matches, another element
  of the submodel changed, and the write is retried (at most three attempts).
- Without a downstream `ETag`, the same comparison is all there is
  (`best_effort`); the element detail reports this and the UI explains it.
- Workspaces use the same token. Their worker checks and writes in one step, so
  they are `strong`.
- A write without `If-Match` is rejected with `precondition_required`; a
  mismatch with `revision_conflict`, which keeps the user's draft.

## Consequences

- Unrelated edits in the same submodel never conflict, while a concurrent
  change to the same element is always detected on servers with ETags.
- Every live write costs one extra read; the UI reads the element again after a
  write to show what the server stored.
- Feature code and apps see one revision model for every target.

## Alternatives considered

- **Forward the downstream `ETag` as the token:** every edit elsewhere in the
  submodel would make all open drafts conflict.
- **Workspace-wide revision counters:** the same problem inside a workspace.
- **No revision for servers without ETags:** silent lost updates.

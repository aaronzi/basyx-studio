# 0012: Release-age exceptions for Eclipse BaSyx packages

- Status: Accepted
- Date: 2026-10-08
- Deciders: BaSyx Studio maintainers
- Amends: the minimum-release-age rule of
  [ADR 0010](0010-pnpm-only-supply-chain.md)
- Requirements: ARCH-009, DATA-001

## Context

ADR 0010 delays every new package version by 24 hours
(`minimumReleaseAge: 1440`), so that compromised releases can be detected and
removed before Studio installs them. Studio develops features together with
other Eclipse BaSyx projects, especially `basyx-typescript-sdk`: a feature in
the SDK is often released for Studio on the same day. Waiting a day for every
coordinated change slows that work without much benefit, because the
maintainers review those changes anyway.

The delay protects against a compromised publish, though, and a package from
the same organization is not immune to that. The SDK is published from GitHub
Actions with npm provenance, which ties each version to a commit and workflow,
but it is still a remote package.

## Decision

A version of an Eclipse BaSyx package may skip the release-age delay when all of
these hold:

- the package is published by the Eclipse BaSyx project with npm provenance from
  its repository's release workflow;
- a Studio maintainer reviewed the release (its changes and its dependency
  changes) for the version in question;
- the exception names the **exact version** in `minimumReleaseAgeExclude` in
  `pnpm-workspace.yaml`, never a package name or a range.

Dependencies of an excepted package are not excepted; they keep the 24-hour
delay. An entry may be removed once its version is older than 24 hours.

## Consequences

- Coordinated changes with the SDK are usable in Studio on the day of the
  release.
- Each exception is visible in review as a one-line change and covers only the
  reviewed artifact; a later, unreviewed version still waits 24 hours.
- A compromised version that a maintainer approved within its first day is not
  caught by the delay. Review and provenance are the remaining controls.

## Alternatives considered

- **Exclude the package by name:** rejected because every future version,
  including an unreviewed or compromised one, would install immediately.
- **No exceptions:** keeps ADR 0010 unchanged, but delays every coordinated SDK
  change by a day.
- **Git or tarball dependencies on unreleased SDK code:** rejected because they
  bypass the registry, provenance, and `blockExoticSubdeps`.

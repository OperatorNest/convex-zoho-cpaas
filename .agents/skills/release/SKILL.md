---
name: release
description: Verify and publish an authorized package release.
---

# Release

Read CONTRIBUTING, workflows, changesets, package metadata, and CHANGELOG. Verify release notes against the public diff, then run `pnpm check`, `pnpm smoke`, and `pnpm audit --prod --audit-level high`; inspect the tarball. A maintainer versions through a PR. Publication requires explicit authorization. After publication, verify registry version, provenance, tag target, and release notes. Never move a published tag; report a failure at its stage.

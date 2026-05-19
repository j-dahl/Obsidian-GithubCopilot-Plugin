---
name: release-cut
description: Wrap the releaser agent's standard release preparation, versioning, validation, tagging, and release-note workflow.
---

# Release cut skill

Use this skill only when a maintainer has requested a release.

1. Invoke the `releaser` agent with the requested bump: patch, minor, or major.
2. Have it verify changelog, version files, clean git state, tests, lint, type-check, and build.
3. Have it run the appropriate `npm version <bump>` command only after approval.
4. Have it draft release notes from PRs and commits since the last tag.
5. Have it prepare push and workflow-monitoring instructions.
6. Do not push tags or publish artifacts without explicit human approval.

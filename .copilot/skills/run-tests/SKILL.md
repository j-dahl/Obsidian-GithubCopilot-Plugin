---
name: run-tests
description: Run `npm test`, print a concise summary, and surface failing test names plus diffs on failure.
---

# Run tests skill

Run from `D:\projects\Obsidian-GithubCopilot-Plugin`.

1. Execute `npm test`.
2. If tests pass, print the suite count, test count, and elapsed time when available.
3. If tests fail, extract failing test file names and individual failing test names.
4. Include assertion diffs or received/expected excerpts that explain the failure.
5. Suppress unrelated verbose output unless it is needed to diagnose the failure.
6. End with the smallest recommended next action.

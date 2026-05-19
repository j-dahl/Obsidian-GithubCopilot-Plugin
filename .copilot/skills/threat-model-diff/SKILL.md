---
name: threat-model-diff
description: Re-run the security-auditor agent against the diff since last commit on `docs/THREAT_MODEL.md` and output a brief delta.
---

# Threat model diff skill

Run from `D:\projects\Obsidian-GithubCopilot-Plugin`.

1. Inspect `git diff HEAD -- docs/THREAT_MODEL.md`.
2. If there is no diff, report that the threat model is unchanged.
3. Invoke the `security-auditor` agent with the diff and any related sensitive code changes.
4. Ask for a concise delta covering new threats, removed threats, changed mitigations, and residual risk.
5. Print the auditor's severity-ranked findings and recommended doc edits.
6. Do not modify the threat model unless the caller explicitly asks.

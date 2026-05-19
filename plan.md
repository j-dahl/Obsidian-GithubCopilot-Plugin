# Bootstrap plan

## Positioning

Two existing Obsidian community plugins already cover GitHub Copilot:

- `pierrad/obsidian-github-copilot` — inline Copilot completions and Copilot chat in a
  sidebar; no MCP, agent tool-calling, multi-backend support, audit log, or permission gate.
- `go2engle/obsidian-github-copilot-integration` — chat sidebar, inline edit,
  send-selection-to-chat, and action palette via local Copilot CLI; no MCP, multi-backend
  support, audit log, or permission gate.

This plugin is positioned as the agent-first option, not the first Copilot plugin. The
remaining differentiators are:

1. True agent stack: MCP, tool dispatch, five-button permission gate, JSONL audit log, and
   native vault tools.
2. Multi-backend support: GitHub Models, GitHub Copilot, Azure Foundry v1, and Azure OpenAI
   Classic.
3. Better auth UX: token discovery from environment, `gh auth token`, Copilot CLI keychain,
   VS Code Copilot files, then plugin device flow.
4. Security posture: default-deny presets, base64 untrusted-content envelopes,
   tool-description trigger-phrase suppression, and audit-log secret redaction.
5. Code quality: strict TypeScript, 142 Jest tests, GitHub Actions on Node 20 and 22, CodeQL,
   and Sigstore build provenance.

## Wave 1 (in progress / done)

- scaffold
- repo-hygiene
- ci
- providers
- mcp
- security
- settings
- chat
- readme
- threat-model
- custom-agents

## Wave 2 (queued)

- auth-system (waiting on OAuth app)
- integration-validate
- local-install
- review-gpt55
- review-opus47
- consensus-refactor

## Wave 3 (future)

- inline ghost-text completions
- additional backends (Anthropic direct, Bedrock)
- mobile-lite mode
- internationalization
- additional native tools

## Wave 4 (future)

- community plugin submission

## Deferred from review consensus

- Opus M-1 — DEFERRED: token-budget pruning requires a broader context-window budgeting design and provider-specific accounting; track for a dedicated performance/security pass.
- Opus M-5 — DEFERRED: requires UX and storage schema decisions outside the consensus security fixes.
- Opus M-6 — DEFERRED: requires broader architectural changes and migration planning beyond this pass.
- Opus L-1 — DEFERRED: low-risk cleanup not required to ship the blocker/high consensus fixes.
- Opus L-3 — DEFERRED: low-risk polish; no security impact in this pass.
- Opus L-5 — DEFERRED: low-risk documentation/UX follow-up.
- Opus L-7 — DEFERRED: low-risk cleanup reserved for a follow-up maintenance PR.

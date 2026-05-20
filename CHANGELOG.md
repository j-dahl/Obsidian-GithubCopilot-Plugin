# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- "How we compare" section in README with competitor matrix.
- Roadmap section in README.
- Styled chat view CSS for the conversation switcher, model picker, message bubbles, input row,
  tool cards, and consent modal controls.
- Inline model picker in the chat view.
- Playwright E2E smoke test infrastructure that launches Obsidian over CDP and screenshots the
  settings/chat flow for local self-validation.
- New Copilot token exchange path that targets `GET /copilot_internal/user` (the same endpoint the
  real `@github/copilot` CLI 1.0.49 uses) and treats the OAuth token directly as the CAPI bearer.
  The legacy `/copilot_internal/v2/token` JWT exchange is kept as a fallback when `/user` returns
  404 so older `ghu_` user-to-server tokens still work.
- Inline collapsible connection-failure block in Settings (`<details class="github-copilot-error-details">`)
  that surfaces the backend, model, endpoint, HTTP status, error code, token source/kind, response
  body, remediation, and action buttons (Copy as Markdown / Refresh gh scope / Sign in via device
  flow / Switch backend) so failures no longer hide behind a single-line "Copy details" notice.
- Playwright E2E test (`tests/e2e/copilot-error.spec.ts`) that exercises the new inline error block
  and screenshots the result.

### Changed

- Removed "first / unique / only" claims; we acknowledge
  `pierrad/obsidian-github-copilot` and
  `go2engle/obsidian-github-copilot-integration`.
- `GitHubCopilotProvider` now defaults `Copilot-Integration-Id` to `copilot-cli` (was `vscode-chat`),
  sets `Openai-Intent: conversation-agent`, and sends `X-GitHub-Api-Version: 2026-01-09` to mirror
  the wire format of the real Copilot CLI.
- `AuthError` carries the new `endpoint` and `tokenKind` fields so the settings UI and tests can
  pinpoint exactly which endpoint rejected which token kind.

### Fixed

- Settings sections now render independently so one section failure cannot hide the rest of the page.
- Chat view sizing is constrained to the Obsidian workspace leaf and message text is selectable.
- Native and MCP tool schemas now include explicit empty `properties` for strict OpenAI validation.
- Test connection now renders status in a dedicated inline element with immediate feedback.
- Chat requests now resolve GitHub tokens through the same discovery chain as Settings instead of
  sending a placeholder token.
- Test connection now shows a visible "Testing…" state and logs a DevTools trace when clicked.
- Password settings use runtime-safe `inputEl` properties instead of Obsidian type-only helpers.
- GitHub Copilot fallback models now match the current Copilot CLI picker list.
- Copilot session exchange failures include token source, HTTP status, and response body details.
- Chat input panel now keeps a non-collapsing minimum height inside the scoped chat view layout.
- Copilot connection failures with `gho_` tokens that previously surfaced as
  `session_token_exchange_failed: Failed to exchange GitHub token for a Copilot session token..`
  now succeed by hitting the same `/copilot_internal/user` endpoint the official CLI uses.
  When they do fail, the user gets a structured inline error block with the exact endpoint, status,
  response body, and one-click recovery actions instead of an opaque "Copy details" button.

### Security

- Require explicit enablement before discovered MCP servers are started, and show the command/URL
  being approved.
- Preserve MCP tool annotations through permission checks and saved audit decisions.
- Redact token-like secret values in audit logs and honor audit enablement, path, max-size, and
  preset settings.
- Base64-wrap untrusted note content and tool results; suppress suspicious MCP tool descriptions.
- Validate Azure and MCP HTTP endpoints, rejecting remote non-HTTPS URLs and embedded credentials.
- Persist allow-forever decisions, remember allow-session decisions, and enforce saved tool
  policies in the permission gate.
- Move recoverable note deletion to trash, add vault-relative path validation, and avoid full-vault
  content scans unless deep search is requested.
- Move OAuth/model caches outside the vault and wire device-flow sign-in to save the returned token.

- Require explicit enablement before discovered MCP servers are started, and show the command/URL
  being approved.
- Preserve MCP tool annotations through permission checks and saved audit decisions.
- Redact token-like secret values in audit logs and honor audit enablement, path, max-size, and
  preset settings.
- Base64-wrap untrusted note content and tool results; suppress suspicious MCP tool descriptions.
- Validate Azure and MCP HTTP endpoints, rejecting remote non-HTTPS URLs and embedded credentials.
- Persist allow-forever decisions, remember allow-session decisions, and enforce saved tool
  policies in the permission gate.
- Move recoverable note deletion to trash, add vault-relative path validation, and avoid full-vault
  content scans unless deep search is requested.
- Move OAuth/model caches outside the vault and wire device-flow sign-in to save the returned token.

## [0.1.0] - 2026-MM-DD

### Added

- Initial scaffolding.

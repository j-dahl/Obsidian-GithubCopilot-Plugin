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

### Changed

- Removed "first / unique / only" claims; we acknowledge
  `pierrad/obsidian-github-copilot` and
  `go2engle/obsidian-github-copilot-integration`.

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

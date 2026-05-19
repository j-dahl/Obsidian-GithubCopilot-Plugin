# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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

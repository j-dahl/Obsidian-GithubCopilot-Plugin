# Local testing guide

The plugin lives at `D:\projects\Obsidian-GithubCopilot-Plugin` and is wired into your test vault at `C:\Users\jordand\Obsidian-Test-Vault` via a directory junction. Hot-Reload is installed.

> ⚠️ `Ctrl+R` in Obsidian reloads the EDITOR PANE only, not plugins.
> Pick up new builds by either:
>
> - Settings → Community Plugins → toggle the plugin off + on, OR
> - Cmd/Ctrl+P → "Reload app without saving", OR
> - Use Hot-Reload plugin (already installed) — auto-fires on `main.js` changes

This guide gets you from "plugin folder exists" to "plugin works end-to-end" in 10 steps.

---

## Vault + plugin layout

```
C:\Users\jordand\Obsidian-Test-Vault\
├── .obsidian\
│   ├── community-plugins.json   # ["hot-reload", "github-copilot-agent"]
│   └── plugins\
│       ├── github-copilot-agent\   ← junction → D:\projects\Obsidian-GithubCopilot-Plugin
│       └── hot-reload\              ← pjeby/hot-reload (manual install)
└── README.md
```

If you ever need to recreate the junction:

```powershell
cmd /c mklink /J "C:\Users\jordand\Obsidian-Test-Vault\.obsidian\plugins\github-copilot-agent" "D:\projects\Obsidian-GithubCopilot-Plugin"
```

Reinstall Hot-Reload:

```powershell
$dest = "C:\Users\jordand\Obsidian-Test-Vault\.obsidian\plugins\hot-reload"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Invoke-WebRequest "https://raw.githubusercontent.com/pjeby/hot-reload/master/main.js"      -OutFile "$dest\main.js"
Invoke-WebRequest "https://raw.githubusercontent.com/pjeby/hot-reload/master/manifest.json" -OutFile "$dest\manifest.json"
```

Touch the trigger so Hot-Reload watches our plugin (one-time):

```powershell
New-Item -ItemType File -Path "D:\projects\Obsidian-GithubCopilot-Plugin\.hotreload" -Force | Out-Null
```

---

## Dev loop

```powershell
cd D:\projects\Obsidian-GithubCopilot-Plugin
npm run dev          # esbuild watch — writes main.js on every save
```

Edit any `src/**/*.ts`, save, and Hot-Reload will toggle the plugin off/on within ~1 s.

For a production build:

```powershell
npm run build        # tsc --noEmit + esbuild production
```

---

## Automated Obsidian E2E smoke test

Agents can now self-verify the critical UI flow locally instead of relying on user screenshots.
The Playwright test launches the installed Obsidian Electron app with Chrome DevTools Protocol,
opens the test vault, checks the plugin settings, opens chat, verifies the input box has a real
height, sends a smoke message, and saves a screenshot.

```powershell
cd D:\projects\Obsidian-GithubCopilot-Plugin
npm run build
$env:OBSIDIAN_EXE_AVAILABLE = "1"
npm run test:e2e
```

Useful overrides:

```powershell
$env:OBSIDIAN_EXE = "C:\Users\jordand\AppData\Local\Obsidian\Obsidian.exe"
$env:OBSIDIAN_TEST_VAULT = "C:\Users\jordand\Obsidian-Test-Vault"
```

Screenshots are written to `tests\e2e\__screenshots__\smoke.png`. CI skips this test unless
`OBSIDIAN_EXE_AVAILABLE=1` is set, because hosted runners do not have Obsidian installed.

If CDP does not open on port 9222, close all Obsidian windows and retry. The launcher sets
`ELECTRON_ENABLE_LOGGING=1`; if an Electron build blocks remote debugging, use headed/manual smoke
testing from the checklist below until the app is launched with debugging enabled.

---

## 10-step smoke test

Run this list after every meaningful change to make sure nothing regressed.

1. **Plugin loads.** Open Obsidian → switch to the test vault. On first launch you'll see a Notice "GitHub Copilot Agent loaded". If you see "Plugin failed to load", open DevTools (`Ctrl+Shift+I` → Console) and inspect the stack.
2. **Settings panel renders.** `Ctrl+,` → scroll the left pane to "GitHub Copilot Agent". You should see 8 sections: Backend / Model / Security preset / Built-in capabilities / MCP servers / Trusted content / Audit log / Diagnostics.
3. **Diagnostics show the token source.** Bottom section — "Detected token source" should read one of `env:GH_TOKEN`, `gh:auth-token`, `copilot-cli:cred-manager:...`, or `copilot-file:...`. If it reads "none — sign in required", run "GitHub Copilot Agent: Sign in via device flow" from the command palette.
4. **Catalog populates.** Backend = "GitHub Models" → Model dropdown should show ~40 entries grouped by publisher (OpenAI / Meta / Microsoft / DeepSeek / Mistral / Cohere / xAI / AI21). Pick `openai/gpt-4.1`.
5. **Test connection.** Click the "Test connection" button under the Backend section. Expected: green check "✅ Connected to <model>". For GitHub Copilot, the Model dropdown should include the current Copilot CLI picker list (`auto`, Claude Sonnet/Opus/Haiku, GPT-5.x, GPT-4.1, GPT-4o). On failure, the settings now render an inline **`<details>` block** ("Connection failed: HTTP …") showing backend, model, endpoint, HTTP status, error code, token source/kind, response body, remediation, and quick-action buttons (Copy as Markdown / Refresh gh scope / Sign in via device flow / Switch backend). No more hidden "Copy details" copy-into-clipboard step.
6. **Open the chat view.** Click the ribbon icon (bot) or `Ctrl+P` → "GitHub Copilot Agent: Open Chat". A right-leaf panel opens with a conversation switcher, inline model picker, styled message list, and input bar. If Test connection appears inert, open DevTools (`Ctrl+Shift+I`) and look for `[github-copilot-agent] Test connection clicked`.
7. **Plain chat works.** Type `Say hello in one sentence` → `Ctrl+Enter`. You should see a streaming token-by-token response. A new entry appears in the conversation switcher.
8. **Tool call with consent works.** Open any markdown note in the main pane. Then in chat ask: `Read the file I have open and tell me its first sentence.` → A consent modal pops asking to call `obsidian-native__read_active_file` (badge: 🔒 read-only). Click "Allow once". The agent re-streams using the file's contents.
9. **Audit log captured the call.** Open the "GitHub Copilot Agent: Open Activity" command or click the second ribbon icon. The right-leaf "Agent Activity" panel shows one row: timestamp · `obsidian-native:read_active_file` · ✅ allowed · click to expand args + first 200 chars of result. The same data lives in `<vault>\.obsidian\plugins\github-copilot-agent\audit.jsonl` (look at it raw to verify JSONL format + secret redaction).
10. **Hot-reload cycle.** Edit `src/main.ts` — change the load `new Notice("GitHub Copilot Agent loaded")` to `new Notice("GitHub Copilot Agent loaded (dev)")`. Save. Within 1 s you should see the new Notice text fire. Revert the change before committing.

---

## Optional: MCP smoke test

If you have any of the supported editors installed with MCP servers configured (VS Code `.vscode/mcp.json`, Cursor `~/.cursor/mcp.json`, Windsurf, Claude Desktop, Zed, or Copilot CLI `~/.copilot/mcp-config.json`), settings → MCP servers will list them as **Discovered (disabled)** rows. Click "Enable" on one — the plugin spawns the process (or connects to the HTTP endpoint) and the tools become available in chat with prefix `<servername>__<toolname>`. Each call is gated by the same consent UX.

Two safe options to play with:

- **Excalidraw (hosted, HTTP):** add `{"mcpServers": {"excalidraw": {"url": "https://mcp.excalidraw.com"}}}` to `~/.copilot/mcp-config.json` and enable in settings. Ask the agent: "draw a 3-node architecture diagram of frontend, backend, database".
- **GitHub MCP (hosted, HTTP):** `{"mcpServers": {"github": {"url": "https://api.githubcopilot.com/mcp"}}}` then ask: "list my open pull requests".

---

## Troubleshooting

| Symptom                                                        | Likely cause + fix                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Plugin failed to load"                                        | DevTools console for the stack. Most often a missing dep — `npm install` and re-run `npm run build`.                                                                                                                                                                       |
| Diagnostics shows "none" but `gh auth status` is logged in     | The plugin's child process can't find `gh.exe` on PATH. Reopen Obsidian after a fresh PowerShell session, or set `GH_TOKEN` env var as a workaround.                                                                                                                       |
| Diagnostics shows "none" but the Copilot CLI works in terminal | Windows: the Copilot CLI now stores tokens in **Credential Manager** under target `copilot-cli/https://github.com:<account>`, not in `~/.copilot/settings.json`. The plugin reads cred manager natively — confirm with `cmdkey /list:copilot-cli/*` that the entry exists. |
| "Test connection" returns 401                                  | The detected token doesn't have `models:read` (GitHub Models) or `copilot` scope (Copilot API). Re-run device flow or `gh auth refresh -s models:read,copilot`.                                                                                                            |
| Settings tab is blank                                          | A render error. DevTools → Console. Most often a missing import in a settings section — look for the first stack frame in `src/settings/`.                                                                                                                                 |
| Hot-Reload doesn't react                                       | Ensure both `.hotreload` exists in the plugin dir AND the Hot-Reload plugin is enabled. Restart Obsidian once; thereafter Hot-Reload picks up every change.                                                                                                                |
| Consent prompt doesn't appear                                  | You may be on "Trusted Workspace" preset which auto-allows read-only tools. Switch to "Balanced" or "Strict" to verify the gate fires.                                                                                                                                     |
| Audit log file empty                                           | The "Enable audit log" toggle in Settings is off — flip it on.                                                                                                                                                                                                             |
| Symlink/junction not picked up                                 | Obsidian needs a _restart_ (not just plugin reload) after a new symlink/junction is created. Close and reopen Obsidian.                                                                                                                                                    |

If you change `manifest.json` (e.g., bump `version` or `minAppVersion`), Hot-Reload cannot help — restart Obsidian fully.

---

## Useful files inside the plugin folder

- `main.js` — the bundled output Obsidian loads.
- `data.json` — runtime settings (Obsidian creates this on first save).
- `.hotreload` — empty trigger file that marks us as hot-reloadable.
- `audit.jsonl` — append-only tool-call log (rotation at the configured size).
- `.oauth-client-id.txt` — your registered OAuth app's Client ID; embedded into `main.js` at build time. Gitignored.

---

## Where to look next

- `docs/THREAT_MODEL.md` — STRIDE threats + mitigations per file path.
- `.copilot/agents/orchestrator.md` — how to drive further changes via the same fleet-mode pattern that built this plugin.
- `plan.md` — roadmap + deferred review findings.
- `CHANGELOG.md` — what changed when.

## Copilot exchange protocol (reverse-engineered)

The plugin's GitHub Copilot backend mirrors the real `@github/copilot` CLI (v1.0.49, app bundle at
`%LOCALAPPDATA%\copilot\pkg\universal\1.0.49-1\app.js`) instead of the legacy VS Code Copilot Chat
flow. Two endpoints, no JWT exchange for `gho_` tokens:

### Step 1 — discover the CAPI base URL (cached ~25 min)

`GET https://api.github.com/copilot_internal/user` with headers:

| Header                   | Value                              |
| ------------------------ | ---------------------------------- |
| `Authorization`          | `Bearer <gho_…>` (NOT `token <…>`) |
| `Accept`                 | `application/json`                 |
| `User-Agent`             | `GitHubCopilotCli/1.0.49`          |
| `Editor-Version`         | `copilot-cli/1.0.49`               |
| `Copilot-Integration-Id` | `copilot-cli`                      |
| `X-GitHub-Api-Version`   | `2026-01-09`                       |

Successful response: `{ login, copilot_plan, access_type_sku, chat_enabled, endpoints: { api, proxy, telemetry, … } }`.
The `endpoints.api` value is the CAPI base URL (e.g.
`https://api.enterprise.githubcopilot.com` for Copilot Enterprise tenants,
`https://api.githubcopilot.com` for Individual/Business).

### Step 2 — call chat completions with the SAME OAuth token

`POST ${endpoints.api}/chat/completions` with the same Bearer token, plus
`Copilot-Integration-Id`, `Editor-Version`, `X-GitHub-Api-Version`, and
`Openai-Intent: conversation-agent`. **No** call to `/copilot_internal/v2/token` is required
for `gho_` tokens issued by the new CLI.

### Legacy fallback

If `/copilot_internal/user` returns 404 (e.g. older `ghu_` user-to-server tokens from the
VS Code extension), the plugin falls back to the historical
`GET /copilot_internal/v2/token` JWT exchange path and uses the returned short-lived JWT instead.

### Common failure modes

| Status                                                     | What it usually means                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401 on `/copilot_internal/user`                            | OAuth token has `repo` but no `copilot` scope, or token was revoked. Click **Refresh gh scope** or **Sign in via device flow** in the inline error block. |
| 404 on `/copilot_internal/user` and 404 on `/v2/token`     | Account does not have an active Copilot license (any tier).                                                                                               |
| 200 on `/copilot_internal/user` with `chat_enabled: false` | License exists but chat is disabled — contact your org admin.                                                                                             |
| Network error / timeout                                    | Corporate proxy or firewall is blocking `api.github.com` or the CAPI host. Check ``.                                                                      |

The error code returned by the plugin (`session_token_exchange_failed` vs `copilot_scope_missing`
vs `session_token_unavailable`) plus the inline `Endpoint` and `HTTP status` fields tell you
exactly which step failed.

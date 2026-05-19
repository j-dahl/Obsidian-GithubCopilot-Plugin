# Local testing guide

The plugin lives at `D:\projects\Obsidian-GithubCopilot-Plugin` and is wired into your test vault at `C:\Users\jordand\Obsidian-Test-Vault` via a directory junction. Hot-Reload is installed.

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

## 10-step smoke test

Run this list after every meaningful change to make sure nothing regressed.

1. **Plugin loads.** Open Obsidian → switch to the test vault. On first launch you'll see a Notice "GitHub Copilot Agent loaded". If you see "Plugin failed to load", open DevTools (`Ctrl+Shift+I` → Console) and inspect the stack.
2. **Settings panel renders.** `Ctrl+,` → scroll the left pane to "GitHub Copilot Agent". You should see 8 sections: Backend / Model / Security preset / Built-in capabilities / MCP servers / Trusted content / Audit log / Diagnostics.
3. **Diagnostics show the token source.** Bottom section — "Detected token source" should read one of `env:GH_TOKEN`, `gh:auth-token`, `copilot-cli:cred-manager:...`, or `copilot-file:...`. If it reads "none — sign in required", run "GitHub Copilot Agent: Sign in via device flow" from the command palette.
4. **Catalog populates.** Backend = "GitHub Models" → Model dropdown should show ~40 entries grouped by publisher (OpenAI / Meta / Microsoft / DeepSeek / Mistral / Cohere / xAI / AI21). Pick `openai/gpt-4.1`.
5. **Test connection.** Click the "Test connection" button under the Backend section. Expected: green check "✅ Connected to <model>". On failure the panel shows the exact HTTP status + a hint.
6. **Open the chat view.** Click the ribbon icon (bot) or `Ctrl+P` → "GitHub Copilot Agent: Open Chat". A right-leaf panel opens with a conversation switcher, message list, and input bar.
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

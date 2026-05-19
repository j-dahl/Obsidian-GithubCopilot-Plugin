# Local testing with an Obsidian test vault

This machine is wired for local development against this vault:

- Vault: `C:\Users\jordand\Obsidian-Test-Vault`
- Plugin install path: `C:\Users\jordand\Obsidian-Test-Vault\.obsidian\plugins\github-copilot-agent`
- Source path: `D:\projects\Obsidian-GithubCopilot-Plugin`
- Install method: junction from the vault plugin folder to the source repo. If symlinks are unavailable, a junction still lets Obsidian load the freshly built `main.js` from the repo.

## What was installed

1. Created `C:\Users\jordand\Obsidian-Test-Vault` with an empty `.obsidian` folder and a vault `README.md`.
2. Created `.obsidian\plugins`.
3. Linked `.obsidian\plugins\github-copilot-agent` to `D:\projects\Obsidian-GithubCopilot-Plugin`.
4. Installed Hot-Reload in `.obsidian\plugins\hot-reload` with `main.js` and `manifest.json`.
5. Created `.hotreload` in the plugin folder, which resolves to the source repo because of the junction. `.hotreload` is ignored by git.
6. Wrote `.obsidian\community-plugins.json` with:

```json
["hot-reload", "github-copilot-agent"]
```

## First launch walkthrough

1. Open Obsidian.
2. Select **Open folder as vault** and choose `C:\Users\jordand\Obsidian-Test-Vault`.
3. Open **Settings → Community plugins**.
4. If this is the first time for the vault, select **Turn on community plugins**.
5. Confirm **Hot Reload** and **GitHub Copilot Agent** appear in the installed plugins list.
6. Enable **Hot Reload** first.
7. Enable **GitHub Copilot Agent**.
8. Open **Settings → GitHub Copilot Agent** and confirm the settings panel renders.

## Smoke test

1. Enable the plugin and confirm a **GitHub Copilot Agent loaded** Notice appears.
2. Open **Settings → GitHub Copilot Agent** and confirm diagnostics show `gh:auth-token` detected.
3. Pick a model from the catalog dropdown.
4. Open chat with the ribbon icon or **Command palette → GitHub Copilot Agent: Open Chat**.
5. Type `hello` and confirm a streaming response appears.
6. Open any note, then type `read the file I have open and tell me its first sentence`. Confirm the consent prompt appears for `obsidian-native__read_active_file`, select **Allow once**, and confirm the response uses the file content.
7. Switch preset **Balanced → Strict**, ask the same question, and confirm `read_active_file` still auto-allows while other operations require consent.
8. Open the **Agent Activity** panel from the ribbon or command palette and confirm the audit log entry exists.
9. Edit `src\main.ts` with a trivial Notice-message change, save, run `npm run build`, and confirm the Hot-Reload toast appears and the **GitHub Copilot Agent loaded** Notice fires again.
10. Disable the plugin, re-enable it, and confirm there are no errors in the developer console.

## Troubleshooting

- **Symlink or junction not picked up:** Restart Obsidian. A plugin reload is not always enough for new plugin folders.
- **`gh auth token` returns nothing:** Run `gh auth status`, then authenticate with `gh auth login` if needed.
- **Blank settings panel:** Open Obsidian developer tools and check the console for errors.
- **Hot-Reload does not fire:** Confirm `.hotreload` exists at `D:\projects\Obsidian-GithubCopilot-Plugin\.hotreload`, rebuild with `npm run build`, then restart Obsidian if needed.

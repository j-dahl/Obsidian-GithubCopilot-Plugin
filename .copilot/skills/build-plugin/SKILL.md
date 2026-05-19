---
name: build-plugin
description: Run `npm run build` then reload the plugin in Obsidian via hot-reload trigger file.
---

# Build plugin skill

Run this skill from `D:\projects\Obsidian-GithubCopilot-Plugin`.

1. Run `npm run build` and stop on failure.
2. Read the optional JSON config at `~/.copilot/skill-config.json`.
3. Look for key `obsidianTestVault`.
4. If the key exists, run:
   ```powershell
   Set-Content -Path "<vault>/.obsidian/plugins/github-copilot-agent/.hotreload" -Value ""
   ```
5. If the key is missing, print that the build succeeded but hot reload was skipped.

Report the build result, emitted artifacts if obvious, and whether Obsidian was nudged to reload.

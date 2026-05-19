# Local testing

1. Run `npm install`.
2. Run `npm run build`.
3. Copy `main.js`, `manifest.json`, and `styles.css` to the test vault plugin folder.
4. Reload Obsidian and enable the plugin.
5. Open plugin settings and select **Test connection**. Expected success: `✅ Connected to <model> (<HTTP-status> in <ms>)`; GitHub Models also shows the detected token source. If it fails, use the message directly: refresh missing scopes with `gh auth refresh -s models:read,copilot`, opt in to GitHub Models at github.com/settings/billing/models for 403s, verify `publisher/name` model ids for 404s, wait or upgrade for 429s, and check proxy/firewall/cert settings for network errors.

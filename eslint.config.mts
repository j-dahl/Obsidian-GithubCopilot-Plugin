import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        AsyncIterable: "readonly",
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mts",
            "manifest.json",
            "commitlint.config.ts",
            "playwright.config.ts",
            "tests/e2e/launch.ts",
            "tests/e2e/smoke.spec.ts",
            "tests/e2e/copilot-error.spec.ts",
            "tests/settings/SettingsTab.test.ts",
            "tests/settings/obsidianMock.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  globalIgnores([
    "node_modules",
    "dist",
    "esbuild.config.mjs",
    "eslint.config.js",
    "version-bump.mjs",
    "versions.json",
    "main.js",
  ])
);

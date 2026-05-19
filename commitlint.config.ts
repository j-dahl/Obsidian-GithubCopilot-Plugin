export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "auth",
        "providers",
        "mcp",
        "security",
        "settings",
        "chat",
        "ui",
        "util",
        "ci",
        "deps",
        "release",
        "docs",
        "agents",
      ],
    ],
  },
};

import { DEFAULT_SETTINGS } from "../../src/settings";

describe("DEFAULT_SETTINGS", () => {
it("matches the Balanced security preset", () => {
expect(DEFAULT_SETTINGS).toMatchObject({
preset: "balanced",
allowReadActiveFile: true,
allowReadVaultFiles: false,
allowReadExternalFiles: false,
allowWriteVaultFiles: false,
allowWriteExternalFiles: false,
allowEnvVarAccess: false,
allowNetworkEgress: false,
blockDestructiveTools: true,
requireConsentForOpenWorld: true,
auditLogEnabled: true,
auditLogMaxSizeMb: 10,
streamResponses: true,
});
});
});
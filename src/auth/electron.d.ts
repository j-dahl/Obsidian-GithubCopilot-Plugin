declare module "electron" {
  export const safeStorage:
    | {
        isEncryptionAvailable(): boolean;
        encryptString(value: string): import("node:buffer").Buffer;
        decryptString?(buffer: import("node:buffer").Buffer): string;
      }
    | undefined;
}

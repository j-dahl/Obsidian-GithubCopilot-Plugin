export function validateVaultRelativePath(value: string): string {
if (/^[A-Z]:/i.test(value) || value.startsWith('/') || value.startsWith('\\') || value.startsWith('~') || value.startsWith('\\\\')) {
throw new Error('Path must be vault-relative.');
}
const normalized = value.replace(/\\/g, '/').split('/').filter((part) => part.length > 0).join('/');
if (normalized.split('/').includes('..')) throw new Error('Path traversal is not allowed.');
return normalized;
}

import type { TFile } from 'obsidian';
import type { TrustedContentSettings } from './types';

const MAX_CONTENT_CHARS = 50_000;

type FrontmatterCarrier = TFile & { frontmatter?: Record<string, unknown> };

function isTrustedPath(path: string, folders: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  return folders.some((folder) => {
    const normalizedFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function capContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_CONTENT_CHARS)}\n[Content truncated at 50,000 characters]`;
}

export function wrapForLlm(content: string, source: TFile | null, settings: TrustedContentSettings): string {
  const capped = capContent(content);
  if (source === null) {
    return capped;
  }

  const carrier = source as FrontmatterCarrier;
  const frontmatterTrusted = carrier.frontmatter?.[settings.trustedFrontmatterKey] === true;
  if (frontmatterTrusted || isTrustedPath(source.path, settings.trustedFolders)) {
    return capped;
  }

  return `<untrusted source="${escapeAttribute(source.path)}">\n${capped}\n</untrusted>`;
}

export const TRUSTED_CONTENT_MAX_CHARS = MAX_CONTENT_CHARS;
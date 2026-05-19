import type { TFile } from 'obsidian';
import { Buffer } from 'node:buffer';
import * as nodePath from 'node:path';
import type { TrustedContentSettings } from './types';

const MAX_CONTENT_CHARS = 50_000;

type FrontmatterCarrier = TFile & { frontmatter?: Record<string, unknown> };

function isTrustedPath(path: string, folders: string[]): boolean {
  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return false;
  return folders.some((folder) => {
    const normalizedFolder = normalizeVaultPath(folder)?.replace(/\/+$/, '');
    if (!normalizedFolder) return false;
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
  });
}

function normalizeVaultPath(value: string): string | null {
  const normalized = nodePath.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
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

  return `<untrusted source="${escapeAttribute(source.path)}" encoding="base64">${Buffer.from(capped, 'utf8').toString('base64')}</untrusted>`;
}

export const TRUSTED_CONTENT_MAX_CHARS = MAX_CONTENT_CHARS;

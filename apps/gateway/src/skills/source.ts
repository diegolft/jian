import { GatewayError } from '../core/errors.js';

/**
 * Only GitHub is resolvable without a git client, and the image ships none. Every other host
 * is refused by name instead of failing later with a confusing 404.
 */
const GITHUB_PAGE =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/;
const GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([^/]+)\/(.*)$/;

export type Source = {
  owner: string;
  repository: string;
  ref: string;
  path: string;
};

export function parseSource(url: string): Source {
  const raw = GITHUB_RAW.exec(url);

  if (raw) {
    return {
      owner: raw[1] as string,
      repository: raw[2] as string,
      ref: raw[3] as string,
      path: raw[4] as string,
    };
  }

  const page = GITHUB_PAGE.exec(url);

  if (!page) {
    throw new GatewayError(
      400,
      'Import a skill from a GitHub repository URL; other hosts are not supported',
    );
  }

  return {
    owner: page[1] as string,
    repository: page[2] as string,
    // A repository root URL carries no ref; HEAD is what a browser would have shown.
    ref: page[3] ?? 'HEAD',
    path: (page[4] ?? '').replace(/\/$/, ''),
  };
}

export function rawUrl(source: Source, path = source.path): string {
  const suffix = path ? `/${path}` : '';

  return `https://raw.githubusercontent.com/${source.owner}/${source.repository}/${source.ref}${suffix}`;
}

export function pageUrl(source: Source, path = source.path): string {
  const suffix = path ? `/tree/${source.ref}/${path}` : '';

  return `https://github.com/${source.owner}/${source.repository}${suffix}`;
}

/** Lists one directory. Unauthenticated GitHub allows 60 of these per hour per address. */
export function contentsUrl(source: Source, path: string): string {
  return `https://api.github.com/repos/${source.owner}/${source.repository}/contents/${path}?ref=${encodeURIComponent(source.ref)}`;
}

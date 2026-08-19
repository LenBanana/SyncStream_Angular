import { environment } from '../../environments/environment';

/**
 * Where the API lives, as seen from this page.
 *
 * The session is an HttpOnly cookie, and the browser only sends it if the API is *same-site* with the
 * page. Site means registrable domain, so `dreckbu.de` talking to `sync.dreckbu.de` qualifies while
 * `drecktu.be` talking to `sync.dreckbu.de` does not: that would need `SameSite=None`, which gives up
 * the CSRF protection and leans on third-party cookies browsers are actively restricting.
 *
 * So the origin is derived from whichever domain served the page rather than hardcoded.
 *
 * DEPLOYMENT REQUIREMENT: every domain the front end is served from needs an API host under its own
 * registrable domain. Serving the app on `drecktu.be` requires `sync.drecktu.be` to resolve and proxy
 * to the API, exactly as `sync.dreckbu.de` does.
 */
export function resolveApiBaseUrl(): string {
  if (environment.apiUrlOverride) {
    return withTrailingSlash(environment.apiUrlOverride);
  }

  const { protocol, hostname, port } = window.location;
  const suffix = port ? `:${port}` : '';
  return withTrailingSlash(`${protocol}//${apiHostFor(hostname)}${suffix}`);
}

function apiHostFor(hostname: string): string {
  const bare = hostname.replace(/^www\./i, '');

  // Already on the API host, which is the case when the API serves the app itself.
  if (bare.startsWith('api.') || bare.startsWith('sync.')) {
    return bare;
  }

  // No sub-domain to add for a bare host such as localhost or an IP literal.
  if (!bare.includes('.')) {
    return bare;
  }

  return `sync.${bare}`;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/** Whether a request URL is aimed at our own API, and therefore should carry the session cookie. */
export function isApiUrl(url: string): boolean {
  const base = resolveApiBaseUrl();
  return url.startsWith(base) || url.startsWith('/');
}

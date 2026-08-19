export const environment = {
  production: true,

  /**
   * Null so the API origin is derived from the page's own hostname, keeping the session cookie
   * same-site. Set it only to pin every front-end domain to one API host, which costs you the
   * SameSite=Lax protection on any domain that does not match.
   */
  apiUrlOverride: null as string | null
};

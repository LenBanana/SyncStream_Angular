// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,

  /**
   * Same-origin in development, via the dev-server proxy in proxy.conf.json.
   *
   * This is not a convenience. The session is a SameSite=Lax cookie, and under schemeful same-site
   * `http://localhost:4200` and `https://localhost:44371` count as different sites, so the cookie would be
   * set on login and then never sent again: signing in would appear to work and every following request
   * would be anonymous. Going through the proxy makes the API same-origin, which sidesteps scheme, port
   * and CORS entirely.
   *
   * Change the target in proxy.conf.json if the API runs somewhere other than
   * https://localhost:44371.
   */
  apiUrlOverride: '/' as string | null
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.

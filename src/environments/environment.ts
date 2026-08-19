// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,

  /**
   * Explicit API origin. In development the page and the API sit on different ports, which is still
   * same-site for cookie purposes because SameSite ignores the port.
   *
   * Leave this null in production so the origin is derived from the page's own hostname. See
   * `src/app/core/api-origin.ts` for why that matters.
   */
  apiUrlOverride: 'https://localhost:44371/' as string | null
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.

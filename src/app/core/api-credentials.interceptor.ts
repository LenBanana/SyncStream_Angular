import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { isApiUrl } from './api-origin';

/**
 * Sends the session cookie with API requests.
 *
 * Cross-origin requests omit cookies unless asked, and the session moved into an HttpOnly cookie
 * precisely so no script has to hold the token. Setting it here rather than at each call site means a
 * new request cannot accidentally be made unauthenticated, and it is why endpoints no longer need a
 * `?token=` query parameter.
 */
@Injectable()
export class ApiCredentialsInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!request.withCredentials && isApiUrl(request.url)) {
      return next.handle(request.clone({ withCredentials: true }));
    }
    return next.handle(request);
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import {
  SponsorBlockCategory,
  SponsorBlockPolicy,
  SponsorBlockSegmentsResponse,
  defaultSponsorBlockSkipCategories,
  sponsorBlockCategoryOrder
} from '../../../Interfaces/SponsorBlock';
import { baseUrl } from '../../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class SponsorBlockService {
  /**
   * The categories the server skips.
   *
   * Seeded with the same defaults the server ships, so a player that starts before the policy arrives behaves
   * the same way it will afterwards rather than skipping nothing or everything for a moment.
   */
  private readonly policySubject = new BehaviorSubject<SponsorBlockPolicy>({
    skipCategories: [...defaultSponsorBlockSkipCategories],
    availableCategories: [...sponsorBlockCategoryOrder]
  });

  readonly policy: Observable<SponsorBlockPolicy> = this.policySubject.asObservable();

  constructor(private http: HttpClient) {
  }

  get skipCategories(): SponsorBlockCategory[] {
    return this.policySubject.value.skipCategories;
  }

  /** Fetches the policy. Readable without an account, because any client may be the host. */
  loadPolicy(): void {
    this.http.get<SponsorBlockPolicy>(`${baseUrl}api/sponsorblock/policy`)
      .pipe(catchError(() => of(this.policySubject.value)))
      .subscribe(policy => this.policySubject.next(this.normalise(policy)));
  }

  /** Sets the policy. Refused by the server unless the caller is an administrator. */
  savePolicy(skipCategories: SponsorBlockCategory[]): Observable<SponsorBlockPolicy> {
    return this.http.post<SponsorBlockPolicy>(`${baseUrl}api/sponsorblock/policy`, { skipCategories })
      .pipe(tap(policy => this.policySubject.next(this.normalise(policy))));
  }

  /** Keeps only categories this build knows, so a newer server cannot put an unknown one in the UI. */
  private normalise(policy: SponsorBlockPolicy): SponsorBlockPolicy {
    const known = (categories: SponsorBlockCategory[] | undefined) =>
      (categories ?? []).filter(category => sponsorBlockCategoryOrder.includes(category));

    return {
      skipCategories: known(policy?.skipCategories),
      availableCategories: known(policy?.availableCategories).length > 0
        ? known(policy.availableCategories)
        : [...sponsorBlockCategoryOrder]
    };
  }

  getSegments(videoId: string): Observable<SponsorBlockSegmentsResponse> {
    if (!videoId) {
      return of(this.emptyResponse(videoId));
    }
    const url = `${baseUrl}api/sponsorblock/segments?videoId=${encodeURIComponent(videoId)}`;
    return this.http.get<SponsorBlockSegmentsResponse>(url).pipe(
      catchError(() => of(this.emptyResponse(videoId)))
    );
  }

  private emptyResponse(videoId: string): SponsorBlockSegmentsResponse {
    return {
      videoId,
      fetchedAtUtc: new Date(0).toISOString(),
      segments: []
    };
  }
}
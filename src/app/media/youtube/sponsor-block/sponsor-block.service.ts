import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SponsorBlockSegmentsResponse } from '../../../Interfaces/SponsorBlock';
import { baseUrl } from '../../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class SponsorBlockService {
  constructor(private http: HttpClient) {
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
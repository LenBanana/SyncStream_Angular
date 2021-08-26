import { TestBed } from '@angular/core/testing';

import { BlackjackServiceService } from './blackjack-service.service';

describe('BlackjackServiceService', () => {
  let service: BlackjackServiceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BlackjackServiceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

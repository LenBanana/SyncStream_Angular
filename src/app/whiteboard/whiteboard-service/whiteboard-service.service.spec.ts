import { TestBed } from '@angular/core/testing';

import { WhiteboardServiceService } from './whiteboard-service.service';

describe('WhiteboardServiceService', () => {
  let service: WhiteboardServiceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WhiteboardServiceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

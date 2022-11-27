import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LiveStreamViewComponent } from './live-stream-view.component';

describe('LiveStreamViewComponent', () => {
  let component: LiveStreamViewComponent;
  let fixture: ComponentFixture<LiveStreamViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LiveStreamViewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LiveStreamViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LiveStreamDirectComponent } from './live-stream-direct.component';

describe('LiveStreamDirectComponent', () => {
  let component: LiveStreamDirectComponent;
  let fixture: ComponentFixture<LiveStreamDirectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LiveStreamDirectComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LiveStreamDirectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

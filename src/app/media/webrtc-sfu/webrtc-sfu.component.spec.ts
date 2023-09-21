import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WebrtcSfuComponent } from './webrtc-sfu.component';

describe('WebrtcSfuComponent', () => {
  let component: WebrtcSfuComponent;
  let fixture: ComponentFixture<WebrtcSfuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ WebrtcSfuComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WebrtcSfuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WebrtcVoipComponent } from './webrtc-voip.component';

describe('WebrtcVoipComponent', () => {
  let component: WebrtcVoipComponent;
  let fixture: ComponentFixture<WebrtcVoipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ WebrtcVoipComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WebrtcVoipComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

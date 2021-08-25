import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { BlackjackGameComponent } from './blackjack-game.component';

describe('BlackjackGameComponent', () => {
  let component: BlackjackGameComponent;
  let fixture: ComponentFixture<BlackjackGameComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ BlackjackGameComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(BlackjackGameComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

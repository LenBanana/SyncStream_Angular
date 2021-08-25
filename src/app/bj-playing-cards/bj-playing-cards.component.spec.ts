import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { BjPlayingCardsComponent } from './bj-playing-cards.component';

describe('BjPlayingCardsComponent', () => {
  let component: BjPlayingCardsComponent;
  let fixture: ComponentFixture<BjPlayingCardsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ BjPlayingCardsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(BjPlayingCardsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

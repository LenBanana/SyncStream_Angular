import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrowserResultModalComponent } from './browser-result-modal.component';

describe('BrowserResultModalComponent', () => {
  let component: BrowserResultModalComponent;
  let fixture: ComponentFixture<BrowserResultModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ BrowserResultModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BrowserResultModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DreckchatComponent } from './dreckchat.component';

describe('DreckchatComponent', () => {
  let component: DreckchatComponent;
  let fixture: ComponentFixture<DreckchatComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DreckchatComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DreckchatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

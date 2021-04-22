import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { UserSettingModalComponent } from './user-setting-modal.component';

describe('UserSettingModalComponent', () => {
  let component: UserSettingModalComponent;
  let fixture: ComponentFixture<UserSettingModalComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ UserSettingModalComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(UserSettingModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

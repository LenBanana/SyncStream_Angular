import { Component, EventEmitter, OnInit, Output } from '@angular/core';

@Component({
  selector: 'app-help-modal',
  templateUrl: './help-modal.component.html',
  styleUrls: ['./help-modal.component.scss']
})
export class HelpModalComponent implements OnInit {

  constructor() { }
  @Output() AddRoom = new EventEmitter();
  curP = 1;

  ngOnInit(): void {
  }

}

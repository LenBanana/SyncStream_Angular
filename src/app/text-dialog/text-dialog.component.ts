import { Component, EventEmitter, Input, OnInit, Output, ViewChild, ElementRef } from '@angular/core';
declare var $:any

@Component({
  selector: 'app-text-dialog',
  templateUrl: './text-dialog.component.html',
  styleUrls: ['./text-dialog.component.scss']
})
export class TextDialogComponent implements OnInit {
  @ViewChild('Title') title: ElementRef;
  @Input() Question: string;
  @Input() Header: string;
  @Input() Answer1: string;
  @Input() Answer2: string;
  @Input() AddInput: boolean;
  @Output() Yes = new EventEmitter();
  @Output() No = new EventEmitter();
  constructor() { }

  ngOnInit(): void {
    $('#dialogModal').modal('toggle');
  }

}

import { ThrowStmt } from '@angular/compiler';
import { Component, Input, OnChanges, OnInit } from '@angular/core';
import { CanvasWhiteboardComponent, CanvasWhiteboardOptions, CanvasWhiteboardService, CanvasWhiteboardUpdate } from 'ng2-canvas-whiteboard';
import { WhiteboardService } from './whiteboard-service/whiteboard-service.service';

@Component({
  selector: 'app-whiteboard',
  templateUrl: './whiteboard.component.html',
  styleUrls: ['./whiteboard.component.scss'],
  viewProviders: [CanvasWhiteboardComponent]
})
export class WhiteboardComponent implements OnInit, OnChanges {

  constructor(private _canvasWhiteboardService: CanvasWhiteboardService, private whiteBoardSerive: WhiteboardService) { }
  @Input() UniqueId: string = "bla0";
  IsDrawing = true;
  canvasOptions: CanvasWhiteboardOptions = {
    drawButtonEnabled: true,
    drawButtonClass: 'drawButtonClass',
    drawButtonText: 'Draw',
    clearButtonEnabled: true,
    clearButtonClass: 'clearButtonClass',
    clearButtonText: 'Clear',
    undoButtonText: 'Undo',
    undoButtonEnabled: true,
    colorPickerEnabled: true,
    shapeSelectorEnabled: false,
    lineWidth: 4,
    scaleFactor: 1
};

  ngOnChanges() {
    if (!this.IsDrawing) {
      this.canvasOptions.drawButtonEnabled = false;
      this.canvasOptions.clearButtonEnabled = false;
      this.canvasOptions.undoButtonEnabled = false;
    } else {
      this.canvasOptions.drawButtonEnabled = true;
      this.canvasOptions.clearButtonEnabled = true;
      this.canvasOptions.undoButtonEnabled = true;
    }
    console.log(this.canvasOptions);
  }

  ngOnInit(): void {
    this.whiteBoardSerive.addWhiteBoardListener();
    this.whiteBoardSerive.addWhiteBoardClearListener();
    this.whiteBoardSerive.addWhiteBoardUnDoListener();
    this.whiteBoardSerive.addWhiteBoardReDoListener();
    this.whiteBoardSerive.whiteboardUpdate.subscribe(update => {
      if (update==null||this.IsDrawing) {
        return;
      }
      const parsedStorageUpdates: Array<CanvasWhiteboardUpdate> = update;
      this._canvasWhiteboardService.drawCanvas(parsedStorageUpdates);
    });
    this.whiteBoardSerive.whiteboardClear.subscribe(clear => {
      if (this.IsDrawing) {
        return;
      }
      this._canvasWhiteboardService.clearCanvas();
    });
    this.whiteBoardSerive.whiteboardUndo.subscribe(undo => {
      if (undo==null||this.IsDrawing) {
        return;
      }
      console.log(undo);
      this._canvasWhiteboardService.undoCanvas(undo);
    });
    this.whiteBoardSerive.whiteboardRedo.subscribe(redo => {
      if (redo==null||this.IsDrawing) {
        return;
      }
      console.log(redo);
      this._canvasWhiteboardService.redoCanvas(redo);
    });
    
  }

  sendBatchUpdate(event) {
    this.whiteBoardSerive.updateWhiteBoard(event, this.UniqueId);
  }

  onCanvasClear() {
    this.whiteBoardSerive.clearWhiteBoard(this.UniqueId);
  }

  onCanvasUndo(event) {
    this.whiteBoardSerive.undoWhiteBoard(this.UniqueId, event);
  }

  onCanvasRedo(event) {
    this.whiteBoardSerive.redoWhiteBoard(this.UniqueId, event);
  }
}

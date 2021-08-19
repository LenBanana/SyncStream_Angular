import {
  ThrowStmt
} from '@angular/compiler';
import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit
} from '@angular/core';
import {
  CanvasWhiteboardComponent,
  CanvasWhiteboardOptions,
  CanvasWhiteboardService,
  CanvasWhiteboardUpdate
} from 'ng2-canvas-whiteboard';
import { Member } from '../Interfaces/Member';
import {
  WhiteboardService
} from './whiteboard-service/whiteboard-service.service';

@Component({
  selector: 'app-whiteboard',
  templateUrl: './whiteboard.component.html',
  styleUrls: ['./whiteboard.component.scss'],
  viewProviders: [CanvasWhiteboardComponent]
})
export class WhiteboardComponent implements OnInit, OnChanges, OnDestroy {

  constructor(private _canvasWhiteboardService: CanvasWhiteboardService, private whiteBoardSerive: WhiteboardService) {}
  @Input() UniqueId: string = "";
  @Input() IsDrawing = false;
  @Input() GallowWord = "";
  GallowMembers: Member[] = [];
  LastIsDrawing = null;
  Init = false;
  reload = false;
  RemainingGallowTime = 90;
  gallowGuess;
  gallowTimer;
  whiteboardJoin;
  whiteboardUpdate;
  whiteboardClear;
  whiteboardUndo;
  whiteboardRedo;
  canvasOptions: CanvasWhiteboardOptions = {
    drawButtonEnabled: true,
    drawButtonClass: 'fa fa-pencil fa-2x p-2',
    drawButtonText: '',
    clearButtonEnabled: true,
    clearButtonClass: 'fa fa-trash fa-2x p-2',
    clearButtonText: '',
    undoButtonText: 'Undo',
    undoButtonEnabled: false,
    redoButtonText: 'Redo',
    redoButtonEnabled: false,
    colorPickerEnabled: true,
    shapeSelectorEnabled: true,
    strokeColorPickerEnabled: true,
    fillColorPickerEnabled: true,
    drawingEnabled: this.IsDrawing,
    batchUpdateTimeoutDuration: 50,
    lineWidth: 4,
    scaleFactor: 1,
    startingColor: '#EEEEEE',
    strokeColor: '#333333',    
  };

  ngOnChanges() {
    if (!this.Init) {
      this.Init = true;
      this.whiteBoardSerive.getWhiteBoard(this.UniqueId);
    }
    if (this.LastIsDrawing!=this.IsDrawing) {
      console.log(this.IsDrawing);
      this.LastIsDrawing = this.IsDrawing;
      this.canvasOptions.drawingEnabled = this.IsDrawing;
      this.canvasOptions.drawButtonEnabled = this.IsDrawing;
      this.canvasOptions.clearButtonEnabled = this.IsDrawing;
      this.canvasOptions.shapeSelectorEnabled = this.IsDrawing;
      this.canvasOptions.fillColorPickerText = this.IsDrawing ? 'Fill' : '';
      this.canvasOptions.strokeColorPickerText = this.IsDrawing ? 'Stroke' : '';
      this.canvasOptions.strokeColor = this.IsDrawing ? '#333333' : 'transparent';
      this.reload = true;
      setTimeout(() => {
        this.reload = false;
      }, 1);
    }
  }

  ngOnInit(): void {
    this.whiteBoardSerive.addGallowUserListener();
    this.whiteBoardSerive.addGallowTimerListener();
    this.whiteBoardSerive.addWhiteBoardListener();
    this.whiteBoardSerive.addWhiteBoardJoinListener();
    this.whiteBoardSerive.addWhiteBoardClearListener();
    this.whiteBoardSerive.addWhiteBoardUnDoListener();
    this.whiteBoardSerive.addWhiteBoardReDoListener();
    this.gallowTimer = this.whiteBoardSerive.gallowTimer.subscribe(time => {
      if (time == null) {
        return;
      }
      this.RemainingGallowTime = time;
    });
    this.gallowGuess = this.whiteBoardSerive.gallowUser.subscribe(members => {
      if (members == null) {
        return;
      }
      this.GallowMembers = members;
    });
    this.whiteboardJoin = this.whiteBoardSerive.whiteboardJoin.subscribe(update => {
      if (update == null) {
        return;
      }
      const parsedStorageUpdates: Array < CanvasWhiteboardUpdate > = update;
      this._canvasWhiteboardService.drawCanvas(parsedStorageUpdates);
    });
    this.whiteboardUpdate = this.whiteBoardSerive.whiteboardUpdate.subscribe(update => {
      if (update == null) {
        return;
      }
      const parsedStorageUpdates: Array < CanvasWhiteboardUpdate > = update;
      this._canvasWhiteboardService.drawCanvas(parsedStorageUpdates);
    });
    this.whiteboardClear = this.whiteBoardSerive.whiteboardClear.subscribe(clear => {
      if (clear == null) {
        return;
      }
      this._canvasWhiteboardService.clearCanvas();
    });
    this.whiteboardUndo = this.whiteBoardSerive.whiteboardUndo.subscribe(undo => {
      if (undo == null) {
        return;
      }
      this._canvasWhiteboardService.undoCanvas(undo);
    });
    this.whiteboardRedo = this.whiteBoardSerive.whiteboardRedo.subscribe(redo => {
      if (redo == null) {
        return;
      }
      this._canvasWhiteboardService.redoCanvas(redo);
    });
  }

  ngOnDestroy() {
    this.gallowGuess.unsubscribe();
    this.gallowTimer.unsubscribe();
    this.whiteboardRedo.unsubscribe();
    this.whiteboardJoin.unsubscribe();
    this.whiteboardUpdate.unsubscribe();
    this.whiteboardClear.unsubscribe();
    this.whiteboardUndo.unsubscribe();
    this.whiteboardRedo.unsubscribe();
    this.whiteBoardSerive.removeGallowUserListener();
    this.whiteBoardSerive.removeGallowTimerListener();
    this.whiteBoardSerive.removeWhiteBoardListener();
    this.whiteBoardSerive.removeWhiteBoardJoinListener();
    this.whiteBoardSerive.removeWhiteBoardClearListener();
    this.whiteBoardSerive.removeWhiteBoardUnDoListener();
    this.whiteBoardSerive.removeWhiteBoardReDoListener();
  }

  getAnonWord() {
    var AnonWord = "";
    for (var i = 0; i < this.GallowWord.length; i++) {
      const char = this.GallowWord.charAt(i);
      const nextChar = this.GallowWord.charAt(i + 1);
      const regex = new RegExp("[a-zA-ZäöüÄÖÜß]");
      if (regex.test(char)) {
        AnonWord += "_";
        if (regex.test(nextChar)) {
          AnonWord += " ";
        }
      } else {
        AnonWord += char;
      }
    }
    return AnonWord;
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendBatchUpdate(event) {
    if (event.length > 25) {
      var i, j, temparray, chunk = 25;
      for (i = 0, j = event.length; i < j; i += chunk) {
        temparray = event.slice(i, i + chunk);
        this.whiteBoardSerive.updateWhiteBoard(temparray, this.UniqueId);
        await this.delay(1);
      }
      return;
    }
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

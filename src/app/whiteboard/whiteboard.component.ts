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
import { randomIntFromInterval } from '../helper/generic';
import { Member } from '../Interfaces/Member';
import {
  WhiteboardService
} from './whiteboard-service/whiteboard-service.service';
declare var $: any;

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
  LastGallowWord = null;
  AnonGallowWord = null;
  ChangeWord = false;
  Init = false;
  NotHidden = [];
  private _RemainingGallowTime:number = 90;

  get RemainingGallowTime():number {
    return this._RemainingGallowTime;
  }
  set RemainingGallowTime(theBar:number) {    
    this._RemainingGallowTime = theBar;    
    if (this.RemainingGallowTime==90&&this.NotHidden.length>0) {
      this.NotHidden = [];
    }
    if (this.RemainingGallowTime<=60&&this.GallowWord.length>2&&this.NotHidden.length<1) {
      this.AnonGallowWord = this.getAnonWord(this.GallowWord, 1);
    }
    if (this.RemainingGallowTime<=30&&this.GallowWord.length>4&&this.NotHidden.length<2) {
      this.AnonGallowWord = this.getAnonWord(this.GallowWord, 2);
    }
    if (this.RemainingGallowTime<=15&&this.GallowWord.length>6&&this.NotHidden.length<3) {
      this.AnonGallowWord = this.getAnonWord(this.GallowWord, 3);
    }
  }

  gallowMember;
  gallowTimer;
  whiteboardJoin;
  whiteboardUpdate;
  whiteboardClear;
  whiteboardUndo;
  whiteboardRedo;
  lineWidth = 4;
  posX = 10;
  posY = 10;
  SelectedColor = '#333333';
  reload = false;
  canvasOptions: CanvasWhiteboardOptions = {
    drawButtonEnabled: false,
    drawButtonText: '',
    clearButtonEnabled: false,
    clearButtonText: '',
    undoButtonText: 'Undo',
    undoButtonEnabled: false,
    redoButtonText: 'Redo',
    redoButtonEnabled: false,
    colorPickerEnabled: false,
    shapeSelectorEnabled: false,
    strokeColorPickerEnabled: false,
    fillColorPickerEnabled: false,
    fillColorPickerText: '',
    drawingEnabled: false,
    batchUpdateTimeoutDuration: 50,
    lineWidth: this.lineWidth,
    scaleFactor: 1,
    startingColor: '#EEEEEE',
    strokeColor: '#333333',        
  };
  Colors = [
    "#333333",
    "#EEEEEE",
    "#808080",
    "#D3D3D3",
    "#8B0000",
    "#FF0000",
    "#FFA500",
    "#FFFF00",
    "#006400",
    "#008000",
    "#90EE90",
    "#00008B",
    "#0000FF",
    "#ADD8E6",
    "#4C004C",
    "#800080",
    "#FFC0CB",
    "#8B4513",
    "#53290B",
  ]

  ngOnChanges() {
    if (!this.Init) {
      this.Init = true;
      this.whiteBoardSerive.getWhiteBoard(this.UniqueId);
    }
    if (this.LastGallowWord!=this.GallowWord) {
      this.ChangeWord = true;
      setTimeout(() => {     
        this.LastGallowWord = this.GallowWord;
        this.AnonGallowWord = this.getAnonWord(this.LastGallowWord);
        this.ChangeWord = false;   
      }, 250);
    }
    if (this.LastIsDrawing!=this.IsDrawing) {
      setTimeout(() => {    
        this.LastIsDrawing = this.IsDrawing;
        this.ChangeStrokeColor('#333333');
        if (this.IsDrawing) {
          this.ReloadWhiteboard();
        }
        this.ShowLeaderboard(true);
        setTimeout(() => {        
          this.ShowLeaderboard(false);
        }, 2500);
      }, 250);
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
    this.gallowMember = this.whiteBoardSerive.gallowMember.subscribe(members => {
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
    this.gallowMember.unsubscribe();
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

  getAnonWord(GallowWord: string, numsToPush = 0) {
    var AnonWord = "";
    for (let i = 0; i < numsToPush; i++) {      
      if (this.NotHidden.length>i) {
        continue;
      }
      var rndInt = -1;
      while (rndInt<0||this.NotHidden.includes(rndInt)||GallowWord.charAt(rndInt).trim().length==0) {        
        rndInt = randomIntFromInterval(0, GallowWord.length-1);
      }
      this.NotHidden.push(rndInt);      
    }
    const regex = new RegExp("[a-zA-ZäöüÄÖÜß]");
    for (var i = 0; i < GallowWord.length; i++) {
      const char = GallowWord.charAt(i);
      if (!this.NotHidden.includes(i)&&regex.test(char)) {
        AnonWord += "_";
      } else {
        AnonWord += char;
      }
    }
    return AnonWord;
  }

  ShowLeaderboard(show) {
    setTimeout(() => {        
      if (show) {
        $('#LeaderboardCollapse').collapse("show")
      } else {
        $('#LeaderboardCollapse').collapse("hide")
      }
    }, $('#LeaderboardCollapse').hasClass('collapsing') ? 350 : 0);
  }

  NewGallow() {
    if (this.IsDrawing) {
      this.ReloadWhiteboard();
      this.whiteBoardSerive.NewGallow(this.UniqueId);
    }
  }

  ReloadWhiteboard() {
      this.reload = true;
      setTimeout(() => {
        this.reload = false;
        this.canvasOptions = {
          ...this.canvasOptions,
          lineWidth: this.lineWidth,
          drawingEnabled: this.IsDrawing,
          strokeColor: this.SelectedColor
        };   
        if (this.IsDrawing) {
          this.ClearCanvas();
        }
      }, 1);
  }

  ChangeStrokeColor(color) {
    this.SelectedColor = color;
    this.canvasOptions = {
      ...this.canvasOptions,
      strokeColor: color
    };
  }

  changeStrokeThickness(thickness) {
    if (thickness >= 3 && thickness <= 50) {   
      this.lineWidth = thickness;
      this.canvasOptions = {
        ...this.canvasOptions,
        lineWidth: this.lineWidth,
      };
    }
  }

  ClearCanvas() {
    this._canvasWhiteboardService.clearCanvas();
    this.whiteBoardSerive.clearWhiteBoard(this.UniqueId);
  }

  hoverCanvas(event) {
    if (this.IsDrawing) {
      const halfWidth = this.lineWidth / 2;
      document.getElementById('CustomCursor').style.top= (event.offsetY - halfWidth) + 'px';
      document.getElementById('CustomCursor').style.left= ((event.offsetX) - halfWidth) + 'px';
    }
  }

  exitCanvas() {
    if (this.IsDrawing) {
      document.getElementById('CustomCursor').style.top= '50%';
      document.getElementById('CustomCursor').style.left= '50%';
    }
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

  onCanvasUndo(event) {
    this.whiteBoardSerive.undoWhiteBoard(this.UniqueId, event);
  }

  onCanvasRedo(event) {
    this.whiteBoardSerive.redoWhiteBoard(this.UniqueId, event);
  }
}

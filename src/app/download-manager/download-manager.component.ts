import { HttpEventType } from '@angular/common/http';
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AlertType } from '../Interfaces/Dialog';
import { DownloadFile, DownloadInfo, FileFolder } from '../Interfaces/DownloadInfo';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { ConversionPreset, DownloadManagerService } from './download-manger-service/download-manager.service';
import { BrowserSettings } from '../Interfaces/BrowserSettings';
import { Subscription } from 'rxjs';
import { User } from '../Interfaces/User';
declare var $: any;
declare var $: any;

@Component({
  selector: 'app-download-manager',
  templateUrl: './download-manager.component.html',
  styleUrls: ['./download-manager.component.scss']
})
export class DownloadManagerComponent implements OnInit, OnDestroy {

  constructor(private downloadService: DownloadManagerService, private dialogService: DialogService) {}
  @ViewChild('fileSelect') fileSelectView: ElementRef;
  @Input() User: User;
  @Input() IsInRoom: boolean = false;
  @Input() UniqueId: string = "";
  @Input() browserSettings: BrowserSettings;
  folderUpdate: Subscription;
  downloadProgress: Subscription;
  downloadFinished: Subscription;
  getDownloads: Subscription;
  fileFolders: Subscription;
  folderFiles: Subscription;
  files: DownloadFile[] = [];
  filterFiles: DownloadFile[] = [];
  selectionFiles: DownloadFile[] = [];
  progresses: DownloadInfo[] = [];
  downloadName = "";
  downloadUrl = "";
  fileSelect;
  currentDownloads = [];
  sortType = "name";
  lastSortType = "name";
  filterName = "";
  collapseShow = false;
  collapseProgress = false;
  pageSize = 5;
  page = 1;
  selectionPageSize = 5;
  selectionPage = 1;
  firstSort = true;
  currentFolder: FileFolder;
  AlertType = AlertType;
  ConversionPreset = ConversionPreset;
  CurrentPreset: ConversionPreset = ConversionPreset.SuperFast;
  CurrentYtQuality = 1080;
  YtAudioOnly = false;
  PossibleYtQuality = [];
  LoadingQuality = false;
  finishedIds: string[] = [];
  ngOnInit(): void {
    this.folderUpdate = this.downloadService.updateFolder.subscribe(f => {
      if (this.files && f) {
        this.files.push(f);
        this.SetFiles(this.files, false);
      }
    });
    this.downloadProgress = this.downloadService.progress.subscribe(p => {
      if (!p || p == null) {
        this.progresses = [];
        return;
      }
      if (!p.type || p.type.length == 0) {
        p.type = "Downloading File...";
      }
      var idx = this.progresses.findIndex(x => x.id == p.id);
      var finishedIdx = this.finishedIds.findIndex(x => x == p.id);
      if (idx == -1 && finishedIdx == -1) {
        this.progresses.push(p);
      } else {
        this.progresses[idx] = p;
      }
    });
    this.downloadFinished = this.downloadService.downloadFinished.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      setTimeout(() => {
        var idx = this.progresses.findIndex(x => x.id == f);
        if (idx != -1) {
          this.progresses.splice(idx, 1);
          this.finishedIds.push(f);
            this.finishedIds.pop();
        }
        this.firstSort = true;
        this.downloadService.GetFolderFiles(this.currentFolder.id);
    }, 500);
    });
    this.fileFolders = this.downloadService.folders.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      this.currentFolder = f;
      this.downloadService.GetFolderFiles(this.currentFolder.id);
    });
    this.folderFiles = this.downloadService.folderFiles.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      this.SetFiles(f, false);
    });
    this.getDownloads = this.downloadService.downloadFiles.subscribe(f => {
      if (!f || f == null && f.length>0) {
        return;
      }
      if (this.currentFolder) {
        this.selectionFiles = f.filter(x => x.fileFolderId != this.currentFolder.id);
      }
    });
    this.AddFileListener();
  }

  SetFiles(f: DownloadFile[], change: boolean = true) {
    this.files = [...f];
      this.Filter();
      if (this.firstSort) {
        this.firstSort = !this.firstSort;
      }
      this.sortFilesBy(change);
  }

  Filter() {
    if (!this.files) {
      return;
    }
    const map = new Map(this.files.map(pos => [pos.id, pos]));
    const uniques = [...map.values()];
    if (this.filterName.length > 0) {
      this.filterFiles = [...uniques.filter(x => x.name.toLocaleLowerCase().includes(this.filterName))];
      return;
    }
    this.filterFiles = [...this.files];
  }

  UpdateFolder(folder: FileFolder) {
    this.page = 1;
    this.currentFolder = folder;
    this.selectionFiles = [];
    $('.collapseFileFooter').collapse(this.collapseShow ? 'hide' : 'show');
  }

  AddFileListener() {
    var dropZone = document.getElementById('dropZone');

    // Optional.   Show the copy icon when dragging over.  Seems to only work for chrome.
    dropZone.addEventListener('dragover', function (e) {
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dropZone.addEventListener('drop', (e) => {
      e.stopPropagation();
      e.preventDefault();
      var files = e.dataTransfer.files;
      this.FileUpload(files[0]);
    });
  }

  customTB(index, f) {
    return `${index}-${f.id}`;
  }

  ngOnDestroy(): void {
    this.downloadProgress.unsubscribe();
    this.downloadFinished.unsubscribe();
    this.getDownloads.unsubscribe();
    this.fileFolders.unsubscribe();
    this.folderFiles.unsubscribe();
    this.folderUpdate.unsubscribe();
  }

  CollapseAll() {
    $('.collapseFileFooter').collapse(this.collapseShow ? 'hide' : 'show');
    this.collapseShow = !this.collapseShow;
  }

  CollapseProgresses() {
    $('#progressCards').collapse(this.collapseProgress ? 'hide' : 'show');
    this.collapseProgress = !this.collapseProgress;
  }

  sortFilesBy(change = true) {
    if (change) {
      this.lastSortType = this.lastSortType == this.sortType ? "" : this.sortType;
    }
    if (this.sortType == "name") {
      this.filterFiles.sort((a, b) => {
        return b.name.localeCompare(a.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      })
    } else if (this.sortType == "created") {
      this.filterFiles.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    } else if (this.sortType == "size") {
      this.filterFiles.sort((a, b) => b.length - a.length);
    }
    if (this.lastSortType == this.sortType) {
      this.filterFiles.reverse();
    }
    setTimeout(() => {
      $('.collapseFileFooter').collapse(this.collapseShow ? 'show' : 'hide');
    }, 10);
  }

  SelectFile() {
    var elemId = "fileSelect";
    var elem = document.getElementById(elemId);
    if (elem && document.createEvent) {
      var evt = document.createEvent("MouseEvents");
      evt.initEvent("click", true, false);
      elem.dispatchEvent(evt);
    }
  }

  FileSelected(file) {
    if (!file || !file.target || !file.target.files) {
      return;
    }
    var selection = file.target.files[0];
    if (selection == null) {
      return;
    }
    this.FileUpload(selection);
  }

  CleanUp = false;
  CleanUpTimeOut;
  CleanUpFiles(remove = false) {
    clearTimeout(this.CleanUpTimeOut);
    if (!this.CleanUp&&!remove) {
      this.CleanUpTimeOut = setTimeout(() => {
        this.CleanUp = !this.CleanUp;
      }, 3000);
    }
    if (this.CleanUp&&!remove) {
      $('#dialogModal-delete-files').modal('show');
      return;
    }
    this.downloadService.CleanUpFiles(remove);
    this.CleanUp = !this.CleanUp;
  }

  FileUpload(file: File) {
    this.fileSelectView.nativeElement.value = '';
    var id = crypto.randomUUID();
    this.downloadService.progress.next({
      id: id,
      progress: 0,
      type: 'Uploading File...',
      name: file.name
    })
    var start = new Date();
    var upload = this.downloadService.UploadFile(file).subscribe(resp => {
      if (resp.type === HttpEventType.Response) {
        this.downloadService.downloadFinished.next(id);
        this.downloadService.GetFolderFiles(this.currentFolder.id);
      }
      if (resp.type === HttpEventType.UploadProgress) {
        const percentDone = 100 * resp.loaded / resp.total;
        var elapsed = new Date().getTime() - start.getTime();
        var timeLeft = elapsed / percentDone * (100 - percentDone);
        var dateLeft = new Date(timeLeft);
        var hours = dateLeft.getUTCHours().toString();
        var minute = dateLeft.getMinutes().toString();
        var second = dateLeft.getSeconds().toString();
        hours = ("0" + hours).slice(-2);
        minute = ("0" + minute).slice(-2);
        second = ("0" + second).slice(-2);
        this.downloadService.progress.next({
          id: id,
          progress: Math.round(percentDone),
          type: (Math.round(resp.loaded / 1024 / 1024 * 100) / 100).toFixed(2) + 'MB of ' + (Math.round(resp.total / 1024 / 1024 * 100) / 100).toFixed(2) + 'MB - remaining ' + hours + ':' + minute + ":" + second,
          name: file.name
        })
      }
    }, err => {
      this.downloadService.downloadFinished.next(id);
    });
    this.currentDownloads.push({
      id: id,
      upload: upload
    });
  }

  CancelDownload(id: string) {
    var idx = this.currentDownloads.findIndex(x => x.id == id);
    if (idx == -1) {
      var idx = this.progresses.findIndex(x => x.id == id);
    } else {
      this.currentDownloads[idx].upload.unsubscribe();
    }
    if (idx > -1) {
      this.downloadService.CancelM3U8Download(id);
      this.downloadService.downloadFinished.next(id);
    }
  }

  DownloadFile() {
    if (this.IsYt()) {
      this.DownloadYtFile();
      return;
    }
    if (this.downloadUrl.length > 0 && this.downloadUrl.startsWith("http")) {
      if (this.downloadName.length==0) {
        this.downloadName = "New File";
      }
      this.downloadService.DownloadFile(this.downloadUrl, this.downloadName, this.CurrentPreset);
      this.downloadUrl = "";
      if (this.downloadName == "New File") {
        this.downloadName = "";
      }
    }
  }

  IsYt() {
    return (this.downloadUrl.includes('youtube') && this.downloadUrl.includes("?v=")) || this.downloadUrl.includes('youtu.be');
  }

  CheckYtQuality() {
    if (this.IsYt()) {
      this.LoadingQuality = true;
      this.downloadService.GetYtQuality(this.downloadUrl).subscribe(x => {
        if (!x || x.length == 0) {
          this.LoadingQuality = false;
          this.PossibleYtQuality = [1080];
          return;
        }
        this.PossibleYtQuality = x;
        this.LoadingQuality = false;
        if (!this.PossibleYtQuality.includes(this.CurrentYtQuality)) {
          this.CurrentYtQuality = this.PossibleYtQuality[this.PossibleYtQuality.length - 1];
        }
      }, e => {this.LoadingQuality=false;this.PossibleYtQuality=[1080];this.CurrentYtQuality=1080});
      return;
    }
  }

  DownloadYtFile() {
    if (this.downloadUrl.length > 0 && this.downloadUrl.startsWith("http") && !this.LoadingQuality) {
      this.downloadService.DownloadYtFile(this.downloadUrl, this.CurrentYtQuality.toString(), this.YtAudioOnly);
      this.downloadUrl = "";
      this.PossibleYtQuality = [];
    }
  }
}

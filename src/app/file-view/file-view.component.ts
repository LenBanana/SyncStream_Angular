import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { DownloadManagerService } from '../download-manager/download-manger-service/download-manager.service';
import { getCookie } from '../global.settings';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { DownloadFile } from '../Interfaces/DownloadInfo';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { PlayerService } from '../player/player-service/player.service';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { baseUrl } from '../services/signal-r.service';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { BrowserSettings } from '../Interfaces/BrowserSettings';
declare var $: any;

@Component({
  selector: 'app-file-view',
  templateUrl: './file-view.component.html',
  styleUrls: ['./file-view.component.scss']
})
export class FileViewComponent implements OnInit {

  constructor(private dialogService: DialogService, private downloadService: DownloadManagerService, private playerService: PlayerService, private playlistService: PlaylistService) { }
  @Input() filterFiles: DownloadFile[];
  @Input() pageSize: number = 5;
  @Input() page: number = 1;
  @Input() currentId: number = 0;
  @Input() IsInRoom: boolean = false;
  @Input() UniqueId: string = "";
  @Input() browserSettings: BrowserSettings;
  @ViewChild('menuTrigger') menuTrigger: MatMenuTrigger;
  serverDialog: Dialog = { id: 'delete-perm', header: 'Delete file?', question: '', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Warning }
  askedId = 0;

  ngOnInit(): void {
  }

  anySelected(file: DownloadFile) {
    return file.selected || (this.filterFiles.findIndex(x => x.selected) != -1);
  }

  DownloadDbFile(file: DownloadFile) {
    var Token = getCookie("login-token");
    if (Token) {
      var fileUrl = this.GetDownloadUri(file);
      window.open(fileUrl, "_blank");
    }
  }

  GetDownloadUri(file: DownloadFile) {
    var Token = getCookie("login-token");
    if (Token) {
      return baseUrl + "api/video/fileByToken?fileKey=" + file.fileKey + "&token=" + Token;
    }
  }

  timeFromSeconds(sec) {
    if (!sec||sec<=0) {
      return "00:00:00";
    }
    var date = new Date(0);
    date.setSeconds(sec);
    var hours = date.getUTCHours().toString();
    var minute = date.getMinutes().toString();
    var second = date.getSeconds().toString();
    hours = ("0" + hours).slice(-2);
    minute = ("0" + minute).slice(-2);
    second = ("0" + second).slice(-2);
    return hours + ':' + minute + ":" + second;
  }

  openImg(file: DownloadFile) {
    if (this.isImg(file)) {
      var fileUri = this.GetDownloadUri(file);
      $("#imgShowImg").attr("src",fileUri);
      setTimeout(() => {
        $('#imgShowModal').modal('show');
      }, 100);
    }
  }

  isImg(file: DownloadFile) {
    return file.fileEnding.toLocaleLowerCase() == ".jpg" ||
    file.fileEnding.toLocaleLowerCase() == ".jpeg" ||
    file.fileEnding.toLocaleLowerCase() == ".gif" ||
    file.fileEnding.toLocaleLowerCase() == ".ico" ||
    file.fileEnding.toLocaleLowerCase() == ".icon" ||
    file.fileEnding.toLocaleLowerCase() == ".png";
  }

  isAudio(f: DownloadFile) {
    return f.fileEnding.toLocaleLowerCase()=='.flac'||
    f.fileEnding.toLocaleLowerCase()=='.wav'||
    f.fileEnding.toLocaleLowerCase()=='.mp3'||
    f.fileEnding.toLocaleLowerCase()=='.ogg'||
    f.fileEnding.toLocaleLowerCase()=='.m4a';
  }

  playWavFile(file: DownloadFile) {
    var url = this.GetDownloadUri(file);
    if ((!file.player||file.player.paused) && url && url.length > 0) {
      this.filterFiles.forEach(x => x.player?.pause());
      if (!file.player) {
        var a = new Audio(url);
        a.play();
        file.player = a;
      } else if (file.player?.paused) {
        file.player.play();
      }
      file.player.volume = this.browserSettings.generalSettings.audioVolume / 100;
    }
    else if (file.player) {
      file.player.pause();
    }
    return file.player;
  }

  seekFileTo(file:DownloadFile, event) {
    if (!file.player) {
      this.playWavFile(file);
    }
    setTimeout(() => {
      var clickPerc = event.layerX / event.target.clientWidth;
      var seekPos = file.player.duration * clickPerc;
      if (seekPos >= 0 && seekPos <= file.player.duration) {
        file.player.currentTime = seekPos;
      }
    }, 200);
  }

  getPlayerPercentage(file: DownloadFile) {
    if (file.player) {
      return file.player.currentTime / file.player.duration * 100;
    } else {
      return 0;
    }
  }

  GetFileInfo(id: number) {
    this.downloadService.GetFileInfo(id);
  }

  RemoveFile(id: number) {
    if (this.filterFiles.findIndex(x => x.selected) != -1) {
      var selectedCount = this.filterFiles.filter(x => x.selected);
      this.serverDialog.question = "Are you sure you want to delete " + selectedCount.length + " selected files";
      this.ToggleDeleteModal(true);
      return;
    }
    var idx = this.filterFiles.findIndex(x => x.id == id);
    if (idx == -1) {
      return;
    }
    this.askedId = id;
    var file = this.filterFiles[idx];
    this.serverDialog.question = "Are you sure you want to delete " + file.name;
    this.ToggleDeleteModal(true);
  }

  DeleteCallback() {
    this.ToggleDeleteModal(false);
    if (this.filterFiles.findIndex(x => x.selected) != -1) {
      var selectedCount = this.filterFiles.filter(x => x.selected);
      selectedCount.forEach(x => this.DeleteFile(x));
      return;
    }
    var idx = this.filterFiles.findIndex(x => x.id == this.askedId);
    if (idx != -1) {
      this.DeleteFile(this.filterFiles[idx]);
    }
  }

  DeleteFile(file: DownloadFile) {
    if (file.player) {
      file.player.pause();
      file.player = null;
    }
    this.downloadService.RemoveFile(file.id);
  }

  MakeFilePermanent(file: DownloadFile) {
    this.downloadService.MakeFilePermanent(file.id);
  }

  ToggleDeleteModal(show) {
    if (show) {
      $('#dialogModal-delete-perm').modal('show');
    } else {
      $('#dialogModal-delete-perm').modal('hide');
    }
  }

  SendToRoom(f: DownloadFile) {
    if (f && this.IsInRoom && this.UniqueId.length > 0) {
      var fileUrl = baseUrl + "api/video/fileByToken?fileKey=" + f.fileKey;
      var vid: VideoDTO = {title: f.name, url: fileUrl};
      this.playlistService.addVideo(vid, this.UniqueId);
    }
  }

  getEvent() {
    setTimeout(() => {
      $('.cdk-overlay-container').bind('contextmenu', (e) => {
        e.preventDefault();
        this.menuTrigger.closeMenu();
      });
    }, 10);
  }

  CopyToClip(file: DownloadFile) {
    if (!navigator || !navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }
    var Token = getCookie("login-token");
    if (!Token) {
      return;
    }
    var fileUrl = baseUrl + "api/video/fileByToken?fileKey=" + file.fileKey;
    navigator.clipboard.writeText(fileUrl).catch(async err => {
        const permissionStatus = await navigator.permissions.query({
          name: 'clipboard-write' as PermissionName
        });
        if (permissionStatus.state !== "granted") {
          this.dialogService.PushDefaultDialog("Please grant clipboard permissions.", "Permission error", AlertType.Warning);
          return;
        }
      });
  }

  ToggleEdit(file: DownloadFile) {
    this.filterFiles.filter(x => x.id != file.id).forEach(x => {
      if (x.editing) {
        x.editing = !x.editing;
      }
    });
    file.editing = !file.editing;
    if (file.editing) {
      file.editName = file.name;
      setTimeout(() => {
        $("#editFileInput" + file.id).focus();
        $("#editFileInput" + file.id).select();
      }, 10);
    } else {
      if (file.name != file.editName && file.name.length>0) {
        var id = file.id;
        if (id && id > -1) {
          this.downloadService.ChangeDownload(id, file.name);
        }
      } else {
        file.name = file.editName;
      }
    }
  }
}

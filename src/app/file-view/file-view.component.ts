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
  @ViewChild('menuTrigger') menuTrigger: MatMenuTrigger;
  serverDialog: Dialog = { id: 'delete-perm', header: 'Delete file?', question: '', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Warning }
  askedId = 0;

  ngOnInit(): void {
  }

  DownloadDbFile(file: DownloadFile) {
    var Token = getCookie("login-token");
    if (Token) {
      var fileUrl = baseUrl + "api/video/videoByToken?uniqueId=" + file.id + "&videoKey=" + file.fileKey + "&token=" + Token;
      window.open(fileUrl, "_self");
    }
  }

  RemoveFile(id: number) {
    var idx = this.filterFiles.findIndex(x => x.id == id);
    if (idx == -1) {
      return;
    }
    this.askedId = id;
    var file = this.filterFiles[idx];
    this.serverDialog.question = "Are you sure you want to delete " + file.name;
    this.ShowDeleteModal(true);
  }

  GetFileInfo(id: number) {
    this.downloadService.GetFileInfo(id);
  }

  DeleteFile() {
    this.downloadService.RemoveFile(this.askedId);
    this.ShowDeleteModal(false);
  }

  SendToRoom(f: DownloadFile) {
    if (f && this.IsInRoom && this.UniqueId.length > 0) {
      var fileUrl = baseUrl + "api/video/videoByToken?uniqueId=" + f.id + "&videoKey=" + f.fileKey;
      var vid: VideoDTO = {title: f.name, url: fileUrl};
      this.playlistService.addVideo(vid, this.UniqueId);
    }
  }

  ShowDeleteModal(show) {
    if (show) {
      $('#dialogModal-delete-perm').modal('show');
    } else {
      $('#dialogModal-delete-perm').modal('hide');
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
    var fileUrl = baseUrl + "api/video/videoByToken?uniqueId=" + file.id + "&videoKey=" + file.fileKey;
    navigator.clipboard.writeText(fileUrl).catch(async err => {
        const permissionStatus = await navigator.permissions.query({
          name: 'clipboard-write' as PermissionName
        });
        if (permissionStatus.state !== "granted") {
          const dialog: Dialog = {
            id: "clipboard-perm",
            header: "Permission error",
            question: "Please grant clipboard permissions.",
            answer1: "Ok",
            answer2: null,
            yes: null,
            no: null,
            alertType: AlertType.Warning
          };
          this.dialogService.newDialog.next(dialog);
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

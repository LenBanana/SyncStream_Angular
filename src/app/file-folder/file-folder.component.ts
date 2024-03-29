import {Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, ViewChild} from '@angular/core';
import {MatMenuTrigger} from '@angular/material/menu';
import {Subscription} from 'rxjs';
import {DownloadManagerService} from '../download-manager/download-manger-service/download-manager.service';
import {getCookie, getRandomColor, userId} from '../global.settings';
import {DownloadFile, FileFolder} from '../Interfaces/DownloadInfo';
import {SharedUser, User} from '../Interfaces/User';
import {UserPrivileges} from '../user-admin-modal/user-admin-modal.component';
import {UserAdminService} from '../user-admin-modal/user-admin-service/user-admin.service';
import {BrowserSettings} from '../Interfaces/BrowserSettings';

declare var $: any;

@Component({
  selector: 'app-file-folder',
  templateUrl: './file-folder.component.html',
  styleUrls: ['./file-folder.component.scss']
})
export class FileFolderComponent implements OnInit, OnDestroy, OnChanges {

  constructor(private downloadService: DownloadManagerService, private userAdminService: UserAdminService) {
  }

  @Input() filterFiles: DownloadFile[];
  @Input() folder: FileFolder;
  @Input() currentFolder: FileFolder;
  @Input() prevFolder: FileFolder;
  @Input() backFolder: FileFolder[] = [];
  @Input() pageSize: number = 5;
  @Input() page: number = 1;
  @Input() IsInRoom: boolean = false;
  @Input() UniqueId: string = "";
  @Input() browserSettings: BrowserSettings;
  @Output() goDeeper = new EventEmitter();
  @ViewChild('menuTrigger') menuTrigger: MatMenuTrigger;
  getFolders: Subscription;
  getFolderUsers: Subscription;
  userUpdate: Subscription;
  edit = false;
  editName = "";
  Users: User[] = [];
  FilteredUsers: SharedUser[] = [];
  paginatedUsers: SharedUser[] = [];
  searchTerm: string = '';
  currentSharePage: number = 1;
  sharePageSize: number = 12;

  ngOnInit(): void {
    this.getFolders = this.downloadService.folders.subscribe(f => {
      if (f && f.id == this.folder.id) {
        this.folder = f;
      }
    });
    this.userUpdate = this.userAdminService.Users.subscribe(users => {
      if (!users) {
        return;
      }
      this.Users = users;
      this.FilteredUsers = users.filter(x => x.userprivileges >= UserPrivileges.Administrator && x.id != userId).map(x => {
        return {
          ...x,
          isShared: false,
          randomColor: getRandomColor(x.username)
        }
      });
    });
  }

  searchUsers() {
    this.FilteredUsers = this.Users.filter(x => x.userprivileges >= UserPrivileges.Administrator && x.id != userId).map(x => {
      return {
        ...x,
        isShared: false,
        randomColor: getRandomColor(x.username)
      }
    });
    if (this.searchTerm) {
      this.FilteredUsers = this.FilteredUsers.filter(user => user.username.toLowerCase().includes(this.searchTerm.toLowerCase()));
    }
  }

  getUserId() {
    return userId;
  }

  ngOnDestroy(): void {
    this.getFolders.unsubscribe();
    this.userUpdate.unsubscribe();
  }

  ngOnChanges() {
    if (this.folder && this.folder.children) {
      this.folder.children.sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      })
    }
  }
  GoDeeper(folder: FileFolder) {
    if (folder.id != this.currentFolder.id) {
      this.downloadService.GetFolderFiles(folder.id);
      this.backFolder.push(this.currentFolder);
      this.goDeeper.emit(folder);
    }
  }

  GoThroughDeeper(folder: FileFolder) {
    this.backFolder.push(this.currentFolder);
    this.downloadService.GetFolderFiles(folder.id);
    this.goDeeper.emit(folder);
  }

  GoBack() {
    if (this.backFolder && this.backFolder.length > 0) {
      var lastFolder = this.backFolder.pop();
      this.downloadService.GetFolderFiles(lastFolder.id);
      this.goDeeper.emit(lastFolder);
    }
  }

  GoBackIndex(i) {
    if (this.backFolder && this.backFolder.length > 0) {
      var lastFolder = this.backFolder[i];
      this.backFolder.splice(i, this.backFolder.length - i);
      this.downloadService.GetFolderFiles(lastFolder.id);
      this.goDeeper.emit(lastFolder);
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

  AddFiles() {
    this.downloadService.GetDownloads();
  }

  ToggleEdit() {
    this.edit = !this.edit;
    if (this.edit) {
      this.editName = this.folder.name;
      setTimeout(() => {
        $("#editFolderInput" + this.folder.id).focus();
        $("#editFolderInput" + this.folder.id).select();
      }, 10);
    }
  }

  ChangeName() {
    this.ToggleEdit();
    if (this.folder.name.length == 0 || this.folder.name == this.editName) {
      this.folder.name = this.editName;
      return;
    }
    this.downloadService.ChangeFolderName(this.folder.id, this.folder.name);
  }

  AddFolder() {
    this.downloadService.AddFolder(this.currentFolder.id);
  }

  DeleteFolder() {
    this.downloadService.DeleteFolder(this.folder.id);
  }

  ShareFolderModal() {
    if (!this.FilteredUsers || this.FilteredUsers.length == 0) {
      var Token = getCookie("login-token");
      var UserID = Number.parseInt(getCookie("user-id"));
      if (Token && UserID) {
        this.userAdminService.GetUsers(Token, UserID);
      }
    }
    this.getFolderUsers = this.downloadService.folderShared.subscribe(users => {
      if (!users) {
        return;
      }
      this.FilteredUsers.forEach(a => {
        a.isShared = users.some(b => a.id == b.id);
      });
      this.FilteredUsers.sort((a, b) => a.isShared === b.isShared ? a.username.localeCompare(b.username, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) : a.isShared ? 1 : -1);
      this.getFolderUsers?.unsubscribe();
    })
    this.downloadService.GetFolderUsers(this.folder.id);
    $('#chooseUserModal' + this.folder.id).modal('toggle');
  }

  ShareFolder() {
    const user = Number.parseFloat((document.getElementById('userSel1' + this.folder.id) as HTMLSelectElement).value);
    this.downloadService.ShareFolder(this.folder.id, user);
  }

  HideModal() {
    $('#chooseUserModal' + this.folder.id).modal('hide');
  }

  ShareFolderById(user: number) {
    this.downloadService.ShareFolder(this.folder.id, user);
  }

  drop(file) {
    var itemId = (file.item.element.nativeElement as HTMLDivElement).id;
    var fileId = Number.parseFloat(itemId?.substring(8, itemId?.length));
    if (!fileId) {
      return;
    }
    var prevIdx = this.filterFiles.findIndex(x => x.id == fileId);
    file.previousIndex + ((this.page - 1) * this.pageSize);
    var fileFolderId = this.filterFiles[prevIdx].fileFolderId;
    var folderId = file.container.data.id;
    if (folderId == fileFolderId) {
      folderId = this.currentFolder.parent.id;
    }
    if (folderId) {
      this.filterFiles.splice(prevIdx, 1);
      this.downloadService.ChangeFolder(fileId, folderId);
    }
  }

  dropThrough(file) {
    this.drop(file);
  }
}

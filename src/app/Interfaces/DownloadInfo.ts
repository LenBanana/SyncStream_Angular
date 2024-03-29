export class DownloadInfo {
  type: string;
  id: string;
  progress: number;
  name: string;
}

export class DownloadFile {
  id: number;
  name: string;
  created: Date;
  fileEnding: string;
  fileKey: string;
  fileFolderId: number;
  length: number;
  editing: boolean;
  editName: string;
  player: HTMLAudioElement;
  selected: boolean;
  dateToBeDeleted: Date;
}

export class FileFolder {
  id: number;
  userId: number;
  name: string;
  parent: FileFolder;
  children: FileFolder[];
  files: DownloadFile[];
  selected: boolean;
}

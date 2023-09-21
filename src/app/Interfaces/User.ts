import { UserPrivileges } from "../user-admin-modal/user-admin-modal.component";

export interface User {
    id: number,
    username: string,
    image?: string,
    password: string,
    approved: number,
    userprivileges: UserPrivileges,
    streamToken: string,
    apiKey: string
}

export interface SharedUser extends User {
  isShared: boolean,
  randomColor: string
}

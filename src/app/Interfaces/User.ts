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

export interface SharedUser extends UserSummary {
  isShared: boolean,
  randomColor: string
}

/**
 * What the server sends in any user list (`getusers`, `getFolderUsers`, watching users).
 * Carries no credentials: the stream token and API key are only ever sent to the user they
 * belong to, on the `userlogin` payload.
 */
export interface UserSummary {
    id: number,
    username: string,
    approved: number,
    userprivileges: UserPrivileges
}

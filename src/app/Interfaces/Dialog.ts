export interface Dialog {
    id: string,
    header: string,
    question: string
    answer1: string,
    answer2: string,
    alertType: AlertType,
    yes(): any,
    no(): any
}

export enum AlertType {
  Success,
  Info,
  Warning,
  Danger
}

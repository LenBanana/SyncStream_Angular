export interface Dialog {
    id: string,
    header: string,
    question: string
    answer1: string,
    answer2: string,
    yes(): any,
    no(): any
}
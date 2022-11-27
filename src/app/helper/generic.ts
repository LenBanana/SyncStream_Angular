
 export function randomID(): string {
  return 'd' + Math.random().toString(36).substr(2, 9);
}

 export function randomIntFromInterval(min, max): number {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  export function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

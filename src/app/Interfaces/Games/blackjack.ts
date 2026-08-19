export class BlackjackMember {
    username: string;
    cards: PlayingCard[];
    splitCards: PlayingCard[];
    points: number;
    splitPoints: number;
    money: number;
    bet: number;
    blackjack: boolean;
    didSplit: boolean;
    splitBlackjack: boolean;
    splitable: boolean;
    waitingForBet: boolean;
    waitingForPull: boolean;
    notPlaying: boolean;
    doubled: boolean;
}

export class BlackjackDealer {
    name: string;
    cards: PlayingCard[];
    /** Total of the face-up cards only. */
    pointsDTO: number;
    money: number;
}

export class PlayingCard {
    faceUp: boolean;
    /** Null while the card is face down: a hidden card reveals nothing. */
    id?: string;
    suitS?: string;
    rankS?: string;
    cardName?: string;
    suit?: PlayingCardSuit;
    rank?: PlayingCardRank;
}

export enum PlayingCardSuit {
    Clubs,
    Diamonds,
    Hearts,
    Spades
}

export enum PlayingCardRank {
    two = 2, 
    three, 
    four, 
    five, 
    six, 
    seven, 
    eight, 
    nine, 
    ten, 
    Jack, 
    Queen, 
    King, 
    Ace
}
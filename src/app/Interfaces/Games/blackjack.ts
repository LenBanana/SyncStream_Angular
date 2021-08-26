export class BlackjackMember {
    username: string;
    cards: PlayingCard[];
    points: number;
    money: number;
    bet: number;
    blackjack: boolean;
    doubled: boolean;
}

export class BlackjackDealer {
    name: string;
    cards: PlayingCard[];
    pointsDTO: number;
    blackjack: boolean;
}

export class PlayingCard {
    Id: string;
    suitS: string;
    rankS: string;
    cardName: string;
    suit: PlayingCardSuit;
    rank: PlayingCardRank;
    faceUp: boolean;
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
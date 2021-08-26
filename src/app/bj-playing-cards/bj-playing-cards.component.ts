import { Component, Input, OnInit } from '@angular/core';
import { PlayingCard } from '../Interfaces/Games/blackjack';

@Component({
  selector: 'app-bj-playing-cards',
  templateUrl: './bj-playing-cards.component.html',
  styleUrls: ['./bj-playing-cards.component.scss']
})
export class BjPlayingCardsComponent implements OnInit {

  @Input() PlayingCards: PlayingCard[];
  @Input() IsYourCards: boolean = true;
  constructor() { }

  ngOnInit(): void {
  }

}

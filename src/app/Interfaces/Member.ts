export interface Member {
    username: string;
    ishost: boolean;
    gallowPoints: number;
    guessedGallow: boolean;
    /** True when the member is actively sharing their screen via P2P WebRTC. */
    isstreaming: boolean;
    /** SignalR connectionId — used to target a specific streamer when watching. */
    connectionId?: string;
}
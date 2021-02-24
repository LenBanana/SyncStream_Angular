import { VideoDTO } from './VideoDTO';
import { Member } from './Member';

export interface Server {
    currenttime: number;
    ytURL: VideoDTO;
    ytURLs: VideoDTO[];
    isplaying: boolean;
    title: string;
    members: Member[];
}
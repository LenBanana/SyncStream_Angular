import { VideoDTO } from './VideoDTO';
import { Member } from './Member';

export interface Server {
    currenttime: number;
    currentVideo: VideoDTO;
    playlist: VideoDTO[];
    isplaying: boolean;
    title: string;
    members: Member[];
}
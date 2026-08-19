export type SponsorBlockCategory =
  'sponsor'
  | 'selfpromo'
  | 'interaction'
  | 'intro'
  | 'outro'
  | 'preview'
  | 'filler'
  | 'music_offtopic'
  | 'hook'
  | 'exclusive_access';

export type SponsorBlockCategorySettingsMap = Record<SponsorBlockCategory, boolean>;

export const sponsorBlockCategoryOrder: SponsorBlockCategory[] = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'filler',
  'music_offtopic',
  'hook',
  'exclusive_access'
];

export const sponsorBlockCategoryLabels: Record<SponsorBlockCategory, string> = {
  sponsor: 'Sponsor',
  selfpromo: 'Self Promotion',
  interaction: 'Interaction Reminder',
  intro: 'Intro',
  outro: 'Outro',
  preview: 'Preview / Recap',
  filler: 'Filler / Tangent',
  music_offtopic: 'Music Offtopic',
  hook: 'Hook / Greeting',
  exclusive_access: 'Exclusive Access'
};

export const sponsorBlockCategoryColors: Record<SponsorBlockCategory, string> = {
  sponsor: '#f97316',
  selfpromo: '#facc15',
  interaction: '#38bdf8',
  intro: '#22c55e',
  outro: '#a855f7',
  preview: '#fb7185',
  filler: '#94a3b8',
  music_offtopic: '#14b8a6',
  hook: '#06b6d4',
  exclusive_access: '#ef4444'
};

export function createDefaultSponsorBlockCategoryMap(): SponsorBlockCategorySettingsMap {
  return {
    sponsor: true,
    selfpromo: true,
    interaction: true,
    intro: true,
    outro: true,
    preview: true,
    filler: false,
    music_offtopic: true,
    hook: true,
    exclusive_access: true
  };
}

export interface SponsorBlockSegment {
  id: string;
  category: SponsorBlockCategory;
  actionType: string;
  startTime: number;
  endTime: number;
  votes: number;
  locked: boolean;
  description: string;
}

export interface SponsorBlockSegmentsResponse {
  videoId: string;
  fetchedAtUtc: string;
  segments: SponsorBlockSegment[];
}
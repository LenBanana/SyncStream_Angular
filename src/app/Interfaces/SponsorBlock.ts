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

/**
 * Which categories the server skips, and everything it could skip.
 *
 * Set once for the whole site rather than per browser, because only the host's client performs a skip and the
 * position it jumps to is what everyone else follows. Held per browser, the choice belonged to whoever happened
 * to be host and a viewer's own toggles changed nothing.
 */
export interface SponsorBlockPolicy {
  skipCategories: SponsorBlockCategory[];
  availableCategories: SponsorBlockCategory[];
}

/**
 * What is skipped until the server says otherwise.
 *
 * Matches the server's own default, so the moment before the policy arrives behaves the same as the moment
 * after. Two categories, where this used to be every one except filler: skipping intros, outros, greetings and
 * recaps by default removes a lot that people want to watch, and it is more than SponsorBlock itself does.
 */
export const defaultSponsorBlockSkipCategories: SponsorBlockCategory[] = ['sponsor', 'selfpromo'];

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
/**
 * What kind of Twitch content a link points at.
 *
 * The three are not interchangeable: a channel is a live stream with no timeline, a video is a recording the
 * embed can seek within, and a clip is a short excerpt that Twitch serves through a different embed with no
 * scripting interface at all.
 */
export type TwitchSourceKind = 'channel' | 'video' | 'clip';

export interface TwitchSource {
  kind: TwitchSourceKind;

  /** Channel login, video id, or clip slug, depending on the kind. */
  id: string;

  /** Where in a video to start, from the link's t parameter. Zero for anything else. */
  startSeconds: number;
}

/** twitch.tv/videos/123456789 */
const VideoPath = /^\/videos\/(\d+)\/?$/i;

/** twitch.tv/somechannel/clip/SomeSlug */
const ChannelClipPath = /^\/([A-Za-z0-9_]{1,40})\/clip\/([A-Za-z0-9_-]+)\/?$/i;

/** clips.twitch.tv/SomeSlug */
const ClipHostPath = /^\/([A-Za-z0-9_-]+)\/?$/i;

/** twitch.tv/somechannel */
const ChannelPath = /^\/([A-Za-z0-9_]{1,40})\/?$/i;

/** Twitch writes offsets as 1h2m3s, and any of the three parts may be missing. */
const Offset = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;

/**
 * Reads a Twitch link into the thing the player actually has to be told.
 *
 * The player takes a channel login or a numeric video id through separate calls, and the link is the only
 * place that distinguishes them. The previous code tested whether the stored value was all digits, but the
 * stored value was the whole URL, so the test was always false and every source was loaded as a video id that
 * happened to be a URL. Nothing played, which is why Twitch appeared broken for channels and recordings
 * alike, and clips were never handled at all.
 *
 * @returns the source, or null when the link is not a Twitch link this can play.
 */
export function parseTwitchSource(rawUrl: string | null | undefined): TwitchSource | null {
  if (!rawUrl) {
    return null;
  }

  const url = toUrl(rawUrl.trim());
  if (url === null) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const path = url.pathname.replace(/\/{2,}/g, '/');

  if (host === 'clips.twitch.tv') {
    // clips.twitch.tv/embed?clip=Slug is the embed form, which people do paste.
    const embedded = url.searchParams.get('clip');
    if (embedded) {
      return { kind: 'clip', id: embedded, startSeconds: 0 };
    }

    const onHost = ClipHostPath.exec(path);
    if (!onHost || onHost[1].toLowerCase() === 'embed') {
      // /embed is the frame itself, so without the clip parameter above there is no clip named at all and
      // taking the path segment would produce a source called "embed".
      return null;
    }
    return { kind: 'clip', id: onHost[1], startSeconds: 0 };
  }

  if (host !== 'twitch.tv') {
    return null;
  }

  const video = VideoPath.exec(path);
  if (video) {
    return { kind: 'video', id: video[1], startSeconds: parseOffset(url.searchParams.get('t')) };
  }

  // Checked before the plain channel pattern, which would otherwise not match this path at all and fall
  // through to null.
  const channelClip = ChannelClipPath.exec(path);
  if (channelClip) {
    return { kind: 'clip', id: channelClip[2], startSeconds: 0 };
  }

  const channel = ChannelPath.exec(path);
  if (channel && !ReservedPaths.has(channel[1].toLowerCase())) {
    return { kind: 'channel', id: channel[1], startSeconds: 0 };
  }

  return null;
}

/**
 * Single-segment paths on twitch.tv that are site pages rather than channels.
 *
 * Without this, twitch.tv/directory loads a channel called "directory" and shows an offline screen instead of
 * saying the link is not playable.
 */
const ReservedPaths = new Set([
  'directory', 'downloads', 'jobs', 'p', 'products', 'settings', 'subscriptions', 'turbo', 'videos', 'store',
  'friends', 'inventory', 'wallet', 'drops', 'moderator', 'popout', 'embed', 'login', 'signup', 'search'
]);

function toUrl(value: string): URL | null {
  try {
    // A pasted link often has no scheme, and the URL parser rejects those outright.
    return new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
  } catch {
    return null;
  }
}

/** Reads Twitch's 1h2m3s offset form. Anything else counts as the start. */
function parseOffset(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parts = Offset.exec(value.trim());
  if (!parts || (!parts[1] && !parts[2] && !parts[3])) {
    return 0;
  }

  const hours = Number.parseInt(parts[1] ?? '0', 10);
  const minutes = Number.parseInt(parts[2] ?? '0', 10);
  const seconds = Number.parseInt(parts[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * The embed URL for a clip.
 *
 * Clips do not go through the interactive player: Twitch only offers them as a bare iframe, with no scripting
 * interface, so there is nothing to read a position from or seek. The parent parameter is mandatory and must
 * match the hosting page, or Twitch refuses to render the frame.
 */
export function clipEmbedUrl(slug: string, parentHost: string): string {
  const parent = encodeURIComponent(parentHost);
  return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${parent}&autoplay=true`;
}

/**
 * Writes seconds in the 1h2m3s form the embed's initial time option expects.
 *
 * Only the construction option uses this form; the setVideo call takes plain seconds.
 */
export function toTwitchOffset(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return `${hours}h${minutes}m${seconds}s`;
}

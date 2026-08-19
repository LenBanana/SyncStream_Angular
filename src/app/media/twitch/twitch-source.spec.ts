import { clipEmbedUrl, parseTwitchSource, toTwitchOffset } from './twitch-source';

/**
 * Reading a Twitch link.
 *
 * The player is told about a channel and a recording through different calls, and the link is the only thing
 * that says which. Getting this wrong is why Twitch played nothing at all: the old check asked whether the
 * stored value was all digits, but the stored value was the whole URL, so every source was loaded as a video
 * id that happened to be a URL.
 */
describe('parseTwitchSource', () => {
  it('reads a live channel', () => {
    expect(parseTwitchSource('https://www.twitch.tv/somestreamer'))
      .toEqual({ kind: 'channel', id: 'somestreamer', startSeconds: 0 });
  });

  it('reads a recording', () => {
    expect(parseTwitchSource('https://www.twitch.tv/videos/123456789'))
      .toEqual({ kind: 'video', id: '123456789', startSeconds: 0 });
  });

  it('reads where in a recording to start', () => {
    expect(parseTwitchSource('https://www.twitch.tv/videos/123456789?t=1h2m3s'))
      .toEqual({ kind: 'video', id: '123456789', startSeconds: 3723 });
  });

  it('accepts an offset with parts missing', () => {
    expect(parseTwitchSource('https://twitch.tv/videos/1?t=90s')?.startSeconds).toBe(90);
    expect(parseTwitchSource('https://twitch.tv/videos/1?t=5m')?.startSeconds).toBe(300);
    expect(parseTwitchSource('https://twitch.tv/videos/1?t=2h')?.startSeconds).toBe(7200);
  });

  it('ignores an offset it cannot read rather than guessing', () => {
    expect(parseTwitchSource('https://twitch.tv/videos/1?t=garbage')?.startSeconds).toBe(0);
  });

  it('reads a clip on a channel path', () => {
    expect(parseTwitchSource('https://www.twitch.tv/somestreamer/clip/TastySlugName-abc_123'))
      .toEqual({ kind: 'clip', id: 'TastySlugName-abc_123', startSeconds: 0 });
  });

  it('reads a clip on the clips host', () => {
    expect(parseTwitchSource('https://clips.twitch.tv/TastySlugName'))
      .toEqual({ kind: 'clip', id: 'TastySlugName', startSeconds: 0 });
  });

  it('reads a clip that was pasted in its embed form', () => {
    expect(parseTwitchSource('https://clips.twitch.tv/embed?clip=TastySlugName&parent=example.com'))
      .toEqual({ kind: 'clip', id: 'TastySlugName', startSeconds: 0 });
  });

  it('refuses the clip frame with no clip named', () => {
    // Taking the path segment here produces a source called "embed", which the frame then fails to load.
    expect(parseTwitchSource('https://clips.twitch.tv/embed')).toBeNull();
  });

  it('accepts a link with no scheme', () => {
    // Which is how they arrive when someone copies from an address bar that hides it.
    expect(parseTwitchSource('twitch.tv/somestreamer'))
      .toEqual({ kind: 'channel', id: 'somestreamer', startSeconds: 0 });
  });

  it('accepts the mobile host', () => {
    expect(parseTwitchSource('https://m.twitch.tv/videos/42'))
      .toEqual({ kind: 'video', id: '42', startSeconds: 0 });
  });

  it('ignores trailing slashes and extra query parameters', () => {
    expect(parseTwitchSource('https://www.twitch.tv/somestreamer/?referrer=raid'))
      .toEqual({ kind: 'channel', id: 'somestreamer', startSeconds: 0 });
  });

  it('does not mistake a site page for a channel', () => {
    // Otherwise the player is told to load a channel called "directory" and shows an offline screen instead of
    // the link being reported as unplayable.
    expect(parseTwitchSource('https://www.twitch.tv/directory')).toBeNull();
    expect(parseTwitchSource('https://www.twitch.tv/settings')).toBeNull();
  });

  it('refuses links that are not Twitch', () => {
    expect(parseTwitchSource('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseTwitchSource('https://nottwitch.tv/somestreamer')).toBeNull();
    // A host that merely ends with the real one, which a naive contains-check would accept.
    expect(parseTwitchSource('https://evil-twitch.tv/somestreamer')).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(parseTwitchSource(null)).toBeNull();
    expect(parseTwitchSource(undefined)).toBeNull();
    expect(parseTwitchSource('')).toBeNull();
    expect(parseTwitchSource('   ')).toBeNull();
    expect(parseTwitchSource('not a url')).toBeNull();
  });
});

describe('clipEmbedUrl', () => {
  it('names the hosting page as the parent, which Twitch requires', () => {
    // Without a parent matching the page, Twitch refuses to render the frame at all.
    const url = clipEmbedUrl('TastySlugName', 'watch.example.com');

    expect(url).toContain('clip=TastySlugName');
    expect(url).toContain('parent=watch.example.com');
  });

  it('escapes what it puts in the query', () => {
    expect(clipEmbedUrl('a&b=c', 'host')).toContain('clip=a%26b%3Dc');
  });
});

describe('toTwitchOffset', () => {
  it('writes the form the embed expects when it is built', () => {
    // The construction option takes 1h2m3s while the setVideo call takes plain seconds, so the two are not
    // interchangeable.
    expect(toTwitchOffset(3723)).toBe('1h2m3s');
    expect(toTwitchOffset(0)).toBe('0h0m0s');
    expect(toTwitchOffset(59)).toBe('0h0m59s');
  });

  it('survives a value it cannot use', () => {
    expect(toTwitchOffset(-5)).toBe('0h0m0s');
    expect(toTwitchOffset(12.7)).toBe('0h0m12s');
  });
});

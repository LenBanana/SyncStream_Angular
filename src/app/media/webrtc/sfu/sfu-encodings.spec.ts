import {types} from 'mediasoup-client';
import {
  musicAudioOptions,
  simulcastEncodings,
  VideoEncodingRequest,
  videoCodecFor,
  voiceAudioOptions,
  withoutScalabilityModes
} from './sfu-encodings';

/**
 * How a stream is encoded for the SFU.
 *
 * A single layer gave the SFU nothing to adapt with: a viewer on a weak link froze instead of getting a smaller
 * picture, and kept asking the sender for keyframes, which every other viewer paid for.
 */
describe('simulcastEncodings', () => {
  const request = (overrides: Partial<VideoEncodingRequest>): VideoEncodingRequest =>
    ({maxBitrate: 6_000_000, maxHeight: 0, frameRate: 60, contentPreference: 'motion', ...overrides});

  it('sends three layers from 1080p, lowest first', () => {
    const layers = simulcastEncodings(1080, request({}));

    expect(layers.map(layer => layer.rid)).toEqual(['q', 'h', 'f']);
    expect(layers.map(layer => layer.scaleResolutionDownBy)).toEqual([4, 2, 1]);
    expect(layers[2].maxBitrate).toBe(6_000_000);
    expect(layers[0].maxBitrate!).toBeLessThan(layers[1].maxBitrate!);
    expect(layers[1].maxBitrate!).toBeLessThan(layers[2].maxBitrate!);
  });

  it('scales a larger source down to the chosen height before layering', () => {
    const layers = simulcastEncodings(1440, request({maxHeight: 720}));

    // 720p top layer from a 1440p source, plus half of that; no quarter layer below 1080p.
    expect(layers.map(layer => layer.rid)).toEqual(['h', 'f']);
    expect(layers.map(layer => layer.scaleResolutionDownBy)).toEqual([4, 2]);
  });

  it('keeps a small picture as a single layer', () => {
    const layers = simulcastEncodings(480, request({}));

    expect(layers.map(layer => layer.rid)).toEqual(['f']);
  });

  it('never gives a lower layer more bitrate than the top one', () => {
    const layers = simulcastEncodings(1080, request({maxBitrate: 500_000}));

    layers.slice(0, -1).forEach(layer => expect(layer.maxBitrate!).toBeLessThan(500_000));
  });

  it('caps every layer at the chosen frame rate and carries temporal layers', () => {
    const layers = simulcastEncodings(1080, request({frameRate: 30}));

    layers.forEach(layer => {
      expect(layer.maxFramerate).toBe(30);
      expect(layer.scalabilityMode).toBe('L1T3');
    });
  });

  it('leaves the frame rate to the source when none was chosen', () => {
    simulcastEncodings(1080, request({frameRate: 0})).forEach(layer => expect(layer.maxFramerate).toBeUndefined());
  });
});

describe('videoCodecFor', () => {
  const codec = (mimeType: string, parameters: Record<string, string | number> = {}): types.RtpCodecCapability =>
    ({kind: 'video', mimeType, clockRate: 90000, preferredPayloadType: 96, parameters});
  const h264Main = codec('video/H264', {'profile-level-id': '4d0032'});
  const h264Baseline = codec('video/H264', {'profile-level-id': '42e01f'});
  const vp8 = codec('video/VP8');
  const vp9 = codec('video/VP9');

  it('prefers constrained baseline H.264 for motion', () => {
    expect(videoCodecFor([vp8, h264Main, h264Baseline, vp9], 'motion')).toBe(h264Baseline);
  });

  it('takes any H.264 for motion when there is no baseline', () => {
    expect(videoCodecFor([vp8, h264Main], 'motion')).toBe(h264Main);
  });

  it('prefers VP9 for detail', () => {
    expect(videoCodecFor([h264Baseline, vp8, vp9], 'detail')).toBe(vp9);
  });

  it('falls back to VP8 when the preferred codec is missing', () => {
    expect(videoCodecFor([vp8], 'motion')).toBe(vp8);
    expect(videoCodecFor([vp8, h264Baseline], 'detail')).toBe(vp8);
  });
});

describe('withoutScalabilityModes', () => {
  it('keeps the layers but drops the scalability modes', () => {
    const stripped = withoutScalabilityModes({encodings: [{rid: 'q', scalabilityMode: 'L1T3', maxBitrate: 1}]});

    expect(stripped.encodings).toEqual([{rid: 'q', maxBitrate: 1}]);
  });

  it('returns options without scalability modes unchanged', () => {
    const options: types.ProducerOptions = {encodings: [{rid: 'f'}]};
    expect(withoutScalabilityModes(options)).toBe(options);
  });
});

describe('audio options', () => {
  const track = {kind: 'audio'} as MediaStreamTrack;

  it('sends music as 128 kbps stereo without DTX', () => {
    // Chrome encodes Opus at exactly this ceiling; it used to be 510 kbps for every viewer.
    const options = musicAudioOptions(track);
    expect(options.codecOptions).toEqual(jasmine.objectContaining({opusStereo: true, opusDtx: false, opusMaxAverageBitrate: 128_000}));
  });

  it('sends a call microphone as mono speech with DTX', () => {
    const options = voiceAudioOptions(track);
    expect(options.codecOptions).toEqual(jasmine.objectContaining({opusStereo: false, opusDtx: true}));
  });

  it('never lets a producer stop the track it sends', () => {
    // The owner releases capture tracks; a producer closing on a reconnect must not end the person's screen share.
    expect(musicAudioOptions(track).stopTracks).toBe(false);
    expect(voiceAudioOptions(track).stopTracks).toBe(false);
  });
});

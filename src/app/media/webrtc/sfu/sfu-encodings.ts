import {types} from 'mediasoup-client';

export type StreamContentPreference = 'detail' | 'motion';

/** What the sender asked for. Zero means "no limit of my own". */
export interface VideoEncodingRequest {
  /** Bitrate of the top layer, in bps. */
  maxBitrate: number;
  /** Highest height to send. */
  maxHeight: number;
  /** Highest frame rate to send. */
  frameRate: number;
  contentPreference: StreamContentPreference;
}

const DEFAULT_TOP_BITRATE = 6_000_000;
const TEMPORAL_LAYERS = 'L1T3';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function findCodec(
  codecs: types.RtpCodecCapability[],
  mimeType: string,
  predicate?: (codec: types.RtpCodecCapability) => boolean
): types.RtpCodecCapability | undefined {
  return codecs.find(codec =>
    codec.mimeType.toLowerCase() === mimeType.toLowerCase() && (!predicate || predicate(codec)));
}

/**
 * The codec to send video with.
 *
 * Motion prefers H.264, which most machines encode and decode in hardware, Constrained Baseline first because
 * every WebRTC browser decodes it. Detail prefers VP9, whose scalable mode lets each viewer get the resolution their
 * link carries from a single encode. VP8 is what every browser has.
 */
export function videoCodecFor(
  codecs: types.RtpCodecCapability[],
  preference: StreamContentPreference
): types.RtpCodecCapability | undefined {
  if (preference === 'detail') {
    return findCodec(codecs, 'video/vp9') ?? findCodec(codecs, 'video/vp8');
  }
  const constrainedBaseline = (codec: types.RtpCodecCapability) =>
    String(codec.parameters?.['profile-level-id'] ?? '').toLowerCase().startsWith('42e0');
  return findCodec(codecs, 'video/h264', constrainedBaseline)
    ?? findCodec(codecs, 'video/h264')
    ?? findCodec(codecs, 'video/vp8');
}

/**
 * Simulcast layers for one source, lowest first as mediasoup expects.
 *
 * The SFU picks a layer for each viewer from what their link carries, so a viewer on a weak connection drops to a
 * smaller picture instead of freezing, and instead of making the sender's encoder produce keyframes for everyone.
 * A single layer offered none of that. Layers are only added where they are worth having: half resolution from
 * 540p up, a quarter from 1080p up.
 */
export function simulcastEncodings(sourceHeight: number, request: VideoEncodingRequest): types.RtpEncodingParameters[] {
  const top = request.maxBitrate > 0 ? request.maxBitrate : DEFAULT_TOP_BITRATE;
  const targetHeight = request.maxHeight > 0 ? Math.min(request.maxHeight, sourceHeight) : sourceHeight;
  const topScale = sourceHeight / targetHeight;
  const maxFramerate = request.frameRate > 0 ? request.frameRate : undefined;

  const layers: types.RtpEncodingParameters[] = [];
  if (targetHeight >= 1080) {
    layers.push({rid: 'q', scaleResolutionDownBy: round2(topScale * 4), maxBitrate: Math.round(clamp(top * 0.1, 150_000, top * 0.25))});
  }
  if (targetHeight >= 540) {
    layers.push({rid: 'h', scaleResolutionDownBy: round2(topScale * 2), maxBitrate: Math.round(clamp(top * 0.3, 400_000, top * 0.5))});
  }
  layers.push({rid: 'f', scaleResolutionDownBy: round2(topScale), maxBitrate: top});

  return layers.map(layer => ({...layer, scalabilityMode: TEMPORAL_LAYERS, maxFramerate}));
}

function sourceHeightOf(track: MediaStreamTrack, request: VideoEncodingRequest): number {
  const height = track.getSettings().height;
  if (typeof height === 'number' && height > 0) return height;
  return request.maxHeight > 0 ? request.maxHeight : 1080;
}

/** Producer options for a video track. Tracks are never stopped by the producer: their owner releases them. */
export function videoProducerOptions(
  track: MediaStreamTrack,
  codecs: types.RtpCodecCapability[],
  request: VideoEncodingRequest
): types.ProducerOptions {
  const codec = videoCodecFor(codecs, request.contentPreference);
  const top = request.maxBitrate > 0 ? request.maxBitrate : DEFAULT_TOP_BITRATE;
  const options: types.ProducerOptions = {
    track,
    codec,
    stopTracks: false,
    codecOptions: {videoGoogleStartBitrate: Math.max(1000, Math.round(top / 1000))}
  };

  if (codec?.mimeType.toLowerCase() === 'video/vp9') {
    return {
      ...options,
      encodings: [{
        scalabilityMode: 'L3T3_KEY',
        maxBitrate: top,
        maxFramerate: request.frameRate > 0 ? request.frameRate : undefined
      }]
    };
  }

  return {...options, encodings: simulcastEncodings(sourceHeightOf(track, request), request)};
}

/** Encodings without a scalability mode, for browsers that refuse one. */
export function withoutScalabilityModes(options: types.ProducerOptions): types.ProducerOptions {
  if (!options.encodings?.some(encoding => encoding.scalabilityMode)) return options;
  return {
    ...options,
    encodings: options.encodings.map(({scalabilityMode, ...rest}) => rest)
  };
}

/**
 * Producer options for music and film sound: stereo, with in-band error correction, and no DTX, which cuts out
 * during quiet passages. 128 kbps stereo Opus is transparent for music; the encoder targets whatever is set here,
 * so a higher ceiling only costs every viewer bandwidth.
 */
export function musicAudioOptions(track: MediaStreamTrack): types.ProducerOptions {
  return {
    track,
    stopTracks: false,
    codecOptions: {
      opusStereo: true,
      opusFec: true,
      opusDtx: false,
      opusMaxAverageBitrate: 128_000
    }
  };
}

/** Producer options for a microphone in a call: mono speech, with DTX so silence costs next to nothing. */
export function voiceAudioOptions(track: MediaStreamTrack): types.ProducerOptions {
  return {
    track,
    stopTracks: false,
    codecOptions: {
      opusStereo: false,
      opusFec: true,
      opusDtx: true,
      opusMaxAverageBitrate: 48_000
    }
  };
}

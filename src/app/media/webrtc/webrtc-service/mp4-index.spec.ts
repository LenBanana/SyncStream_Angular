import {mp4IndexIsAtEnd} from './mp4-index';

/**
 * A file whose index comes last cannot start streaming before it has fully uploaded. Starting it early anyway is
 * what made ffmpeg fail on a half-uploaded MP4.
 */
describe('mp4IndexIsAtEnd', () => {
  const box = (type: string, payloadBytes = 0): Uint8Array => {
    const bytes = new Uint8Array(8 + payloadBytes);
    new DataView(bytes.buffer).setUint32(0, bytes.length);
    bytes.set([...type].map(c => c.charCodeAt(0)), 4);
    return bytes;
  };
  const largeBox = (type: string, payloadBytes: number): Uint8Array => {
    const bytes = new Uint8Array(16 + payloadBytes);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1);
    bytes.set([...type].map(c => c.charCodeAt(0)), 4);
    view.setUint32(8, 0);
    view.setUint32(12, bytes.length);
    return bytes;
  };
  const file = (...boxes: Uint8Array[]) => new Blob(boxes);

  it('reports an index after the media data', async () => {
    expect(await mp4IndexIsAtEnd(file(box('ftyp', 16), box('mdat', 100), box('moov', 20)), 'clip.mp4')).toBeTrue();
  });

  it('accepts a file whose index comes first', async () => {
    expect(await mp4IndexIsAtEnd(file(box('ftyp', 16), box('moov', 20), box('mdat', 100)), 'clip.mp4')).toBeFalse();
  });

  it('follows 64-bit box sizes', async () => {
    expect(await mp4IndexIsAtEnd(file(box('ftyp', 16), largeBox('free', 40), box('mdat', 10)), 'clip.mov')).toBeTrue();
  });

  it('ignores files that are not MP4 or MOV', async () => {
    expect(await mp4IndexIsAtEnd(file(box('mdat', 10)), 'clip.mkv')).toBeFalse();
  });

  it('stops at something that is not a box', async () => {
    const broken = new Uint8Array(16);
    expect(await mp4IndexIsAtEnd(new Blob([broken]), 'clip.mp4')).toBeFalse();
  });
});

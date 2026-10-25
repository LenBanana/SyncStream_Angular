import {readMkvSubtitles} from './mkv-subtitles';

/**
 * The server burns whatever comes back from here, so the lines have to be the file's own: every one of them, at its
 * time, in its style, numbered the way ffmpeg numbers the subtitle tracks, with the fonts the file carries.
 */
describe('readMkvSubtitles', () => {
  const encoder = new TextEncoder();
  const concat = (parts: (Uint8Array | number[])[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  const idBytes = (id: number): number[] => {
    const bytes: number[] = [];
    for (let value = id; value > 0; value = Math.floor(value / 256)) bytes.unshift(value % 256);
    return bytes;
  };
  const sizeBytes = (size: number): number[] => {
    const bytes = [0x01, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 7, value = size; i >= 1; i--, value = Math.floor(value / 256)) bytes[i] = value % 256;
    return bytes;
  };
  const element = (id: number, ...content: (Uint8Array | number[])[]): Uint8Array => {
    const body = concat(content);
    return concat([idBytes(id), sizeBytes(body.length), body]);
  };
  const unknownSize = (id: number, ...content: (Uint8Array | number[])[]): Uint8Array =>
    concat([idBytes(id), [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], ...content]);
  const uint = (id: number, value: number): Uint8Array => element(id, idBytes(value).length ? idBytes(value) : [0]);
  const str = (id: number, value: string): Uint8Array => element(id, encoder.encode(value));
  const block = (track: number, relative: number, payload: string | number[]): number[] =>
    [0x80 | track, (relative >> 8) & 0xFF, relative & 0xFF, 0x00,
      ...(typeof payload === 'string' ? encoder.encode(payload) : payload)];

  const EBML = 0x1A45DFA3, SEGMENT = 0x18538067, INFO = 0x1549A966, TIMESTAMP_SCALE = 0x2AD7B1;
  const TRACKS = 0x1654AE6B, TRACK_ENTRY = 0xAE, TRACK_NUMBER = 0xD7, TRACK_TYPE = 0x83, CODEC_ID = 0x86;
  const CODEC_PRIVATE = 0x63A2, ATTACHMENTS = 0x1941A469, ATTACHED_FILE = 0x61A7, FILE_NAME = 0x466E;
  const FILE_MIME = 0x4660, FILE_DATA = 0x465C, CLUSTER = 0x1F43B675, TIMESTAMP = 0xE7, SIMPLE_BLOCK = 0xA3;
  const BLOCK_GROUP = 0xA0, BLOCK = 0xA1, BLOCK_DURATION = 0x9B, CUES = 0x1C53BB6B;

  const assHeader = '[Script Info]\r\nScriptType: v4.00+\r\n\r\n[V4+ Styles]\r\nFormat: Name, Fontname\r\n' +
    'Style: Default,Arial\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n';

  const header = (): Uint8Array[] => [element(EBML, str(0x4282, 'matroska'))];
  const segmentStart = (assPrivate: string) => [
    element(INFO, uint(TIMESTAMP_SCALE, 1_000_000)),
    element(TRACKS,
      element(TRACK_ENTRY, uint(TRACK_NUMBER, 1), uint(TRACK_TYPE, 1), str(CODEC_ID, 'V_MPEG4/ISO/AVC')),
      element(TRACK_ENTRY, uint(TRACK_NUMBER, 2), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_TEXT/ASS'),
        str(CODEC_PRIVATE, assPrivate)),
      element(TRACK_ENTRY, uint(TRACK_NUMBER, 3), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_HDMV/PGS')),
      element(TRACK_ENTRY, uint(TRACK_NUMBER, 4), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_TEXT/UTF8'))),
    element(ATTACHMENTS,
      element(ATTACHED_FILE, str(FILE_NAME, 'Font.TTF'), str(FILE_MIME, 'application/x-truetype-font'),
        element(FILE_DATA, [1, 2, 3])),
      element(ATTACHED_FILE, str(FILE_NAME, 'cover.jpg'), str(FILE_MIME, 'image/jpeg'), element(FILE_DATA, [7]))),
  ];
  const clusters = [
    element(CLUSTER, uint(TIMESTAMP, 1000),
      element(SIMPLE_BLOCK, block(1, 0, [9, 9, 9, 9])),
      element(BLOCK_GROUP, element(BLOCK, block(2, 500, '1,0,Default,,0,0,0,,Hello, world')), uint(BLOCK_DURATION, 2000)),
      element(BLOCK_GROUP, element(BLOCK, block(4, 0, 'Line one\r\nLine two')), uint(BLOCK_DURATION, 1500)),
      element(BLOCK_GROUP, element(BLOCK, block(3, 0, [0xFF, 0xFF])), uint(BLOCK_DURATION, 1000))),
    unknownSize(CLUSTER, uint(TIMESTAMP, 10000),
      element(BLOCK_GROUP, element(BLOCK, block(2, 0, '0,0,Default,,0,0,0,,First in read order')), uint(BLOCK_DURATION, 1000))),
    element(CUES, [0]),
  ];

  const mkv = (assPrivate = assHeader): {file: Blob; firstCluster: number} => {
    const before = concat(header());
    const start = segmentStart(assPrivate);
    const segmentBody = concat([...start, ...clusters]);
    const segmentHead = concat([idBytes(SEGMENT), sizeBytes(segmentBody.length)]);
    const firstCluster = before.length + segmentHead.length + concat(start).length;
    return {file: new Blob([before, segmentHead, segmentBody]), firstCluster};
  };
  const contents = (blob: Blob) => blob.text();

  it('reads every text track, numbered among all subtitle tracks, and the attached fonts', async () => {
    const result = await readMkvSubtitles(mkv().file);
    expect(result?.sidecars.map(sidecar => sidecar.name)).toEqual(['subtitle-0.ass', 'subtitle-2.srt', 'font-0.ttf']);
  });

  it('rebuilds ASS lines with their times and styles, in the order the original file had them', async () => {
    const result = await readMkvSubtitles(mkv().file);
    const ass = await contents(result!.sidecars[0].data);
    expect(ass).toContain('[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial');
    expect(ass.endsWith(
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,First in read order\n' +
      'Dialogue: 0,0:00:01.50,0:00:03.50,Default,,0,0,0,,Hello, world\n')).toBeTrue();
  });

  it('writes plain text tracks as SRT', async () => {
    const result = await readMkvSubtitles(mkv().file);
    expect(await contents(result!.sidecars[1].data)).toBe('1\n00:00:01,000 --> 00:00:02,500\nLine one\nLine two\n');
  });

  it('hands over the font data itself', async () => {
    const result = await readMkvSubtitles(mkv().file);
    expect(Array.from(new Uint8Array(await result!.sidecars[2].data.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('adds the events section to a header that lacks one', async () => {
    const result = await readMkvSubtitles(mkv('[Script Info]\nScriptType: v4.00+\n').file);
    const ass = await contents(result!.sidecars[0].data);
    expect(ass).toContain('[Events]\nFormat: Layer, Start, End');
    expect(ass).toContain('Dialogue: 0,0:00:01.50,0:00:03.50,Default,,0,0,0,,Hello, world');
  });

  it('reports where the first cluster starts', async () => {
    const {file, firstCluster} = mkv();
    expect((await readMkvSubtitles(file))?.headerEnd).toBe(firstCluster);
  });

  it('sends nothing for a file without text subtitles, and still reports its header', async () => {
    const body = concat([
      element(TRACKS, element(TRACK_ENTRY, uint(TRACK_NUMBER, 1), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_HDMV/PGS'))),
      element(CLUSTER, uint(TIMESTAMP, 0), element(SIMPLE_BLOCK, block(1, 0, [1])))]);
    const head = concat([...header(), idBytes(SEGMENT), sizeBytes(body.length)]);
    const result = await readMkvSubtitles(new Blob([head, body]));
    expect(result?.sidecars).toEqual([]);
    expect(result?.headerEnd).toBe(head.length + element(TRACKS,
      element(TRACK_ENTRY, uint(TRACK_NUMBER, 1), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_HDMV/PGS'))).length);
  });

  it('reports progress up to the whole file', async () => {
    const seen: number[] = [];
    await readMkvSubtitles(mkv().file, {onProgress: fraction => seen.push(fraction)});
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('stops when told to', async () => {
    expect(await readMkvSubtitles(mkv().file, {keepGoing: () => false})).toBeNull();
  });

  describe('through the cues', () => {
    const SEEK_HEAD = 0x114D9B74, SEEK = 0x4DBB, SEEK_ID = 0x53AB, SEEK_POSITION = 0x53AC, CUE_POINT = 0xBB;
    const CUE_TIME = 0xB3, CUE_TRACK_POSITIONS = 0xB7, CUE_TRACK = 0xF7, CUE_CLUSTER_POSITION = 0xF1;
    const CUE_RELATIVE_POSITION = 0xF0, CUE_DURATION = 0xB2;
    // Fixed width, so a position can be filled in without changing the size of what holds it.
    const uint8 = (id: number, value: number): Uint8Array => {
      const bytes: number[] = [];
      for (let i = 0, rest = value; i < 8; i++, rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
      return element(id, bytes);
    };

    /** A file whose cues index the lines of track 2 and, unless told otherwise, track 4. */
    const indexed = (indexTrack4 = true): Blob => {
      const timestamp = uint(TIMESTAMP, 1000);
      const assLine = element(BLOCK_GROUP, element(BLOCK, block(2, 500, '0,0,Default,,0,0,0,,Indexed line')),
        uint(BLOCK_DURATION, 2000));
      const srtLine = element(BLOCK_GROUP, element(BLOCK, block(4, 1000, 'Plain line')), uint(BLOCK_DURATION, 1000));
      const video = element(SIMPLE_BLOCK, block(1, 0, [9, 9]));
      const cluster = element(CLUSTER, timestamp, video, assLine, srtLine);

      const tracks = element(TRACKS,
        element(TRACK_ENTRY, uint(TRACK_NUMBER, 1), uint(TRACK_TYPE, 1), str(CODEC_ID, 'V_MPEG4/ISO/AVC')),
        element(TRACK_ENTRY, uint(TRACK_NUMBER, 2), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_TEXT/ASS'),
          str(CODEC_PRIVATE, assHeader)),
        element(TRACK_ENTRY, uint(TRACK_NUMBER, 4), uint(TRACK_TYPE, 17), str(CODEC_ID, 'S_TEXT/UTF8')));
      const seekHead = (cuesAt: number) =>
        element(SEEK_HEAD, element(SEEK, element(SEEK_ID, idBytes(CUES)), uint8(SEEK_POSITION, cuesAt)));
      const clusterAt = seekHead(0).length + tracks.length;
      const cuesAt = clusterAt + cluster.length;
      const clusterHeader = 12;
      const cuePoint = (time: number, track: number, relative: number, duration: number) =>
        element(CUE_POINT, uint(CUE_TIME, time), element(CUE_TRACK_POSITIONS, uint(CUE_TRACK, track),
          uint(CUE_CLUSTER_POSITION, clusterAt), uint(CUE_RELATIVE_POSITION, relative), uint(CUE_DURATION, duration)));
      const cues = element(CUES,
        cuePoint(1500, 2, timestamp.length + video.length, 2000),
        ...(indexTrack4 ? [cuePoint(2000, 4, timestamp.length + video.length + assLine.length, 1000)] : []));
      expect(cluster.length - clusterHeader).toBe(timestamp.length + video.length + assLine.length + srtLine.length);

      const body = concat([seekHead(cuesAt), tracks, cluster, cues]);
      return new Blob([concat([...header(), idBytes(SEGMENT), sizeBytes(body.length)]), body]);
    };

    it('finds every indexed line', async () => {
      const result = await readMkvSubtitles(indexed());
      expect(await contents(result!.sidecars[0].data)).toContain(
        'Dialogue: 0,0:00:01.50,0:00:03.50,Default,,0,0,0,,Indexed line');
      expect(await contents(result!.sidecars[1].data)).toBe('1\n00:00:02,000 --> 00:00:03,000\nPlain line\n');
    });

    it('reads the clusters instead when the cues leave a text track out', async () => {
      const result = await readMkvSubtitles(indexed(false));
      expect(result?.sidecars.map(sidecar => sidecar.name)).toEqual(['subtitle-0.ass', 'subtitle-1.srt']);
      expect(await contents(result!.sidecars[1].data)).toBe('1\n00:00:02,000 --> 00:00:03,000\nPlain line\n');
    });
  });

  it('ignores files that are not Matroska', async () => {
    expect(await readMkvSubtitles(new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])]))).toBeNull();
  });
});

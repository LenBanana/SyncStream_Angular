/**
 * Reads the text subtitle tracks and the attached fonts out of a Matroska file (MKV, WebM), for the server to burn
 * into an RTMP share.
 *
 * ffmpeg's subtitles filter collects every line from its file once, as it starts, and a share starts as soon as the
 * beginning of its upload has arrived: pointed at the upload, the filter found almost nothing, and nothing was ever
 * burned in. The browser has the whole file, so it reads the tracks out itself and sends them ahead of the share.
 *
 * Lines are spread through the file next to the frames they belong to. Most releases index every subtitle line in
 * the file's cues, so only those lines are read; a file without that index is read from end to end, skipping
 * everything but the lines.
 */

/** A file sent alongside the upload: subtitle-<n>.ass/.srt for subtitle track n as ffmpeg counts them, or a font. */
export interface SubtitleSidecar {
  name: string;
  data: Blob;
}

export interface MkvSubtitles {
  sidecars: SubtitleSidecar[];
  /**
   * Where the first cluster starts. ffmpeg cannot open the file before everything up to here (track list, fonts)
   * has arrived, so the share's first upload should reach at least this far.
   */
  headerEnd: number | null;
}

export interface MkvReadOptions {
  /** Called with how much of the work is done, from 0 to 1. */
  onProgress?: (fraction: number) => void;
  /** Checked as the file is read; reading stops once it returns false. */
  keepGoing?: () => boolean;
}

const ID = {
  EBML: 0x1A45DFA3,
  Segment: 0x18538067,
  SeekHead: 0x114D9B74,
  Seek: 0x4DBB,
  SeekID: 0x53AB,
  SeekPosition: 0x53AC,
  Info: 0x1549A966,
  TimestampScale: 0x2AD7B1,
  Tracks: 0x1654AE6B,
  TrackEntry: 0xAE,
  TrackNumber: 0xD7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63A2,
  DefaultDuration: 0x23E383,
  Attachments: 0x1941A469,
  AttachedFile: 0x61A7,
  FileName: 0x466E,
  FileMimeType: 0x4660,
  FileData: 0x465C,
  Cluster: 0x1F43B675,
  Timestamp: 0xE7,
  SimpleBlock: 0xA3,
  BlockGroup: 0xA0,
  Block: 0xA1,
  BlockDuration: 0x9B,
  Cues: 0x1C53BB6B,
  CuePoint: 0xBB,
  CueTime: 0xB3,
  CueTrackPositions: 0xB7,
  CueTrack: 0xF7,
  CueClusterPosition: 0xF1,
  CueRelativePosition: 0xF0,
  CueDuration: 0xB2,
};

/** Elements that only appear directly in a Segment; one of them ends a cluster whose size is unknown. */
const SEGMENT_CHILDREN = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Attachments, ID.Cluster, ID.Cues, 0x1043A770,
  0x1254C367, ID.Segment]);

const SUBTITLE_TRACK = 17;
const ASS_CODECS = new Set(['S_TEXT/ASS', 'S_TEXT/SSA', 'S_ASS', 'S_SSA']);
const PLAIN_CODECS = new Set(['S_TEXT/UTF8', 'S_TEXT/ASCII', 'S_TEXT/WEBVTT']);
const DEFAULT_LINE_MS = 5000;
/** Read-ahead while going through the file in order. */
const SEQUENTIAL_WINDOW = 16 * 1024 * 1024;
/** Enough for a cluster's header or one subtitle line, when jumping to them through the index. */
const RANDOM_WINDOW = 16 * 1024;

interface Element {
  id: number;
  dataStart: number;
  /** Null when the size is unknown, which only a Segment or a Cluster written live may have. */
  end: number | null;
}

interface Line {
  startMs: number;
  endMs: number;
  payload: string;
}

interface TextTrack {
  number: number;
  /** Position among the file's subtitle tracks, which is how ffmpeg addresses them (0:s:<ordinal>). */
  ordinal: number;
  kind: 'ass' | 'srt';
  header: string;
  defaultDurationMs: number | null;
  lines: Line[];
}

const text = new TextDecoder('utf-8');

/** Reads a Blob through a window of a set size, reloaded whenever a read falls outside it. */
class Reader {
  private window = new Uint8Array(0);
  private windowStart = 0;

  constructor(readonly file: Blob, private readonly windowSize: number) {}

  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.file.size, offset + length);
    if (offset < this.windowStart || end > this.windowStart + this.window.length) {
      const windowEnd = Math.min(this.file.size, offset + Math.max(length, this.windowSize));
      this.window = new Uint8Array(await this.file.slice(offset, windowEnd).arrayBuffer());
      this.windowStart = offset;
    }
    return this.window.subarray(offset - this.windowStart, end - this.windowStart);
  }

  async element(offset: number): Promise<Element | null> {
    const bytes = await this.bytes(offset, 12);
    const idLength = vintLength(bytes[0]);
    if (bytes.length < 2 || idLength === 0 || idLength > 4) return null;
    const sizeLength = vintLength(bytes[idLength]);
    if (sizeLength === 0 || bytes.length < idLength + sizeLength) return null;

    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + bytes[i];
    const mask = 0xFF >> sizeLength;
    let size = bytes[idLength] & mask;
    let unknown = size === mask;
    for (let i = 1; i < sizeLength; i++) {
      size = size * 256 + bytes[idLength + i];
      unknown = unknown && bytes[idLength + i] === 0xFF;
    }
    const dataStart = offset + idLength + sizeLength;
    return {id, dataStart, end: unknown ? null : dataStart + size};
  }

  async children(parent: Element): Promise<Element[]> {
    const found: Element[] = [];
    let offset = parent.dataStart;
    while (parent.end !== null && offset < parent.end) {
      const child = await this.element(offset);
      if (!child || child.end === null) break;
      found.push(child);
      offset = child.end;
    }
    return found;
  }

  async uint(element: Element): Promise<number> {
    let value = 0;
    for (const byte of await this.bytes(element.dataStart, (element.end ?? element.dataStart) - element.dataStart)) {
      value = value * 256 + byte;
    }
    return value;
  }

  async string(element: Element): Promise<string> {
    return text.decode(await this.bytes(element.dataStart, (element.end ?? element.dataStart) - element.dataStart))
      .replace(/\0+$/, '');
  }
}

function vintLength(firstByte: number | undefined): number {
  if (firstByte === undefined) return 0;
  for (let length = 1; length <= 8; length++) {
    if (firstByte & (0x80 >> (length - 1))) return length;
  }
  return 0;
}

/**
 * The file's text subtitle tracks, ready to send, and where its header ends. Null when the file is not Matroska,
 * or when reading was stopped.
 */
export async function readMkvSubtitles(file: Blob, options: MkvReadOptions = {}): Promise<MkvSubtitles | null> {
  const keepGoing = () => !options.keepGoing || options.keepGoing();
  const reader = new Reader(file, SEQUENTIAL_WINDOW);
  const ebml = await reader.element(0);
  if (!ebml || ebml.id !== ID.EBML || ebml.end === null) return null;
  const segment = await reader.element(ebml.end);
  if (!segment || segment.id !== ID.Segment) return null;
  const segmentEnd = Math.min(segment.end ?? file.size, file.size);

  let timestampScale = 1_000_000;
  let tracks: TextTrack[] | null = null;
  const fonts: SubtitleSidecar[] = [];
  let fontsRead = false;
  const located = new Map<number, number>();
  let headerEnd: number | null = null;
  let reported = 0;

  let offset = segment.dataStart;
  while (offset < segmentEnd) {
    if (!keepGoing()) return null;
    const element = await reader.element(offset);
    if (!element) break;

    if (element.id === ID.Cluster) {
      if (headerEnd === null) {
        headerEnd = offset;
        // With no text subtitles there is nothing in the clusters worth reading.
        if (tracks !== null && tracks.length === 0) break;
        if (tracks !== null && await readThroughCues(file, segment.dataStart, located, tracks, timestampScale, options)) {
          if (!fontsRead && located.has(ID.Attachments)) {
            const attachments = await reader.element(located.get(ID.Attachments)!);
            if (attachments?.id === ID.Attachments) fonts.push(...await readFonts(reader, attachments, 0));
          }
          break;
        }
        if (!keepGoing()) return null;
      }
      offset = await readCluster(reader, element, tracks ?? [], timestampScale);
    } else {
      if (element.end === null) break;
      if (element.id === ID.SeekHead) {
        for (const [id, position] of await readSeekHead(reader, element)) located.set(id, segment.dataStart + position);
      } else if (element.id === ID.Info) {
        timestampScale = await readTimestampScale(reader, element) ?? timestampScale;
      } else if (element.id === ID.Tracks) {
        tracks = await readTracks(reader, element);
      } else if (element.id === ID.Attachments) {
        fonts.push(...await readFonts(reader, element, fonts.length));
        fontsRead = true;
      }
      offset = element.end;
    }

    const fraction = offset / file.size;
    if (options.onProgress && fraction - reported >= 0.005) {
      reported = fraction;
      options.onProgress(fraction);
    }
  }
  options.onProgress?.(1);

  const sidecars: SubtitleSidecar[] = (tracks ?? [])
    .filter(track => track.lines.length > 0)
    .map(track => ({
      name: `subtitle-${track.ordinal}.${track.kind}`,
      data: new Blob([track.kind === 'ass' ? assFile(track) : srtFile(track)], {type: 'text/plain'})
    }));
  return {sidecars: sidecars.length > 0 ? [...sidecars, ...fonts] : [], headerEnd};
}

async function readSeekHead(reader: Reader, seekHead: Element): Promise<[number, number][]> {
  const found: [number, number][] = [];
  for (const seek of await reader.children(seekHead)) {
    if (seek.id !== ID.Seek) continue;
    let id: number | null = null;
    let position: number | null = null;
    for (const field of await reader.children(seek)) {
      if (field.id === ID.SeekID) id = await reader.uint(field);
      else if (field.id === ID.SeekPosition) position = await reader.uint(field);
    }
    if (id !== null && position !== null) found.push([id, position]);
  }
  return found;
}

async function readTimestampScale(reader: Reader, info: Element): Promise<number | null> {
  const scale = (await reader.children(info)).find(child => child.id === ID.TimestampScale);
  return scale ? reader.uint(scale) : null;
}

async function readTracks(reader: Reader, tracksElement: Element): Promise<TextTrack[]> {
  const found: TextTrack[] = [];
  let subtitleOrdinal = 0;
  for (const entry of await reader.children(tracksElement)) {
    if (entry.id !== ID.TrackEntry) continue;
    let number = 0, type = 0, codec = '', header = '', defaultDurationNs: number | null = null;
    for (const field of await reader.children(entry)) {
      if (field.id === ID.TrackNumber) number = await reader.uint(field);
      else if (field.id === ID.TrackType) type = await reader.uint(field);
      else if (field.id === ID.CodecID) codec = await reader.string(field);
      else if (field.id === ID.CodecPrivate) header = await reader.string(field);
      else if (field.id === ID.DefaultDuration) defaultDurationNs = await reader.uint(field);
    }
    if (type !== SUBTITLE_TRACK) continue;

    const ordinal = subtitleOrdinal++;
    const kind = ASS_CODECS.has(codec) ? 'ass' : PLAIN_CODECS.has(codec) ? 'srt' : null;
    if (kind) {
      found.push({number, ordinal, kind, header,
        defaultDurationMs: defaultDurationNs !== null ? defaultDurationNs / 1e6 : null, lines: []});
    }
  }
  return found;
}

async function readFonts(reader: Reader, attachments: Element, alreadyFound: number): Promise<SubtitleSidecar[]> {
  const fonts: SubtitleSidecar[] = [];
  for (const attached of await reader.children(attachments)) {
    if (attached.id !== ID.AttachedFile) continue;
    let name = '', mime = '', data: Element | null = null;
    for (const field of await reader.children(attached)) {
      if (field.id === ID.FileName) name = await reader.string(field);
      else if (field.id === ID.FileMimeType) mime = await reader.string(field);
      else if (field.id === ID.FileData) data = field;
    }
    const extension = name.toLowerCase().match(/\.(ttf|otf|ttc)$/)?.[1]
      ?? (/font|truetype|opentype/i.test(mime) ? 'ttf' : null);
    if (!extension || !data || data.end === null) continue;
    fonts.push({name: `font-${alreadyFound + fonts.length}.${extension}`, data: reader.file.slice(data.dataStart, data.end)});
  }
  return fonts;
}

interface Cue {
  track: TextTrack;
  timestamp: number;
  cluster: number;
  relative: number;
  duration: number | null;
}

/**
 * Collects the lines through the file's cues, which point straight at each one. False when they do not index every
 * text track with exact positions, which leaves reading the clusters; nothing is kept from a partial attempt.
 */
async function readThroughCues(file: Blob, segmentStart: number, located: Map<number, number>, tracks: TextTrack[],
                               timestampScale: number, options: MkvReadOptions): Promise<boolean> {
  const cuesOffset = located.get(ID.Cues);
  if (cuesOffset === undefined || cuesOffset >= file.size) return false;
  const reader = new Reader(file, RANDOM_WINDOW);
  const cues = await reader.element(cuesOffset);
  if (!cues || cues.id !== ID.Cues || cues.end === null) return false;
  await reader.bytes(cues.dataStart, cues.end - cues.dataStart);

  const byNumber = new Map(tracks.map(track => [track.number, track]));
  const found: Cue[] = [];
  const seen = new Set<string>();
  for (const point of await reader.children(cues)) {
    if (point.id !== ID.CuePoint) continue;
    let timestamp: number | null = null;
    const positions: Element[] = [];
    for (const field of await reader.children(point)) {
      if (field.id === ID.CueTime) timestamp = await reader.uint(field);
      else if (field.id === ID.CueTrackPositions) positions.push(field);
    }
    for (const position of positions) {
      let number = 0, cluster: number | null = null, relative: number | null = null, duration: number | null = null;
      for (const field of await reader.children(position)) {
        if (field.id === ID.CueTrack) number = await reader.uint(field);
        else if (field.id === ID.CueClusterPosition) cluster = await reader.uint(field);
        else if (field.id === ID.CueRelativePosition) relative = await reader.uint(field);
        else if (field.id === ID.CueDuration) duration = await reader.uint(field);
      }
      const track = byNumber.get(number);
      if (!track || timestamp === null || cluster === null) continue;
      if (relative === null) return false;
      const key = `${cluster}:${relative}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({track, timestamp, cluster, relative, duration});
    }
  }
  if (tracks.some(track => !found.some(cue => cue.track === track))) return false;

  found.sort((a, b) => a.cluster - b.cluster || a.relative - b.relative);
  const lines = new Map<TextTrack, Line[]>(tracks.map(track => [track, []]));
  const clusterData = new Map<number, number>();
  for (const [index, cue] of found.entries()) {
    if (options.keepGoing && !options.keepGoing()) return false;
    let dataStart = clusterData.get(cue.cluster);
    if (dataStart === undefined) {
      const cluster = await reader.element(segmentStart + cue.cluster);
      if (!cluster || cluster.id !== ID.Cluster) return false;
      dataStart = cluster.dataStart;
      clusterData.set(cue.cluster, dataStart);
    }

    const element = await reader.element(dataStart + cue.relative);
    if (!element) return false;
    let block: Element | null = null;
    let duration = cue.duration;
    if (element.id === ID.SimpleBlock) {
      block = element;
    } else if (element.id === ID.BlockGroup) {
      for (const part of await reader.children(element)) {
        if (part.id === ID.Block) block = part;
        else if (part.id === ID.BlockDuration) duration = await reader.uint(part);
      }
    }
    const content = block && await readBlock(reader, block, byNumber);
    if (!content || content.track !== cue.track) return false;

    const startMs = cue.timestamp * timestampScale / 1e6;
    const lengthMs = duration !== null ? duration * timestampScale / 1e6 : cue.track.defaultDurationMs ?? DEFAULT_LINE_MS;
    lines.get(cue.track)!.push({startMs, endMs: startMs + lengthMs, payload: content.payload});
    options.onProgress?.((index + 1) / found.length);
  }

  for (const [track, trackLines] of lines) track.lines = trackLines;
  return true;
}

/** Collects the lines of the text tracks in one cluster. Returns where the cluster ends. */
async function readCluster(reader: Reader, cluster: Element, tracks: TextTrack[], timestampScale: number): Promise<number> {
  const byNumber = new Map(tracks.map(track => [track.number, track]));
  const end = Math.min(cluster.end ?? reader.file.size, reader.file.size);
  let clusterTimestamp = 0;
  let offset = cluster.dataStart;

  while (offset < end) {
    const child = await reader.element(offset);
    if (!child) return end;
    // A cluster of unknown size runs until the next element that belongs to the Segment.
    if (cluster.end === null && SEGMENT_CHILDREN.has(child.id)) return offset;
    if (child.end === null) return end;

    let block: Element | null = null;
    let duration: number | null = null;
    if (child.id === ID.Timestamp) {
      clusterTimestamp = await reader.uint(child);
    } else if (child.id === ID.SimpleBlock) {
      block = child;
    } else if (child.id === ID.BlockGroup) {
      for (const part of await reader.children(child)) {
        if (part.id === ID.Block) block = part;
        else if (part.id === ID.BlockDuration) duration = await reader.uint(part);
      }
    }

    const content = block && await readBlock(reader, block, byNumber);
    if (content) {
      const startMs = (clusterTimestamp + content.relative) * timestampScale / 1e6;
      const lengthMs = duration !== null
        ? duration * timestampScale / 1e6
        : content.track.defaultDurationMs ?? DEFAULT_LINE_MS;
      content.track.lines.push({startMs, endMs: startMs + lengthMs, payload: content.payload});
    }
    offset = child.end;
  }
  return end;
}

/** A block's line, when it belongs to one of the text tracks. */
async function readBlock(reader: Reader, block: Element, tracks: Map<number, TextTrack>)
  : Promise<{track: TextTrack; relative: number; payload: string} | null> {
  if (tracks.size === 0 || block.end === null) return null;
  const head = await reader.bytes(block.dataStart, 12);
  const numberLength = vintLength(head[0]);
  if (numberLength === 0 || head.length < numberLength + 3) return null;
  let number = head[0] & (0xFF >> numberLength);
  for (let i = 1; i < numberLength; i++) number = number * 256 + head[i];
  const track = tracks.get(number);
  if (!track) return null;

  // Subtitle blocks are never laced; one that is cannot be split back into lines here.
  const flags = head[numberLength + 2];
  if (flags & 0x06) return null;

  const relative = new DataView(head.buffer, head.byteOffset + numberLength, 2).getInt16(0);
  const payloadStart = block.dataStart + numberLength + 3;
  const payload = text.decode(await reader.bytes(payloadStart, block.end - payloadStart));
  return {track, relative, payload};
}

/**
 * An ASS file from a Matroska track: the track's header holds everything but the events, and each block holds
 * "ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text" without the times, which come from the
 * block. Lines go back in ReadOrder, the order the original file had them in.
 */
function assFile(track: TextTrack): string {
  let header = track.header.replace(/\r\n?/g, '\n').trimEnd();
  if (!/^\[Events\]/m.test(header)) {
    header += '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
  }
  const lines = track.lines
    .map(line => ({line, fields: splitFields(line.payload, 9)}))
    .filter(entry => entry.fields.length === 9)
    .map(({line, fields}) => ({
      order: Number(fields[0]),
      dialogue: `Dialogue: ${fields[1]},${assTime(line.startMs)},${assTime(line.endMs)},${fields.slice(2).join(',')}`
    }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.dialogue.replace(/\r?\n/g, '\\N'));
  return `${header}\n${lines.join('\n')}\n`;
}

function srtFile(track: TextTrack): string {
  return [...track.lines]
    .sort((a, b) => a.startMs - b.startMs)
    .map((line, index) =>
      `${index + 1}\n${srtTime(line.startMs)} --> ${srtTime(line.endMs)}\n${line.payload.replace(/\r\n?/g, '\n').trim()}\n`)
    .join('\n');
}

/** Splits at the first count - 1 commas; the last field (the text) may hold commas of its own. */
function splitFields(value: string, count: number): string[] {
  const fields: string[] = [];
  let rest = value;
  while (fields.length < count - 1) {
    const comma = rest.indexOf(',');
    if (comma < 0) break;
    fields.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  fields.push(rest);
  return fields;
}

function assTime(ms: number): string {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centiseconds % 100, 2)}`;
}

function srtTime(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const hours = Math.floor(whole / 3600000);
  const minutes = Math.floor(whole / 60000) % 60;
  const seconds = Math.floor(whole / 1000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(whole % 1000, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

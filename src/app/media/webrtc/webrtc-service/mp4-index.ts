/**
 * Whether an MP4 or MOV keeps its index (the moov box) after the media data (mdat).
 *
 * Such a file cannot be played from its beginning alone, so it cannot be streamed while it is still uploading: the
 * whole of it has to arrive first. Only the top-level box headers are read, a few bytes each.
 */
export async function mp4IndexIsAtEnd(file: Blob, name: string): Promise<boolean> {
  if (!/\.(mp4|m4v|mov|3gp)$/i.test(name)) return false;

  let offset = 0;
  while (offset + 8 <= file.size) {
    const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    const type = String.fromCharCode(header.getUint8(4), header.getUint8(5), header.getUint8(6), header.getUint8(7));
    if (type === 'moov') return false;
    if (type === 'mdat') return true;

    let size = header.getUint32(0);
    // A size of 1 means a 64-bit size follows the type.
    if (size === 1 && header.byteLength >= 16) size = header.getUint32(8) * 2 ** 32 + header.getUint32(12);
    // A box with no size runs to the end of the file; anything smaller than a header is not a box at all.
    if (size === 0 || size < 8) return false;
    offset += size;
  }
  return false;
}

/**
 * A dependency-free reader for the gzipped-tar form every FHIR package registry publishes.
 *
 * Third-party runtime deps are zero here and this change adds no dev dependency either, so the
 * archive is opened with `node:zlib` and a hand-written USTAR walk rather than a tar library. The
 * format is small and the subset a FHIR package uses is smaller still: one flat `package/`
 * directory of regular files, no links, no sparse entries.
 *
 * ▶ THIS READER NEVER WRITES TO DISK, and that is the security property that matters. It returns
 * bytes keyed by the archive's own entry name; nothing joins that name to a filesystem path, so the
 * `../` traversal and absolute-path classes that make tar extraction dangerous cannot arise. An
 * entry name is data, not a destination.
 *
 * ▶ AND IT REFUSES WHAT IT CANNOT READ RATHER THAN SKIPPING IT. An unknown type flag, a size field
 * that is not octal, or a truncated archive throws {@link TarFormatError}. A tar walk that silently
 * skipped an entry it did not understand would report a package as read when part of it was never
 * seen, which is the same false-clean shape the fail-safe rule exists to refuse.
 */

import { gunzipSync } from "node:zlib";

/** One block of the tar stream. Every offset below is an index into a block of exactly this size. */
const BLOCK = 512;

/** Header field offsets (POSIX ustar, `tar(5)`). */
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const MAGIC_LENGTH = 6;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;

/** Thrown when the archive is not a tar this reader can account for, entry by entry. */
export class TarFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarFormatError";
  }
}

/** A NUL-terminated header string field. */
function headerString(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  return (nul < 0 ? raw : raw.subarray(0, nul)).toString("utf8");
}

/** The octal size field. Refuses anything that is not a plain octal run. */
function headerSize(header: Buffer): number {
  const field = headerString(header, SIZE_OFFSET, SIZE_LENGTH).trim();
  if (!/^[0-7]+$/.test(field)) {
    throw new TarFormatError(
      `refusing the archive: a tar header carries a size field that is not octal, so the entry ` +
        `boundaries after it cannot be trusted.`,
    );
  }
  const size = Number.parseInt(field, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TarFormatError(`refusing the archive: a tar header carries an unusable size.`);
  }
  return size;
}

/** Round a payload length up to whole 512-byte blocks. */
function padded(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

/**
 * Read a gzipped tar into `entry name -> bytes`, for regular files only.
 *
 * Directory entries carry no payload and are dropped; a `pax`/GNU extended header contributes its
 * long path to the entry that follows it. Any other type flag is refused rather than skipped.
 *
 * @param archive - The raw `.tgz` bytes.
 * @returns Every regular file in the archive, keyed by its full entry name.
 * @throws TarFormatError when the archive is truncated, or carries an entry this reader cannot
 *   account for.
 */
export function readGzippedTar(archive: Buffer): Map<string, Buffer> {
  let buf: Buffer;
  try {
    buf = gunzipSync(archive);
  } catch (err) {
    throw new TarFormatError(
      `refusing the archive: it is not readable as gzip (${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  const files = new Map<string, Buffer>();
  let offset = 0;
  /** A `pax`/GNU long-name header sets this for the single entry that follows it. */
  let pendingName: string | undefined;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    // Two consecutive all-zero blocks end the archive; one is enough to stop reading entries.
    if (header.every((b) => b === 0)) break;

    const magic = headerString(header, MAGIC_OFFSET, MAGIC_LENGTH).trim();
    if (magic !== "ustar" && magic !== "") {
      throw new TarFormatError(
        `refusing the archive: unrecognised tar magic ${JSON.stringify(magic)}.`,
      );
    }

    const size = headerSize(header);
    const bodyStart = offset + BLOCK;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buf.length) {
      throw new TarFormatError(
        `refusing the archive: it is truncated, so at least one entry's bytes are missing.`,
      );
    }
    const body = buf.subarray(bodyStart, bodyEnd);
    const typeflag = String.fromCharCode(header[TYPEFLAG_OFFSET] ?? 0);
    const prefix = headerString(header, PREFIX_OFFSET, PREFIX_LENGTH);
    const shortName = headerString(header, NAME_OFFSET, NAME_LENGTH);
    const name = pendingName ?? (prefix.length > 0 ? `${prefix}/${shortName}` : shortName);
    pendingName = undefined;

    switch (typeflag) {
      case "0":
      case "\0":
      case "7":
        files.set(name, Buffer.from(body));
        break;
      case "5":
        break;
      case "L":
        // GNU long name: the payload IS the next entry's path.
        pendingName = body.toString("utf8").replace(/\0+$/, "");
        break;
      case "x":
      case "X": {
        // pax extended header: `<len> path=<value>\n` records. Only `path` is read.
        const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
        if (record?.[1] !== undefined) pendingName = record[1];
        break;
      }
      case "g":
        // A global pax header applies to every following entry; none of the fields this reader
        // consumes can be set globally in practice, so it carries nothing and is dropped.
        break;
      default:
        throw new TarFormatError(
          `refusing the archive: entry ${JSON.stringify(name)} has type flag ` +
            `${JSON.stringify(typeflag)}, which this reader cannot account for. Skipping it would ` +
            `report the package as read when part of it was never seen.`,
        );
    }

    offset = bodyStart + padded(size);
  }

  if (files.size === 0) {
    throw new TarFormatError(`refusing the archive: it contains no regular files.`);
  }
  return files;
}

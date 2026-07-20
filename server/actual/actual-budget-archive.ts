import { crc32, inflateRawSync } from "node:zlib";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const ZIP_FLAG_ENCRYPTED = 0x1;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x8;

export const MAX_ACTUAL_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ACTUAL_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ACTUAL_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ACTUAL_ARCHIVE_ENTRIES = 128;
const SAFE_ACTUAL_BUDGET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface ActualArchiveEntry {
  name: string;
  flags: number;
  compressionMethod: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  compressedDataOffset: number;
}

export interface ActualBudgetArchive {
  database: Buffer;
  metadata: Buffer;
}

function unsafeArchive(reason: string): Error {
  return Object.assign(new Error(`Actual Budget archive is unsafe: ${reason}`), { status: 502 });
}

export function validateActualBudgetId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ACTUAL_BUDGET_ID.test(value)) {
    throw unsafeArchive("invalid budget identifier");
  }
  return value;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 22 - ZIP64_UINT16);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  throw unsafeArchive("missing central directory");
}

function parseActualBudgetArchive(archive: Buffer): ActualArchiveEntry[] {
  if (archive.length > MAX_ACTUAL_ARCHIVE_BYTES) {
    throw unsafeArchive("download size limit exceeded");
  }
  if (archive.length < 22) throw unsafeArchive("missing central directory");

  const endOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw unsafeArchive("multi-disk ZIP files are not supported");
  }
  if (
    entryCount === ZIP64_UINT16
    || centralDirectorySize === ZIP64_UINT32
    || centralDirectoryOffset === ZIP64_UINT32
  ) {
    throw unsafeArchive("ZIP64 files are not supported");
  }
  if (entryCount > MAX_ACTUAL_ARCHIVE_ENTRIES) {
    throw unsafeArchive("entry count limit exceeded");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset > endOffset
    || centralDirectoryEnd > endOffset
    || centralDirectoryEnd < centralDirectoryOffset
  ) {
    throw unsafeArchive("invalid central directory bounds");
  }

  const entries: ActualArchiveEntry[] = [];
  let offset = centralDirectoryOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw unsafeArchive("invalid central directory entry");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);

    if (
      compressedSize === ZIP64_UINT32
      || uncompressedSize === ZIP64_UINT32
      || localHeaderOffset === ZIP64_UINT32
    ) {
      throw unsafeArchive("ZIP64 entries are not supported");
    }
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) throw unsafeArchive("encrypted entries are not supported");
    if ((flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
      throw unsafeArchive("data descriptors are not supported");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw unsafeArchive("unsupported compression method");
    }
    if (uncompressedSize > MAX_ACTUAL_ARCHIVE_ENTRY_BYTES) {
      throw unsafeArchive("entry expanded size limit exceeded");
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_ACTUAL_ARCHIVE_EXPANDED_BYTES) {
      throw unsafeArchive("total expanded size limit exceeded");
    }

    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (nextOffset > centralDirectoryEnd || nextOffset < offset) {
      throw unsafeArchive("invalid central directory entry bounds");
    }
    if (
      localHeaderOffset + 30 > centralDirectoryOffset
      || archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER
    ) {
      throw unsafeArchive("invalid local file header");
    }

    const localFlags = archive.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = archive.readUInt16LE(localHeaderOffset + 8);
    const localChecksum = archive.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localHeaderOffset + 22);
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const centralNameStart = offset + 46;
    const centralName = archive.subarray(centralNameStart, centralNameStart + fileNameLength);
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localFileNameLength;
    if (localNameEnd > centralDirectoryOffset) {
      throw unsafeArchive("invalid local file header bounds");
    }
    const localName = archive.subarray(localNameStart, localNameEnd);
    if (
      localFlags !== flags
      || localCompressionMethod !== compressionMethod
      || localChecksum !== checksum
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize
      || !localName.equals(centralName)
    ) {
      throw unsafeArchive("local file header does not match central directory");
    }

    const compressedDataOffset = localNameEnd + localExtraLength;
    const compressedDataEnd = compressedDataOffset + compressedSize;
    if (compressedDataEnd > centralDirectoryOffset || compressedDataEnd < compressedDataOffset) {
      throw unsafeArchive("compressed entry exceeds archive bounds");
    }

    entries.push({
      name: centralName.toString("utf8"),
      flags,
      compressionMethod,
      checksum,
      compressedSize,
      uncompressedSize,
      compressedDataOffset,
    });
    offset = nextOffset;
  }

  if (offset !== centralDirectoryEnd) {
    throw unsafeArchive("central directory size does not match its entries");
  }
  return entries;
}

function readEntry(archive: Buffer, entry: ActualArchiveEntry): Buffer {
  const compressed = archive.subarray(
    entry.compressedDataOffset,
    entry.compressedDataOffset + entry.compressedSize,
  );
  let expanded: Buffer;
  try {
    expanded = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
  } catch {
    throw unsafeArchive("entry decompression failed or expanded size does not match");
  }
  if (expanded.length !== entry.uncompressedSize) {
    throw unsafeArchive("actual expanded size does not match entry header");
  }
  if (crc32(expanded) !== entry.checksum) {
    throw unsafeArchive("entry CRC does not match");
  }
  return expanded;
}

export function readActualBudgetArchive(archive: Buffer): ActualBudgetArchive {
  const entries = parseActualBudgetArchive(archive);
  const databaseEntries = entries.filter((entry) => entry.name.split(/[\\/]/).at(-1) === "db.sqlite");
  const metadataEntries = entries.filter((entry) => entry.name.split(/[\\/]/).at(-1) === "metadata.json");
  if (databaseEntries.length !== 1 || metadataEntries.length !== 1) {
    throw unsafeArchive("archive must contain exactly one db.sqlite and metadata.json");
  }

  let database: Buffer | undefined;
  let metadata: Buffer | undefined;
  for (const entry of entries) {
    const expanded = readEntry(archive, entry);
    if (entry === databaseEntries[0]) database = expanded;
    if (entry === metadataEntries[0]) metadata = expanded;
  }
  if (!database || !metadata) {
    throw unsafeArchive("archive must contain exactly one db.sqlite and metadata.json");
  }
  return { database, metadata };
}

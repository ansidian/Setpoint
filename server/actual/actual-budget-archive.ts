const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;

export const MAX_ACTUAL_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ACTUAL_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ACTUAL_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ACTUAL_ARCHIVE_ENTRIES = 128;
const SAFE_ACTUAL_BUDGET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export function assertSafeActualBudgetArchive(archive: Buffer): void {
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

  let offset = centralDirectoryOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw unsafeArchive("invalid central directory entry");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
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
    if ((flags & 0x1) !== 0) throw unsafeArchive("encrypted entries are not supported");
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
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const compressedDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedDataEnd = compressedDataOffset + compressedSize;
    if (compressedDataEnd > centralDirectoryOffset || compressedDataEnd < compressedDataOffset) {
      throw unsafeArchive("compressed entry exceeds archive bounds");
    }

    offset = nextOffset;
  }

  if (offset !== centralDirectoryEnd) {
    throw unsafeArchive("central directory size does not match its entries");
  }
}

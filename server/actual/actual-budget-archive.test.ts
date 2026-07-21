import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MAX_ACTUAL_ARCHIVE_ENTRY_BYTES,
  readActualBudgetArchive,
  validateActualBudgetId,
} from "./actual-budget-archive.ts";

interface ZipEntryFixture {
  name: string;
  data?: Buffer;
  method?: 0 | 8;
  flags?: number;
  localFlags?: number;
  localMethod?: number;
  crc?: number;
  uncompressedSize?: number;
}

function zipWithEntries(entries: ZipEntryFixture[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = entry.crc ?? crc32(data);
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const flags = entry.flags ?? 0;

    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlags ?? flags, 6);
    local.writeUInt16LE(entry.localMethod ?? method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);

    localParts.push(local);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe("readActualBudgetArchive", () => {
  it("reads stored and deflated target files without exposing other entries", () => {
    const archive = zipWithEntries([
      { name: "budget/db.sqlite", data: Buffer.from("sqlite"), method: 0 },
      { name: "budget/metadata.json", data: Buffer.from('{"id":"Budget-1"}'), method: 8 },
      { name: "budget/notes.txt", data: Buffer.from("not exposed"), method: 8 },
    ]);

    expect(readActualBudgetArchive(archive)).toEqual({
      database: Buffer.from("sqlite"),
      metadata: Buffer.from('{"id":"Budget-1"}'),
    });
  });

  it("rejects an entry whose expanded data does not match its CRC", () => {
    const archive = zipWithEntries([
      { name: "db.sqlite", data: Buffer.from("sqlite"), crc: 123 },
      { name: "metadata.json", data: Buffer.from("{}") },
    ]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/CRC/);
  });

  it("rejects an entry whose actual expanded length differs from its headers", () => {
    const archive = zipWithEntries([
      { name: "db.sqlite", data: Buffer.from("sqlite"), uncompressedSize: 99 },
      { name: "metadata.json", data: Buffer.from("{}") },
    ]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/expanded size/);
  });

  it("rejects duplicate target basenames", () => {
    const archive = zipWithEntries([
      { name: "one/db.sqlite", data: Buffer.from("one") },
      { name: "two/db.sqlite", data: Buffer.from("two") },
      { name: "metadata.json", data: Buffer.from("{}") },
    ]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/exactly one db.sqlite and metadata.json/);
  });

  it("rejects disagreement between central and local headers", () => {
    const archive = zipWithEntries([
      { name: "db.sqlite", data: Buffer.from("sqlite"), localMethod: 8 },
      { name: "metadata.json", data: Buffer.from("{}") },
    ]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/local file header does not match/);
  });

  it.each([
    { label: "encrypted", flags: 0x1, message: /encrypted/ },
    { label: "data-descriptor", flags: 0x8, message: /data descriptors/ },
  ])("rejects $label entries", ({ flags, message }) => {
    const archive = zipWithEntries([
      { name: "db.sqlite", flags },
      { name: "metadata.json" },
    ]);

    expect(() => readActualBudgetArchive(archive)).toThrow(message);
  });

  it("rejects unsupported compression methods", () => {
    const archive = zipWithEntries([
      { name: "db.sqlite" },
      { name: "metadata.json" },
    ]);
    archive.writeUInt16LE(12, archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);

    expect(() => readActualBudgetArchive(archive)).toThrow(/unsupported compression method/);
  });

  it("rejects archives missing either required target", () => {
    const archive = zipWithEntries([{ name: "db.sqlite", data: Buffer.from("sqlite") }]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/exactly one db.sqlite and metadata.json/);
  });
});

describe("readActualBudgetArchive bounds", () => {
  it("accepts a structurally bounded archive", () => {
    const archive = zipWithEntries([
      { name: "db.sqlite" },
      { name: "metadata.json" },
    ]);

    expect(() => readActualBudgetArchive(archive)).not.toThrow();
  });

  it("rejects a tiny archive that declares a zip-bomb-sized entry", () => {
    const archive = zipWithEntries([{
      name: "db.sqlite",
      uncompressedSize: MAX_ACTUAL_ARCHIVE_ENTRY_BYTES + 1,
    }, { name: "metadata.json" }]);

    expect(() => readActualBudgetArchive(archive)).toThrow(/expanded size limit/);
  });

  it("rejects central-directory offsets that point outside the archive", () => {
    const archive = zipWithEntries([{ name: "db.sqlite" }, { name: "metadata.json" }]);
    archive.writeUInt32LE(archive.length + 100, archive.length - 6);

    expect(() => readActualBudgetArchive(archive)).toThrow(/central directory/);
  });
});

describe("validateActualBudgetId", () => {
  it("accepts an Actual local-cache identifier", () => {
    expect(validateActualBudgetId("My-Finances-d8e502a")).toBe("My-Finances-d8e502a");
  });

  it.each(["", ".", "..", "../outside", "..\\outside", "C:\\outside", "budget/name"])(
    "rejects a path-capable budget identifier: %s",
    (budgetId) => {
      expect(() => validateActualBudgetId(budgetId)).toThrow(/budget identifier/);
    },
  );
});

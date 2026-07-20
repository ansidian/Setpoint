import { describe, expect, it } from "vitest";
import {
  MAX_ACTUAL_ARCHIVE_ENTRY_BYTES,
  assertSafeActualBudgetArchive,
  validateActualBudgetId,
} from "./actual-budget-archive.ts";

function zipWithDeclaredEntry({
  name = "db.sqlite",
  compressedSize = 0,
  uncompressedSize = 0,
}: {
  name?: string;
  compressedSize?: number;
  uncompressedSize?: number;
} = {}): Buffer {
  const nameBuffer = Buffer.from(name);
  const localHeader = Buffer.alloc(30 + nameBuffer.length + compressedSize);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(compressedSize, 18);
  localHeader.writeUInt32LE(uncompressedSize, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(localHeader, 30);

  const centralDirectory = Buffer.alloc(46 + nameBuffer.length);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt32LE(compressedSize, 20);
  centralDirectory.writeUInt32LE(uncompressedSize, 24);
  centralDirectory.writeUInt16LE(nameBuffer.length, 28);
  centralDirectory.writeUInt32LE(0, 42);
  nameBuffer.copy(centralDirectory, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localHeader.length, 16);
  return Buffer.concat([localHeader, centralDirectory, end]);
}

describe("assertSafeActualBudgetArchive", () => {
  it("accepts a structurally bounded archive", () => {
    expect(() => assertSafeActualBudgetArchive(zipWithDeclaredEntry())).not.toThrow();
  });

  it("rejects a tiny archive that declares a zip-bomb-sized entry", () => {
    const archive = zipWithDeclaredEntry({
      uncompressedSize: MAX_ACTUAL_ARCHIVE_ENTRY_BYTES + 1,
    });

    expect(() => assertSafeActualBudgetArchive(archive)).toThrow(/expanded size limit/);
  });

  it("rejects central-directory offsets that point outside the archive", () => {
    const archive = zipWithDeclaredEntry();
    archive.writeUInt32LE(archive.length + 100, archive.length - 6);

    expect(() => assertSafeActualBudgetArchive(archive)).toThrow(/central directory/);
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

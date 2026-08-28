import { describe, expect, it } from "vitest";
import type { CommunicationLogEntry } from "./stores";
import {
  COMMUNICATION_LOG_CSV_COLUMNS,
  communicationLogCsvRow,
  communicationLogExportFileName,
  escapeCsvField,
  formatTimestampRfc3339Local,
  serializeCommunicationLogToCsv,
} from "./csv-export";

function entry(
  overrides: Partial<CommunicationLogEntry> = {},
): CommunicationLogEntry {
  return {
    seq: 1,
    timestamp: new Date(2026, 7, 28, 10, 20, 30, 123).getTime(),
    direction: "request",
    protocol: "rtu",
    slaveAddress: 1,
    functionCode: 0x03,
    userAddress: 100,
    sentAddress: 100,
    quantity: 1,
    attempt: 0,
    status: "success",
    errorCode: null,
    exceptionCode: null,
    source: "manual-read",
    durationMs: 12,
    bytesHex: "01 03 00 64 00 01 85 F2",
    ...overrides,
  };
}

describe("escapeCsvField", () => {
  it("passes through plain values unchanged", () => {
    expect(escapeCsvField("abc")).toBe("abc");
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(false)).toBe("false");
  });

  it("renders null/undefined as empty string", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it("quotes fields containing commas", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("quotes fields containing line breaks", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("formatTimestampRfc3339Local", () => {
  it("formats with milliseconds and the local UTC offset", () => {
    const ts = new Date(2026, 7, 28, 10, 20, 30, 123).getTime();
    const d = new Date(ts);
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    expect(formatTimestampRfc3339Local(ts)).toBe(
      `2026-08-28T10:20:30.123${offset}`,
    );
  });

  it("returns empty string for non-finite timestamps", () => {
    expect(formatTimestampRfc3339Local(Number.NaN)).toBe("");
  });
});

describe("serializeCommunicationLogToCsv", () => {
  it("emits the header only for an empty buffer (still valid CSV)", () => {
    expect(serializeCommunicationLogToCsv([])).toBe(
      `${COMMUNICATION_LOG_CSV_COLUMNS.join(",")}\r\n`,
    );
  });

  it("emits header then one row per entry with CRLF line endings", () => {
    const csv = serializeCommunicationLogToCsv([
      entry(),
      entry({ seq: 2, direction: "response", bytesHex: "01 03 02 01 02 29 8E" }),
    ]);
    const lines = csv.split("\r\n");
    // 末尾换行会 split 出空元素：表头 + 2 行数据 + 尾部空串。
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(COMMUNICATION_LOG_CSV_COLUMNS.join(","));
    expect(lines[1]).toContain("01 03 00 64 00 01 85 F2");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("maps all 16 fields in column order", () => {
    const e = entry();
    const row = communicationLogCsvRow(e);
    const fields = row.split(",");
    expect(fields).toHaveLength(COMMUNICATION_LOG_CSV_COLUMNS.length);
    expect(fields[0]).toBe("1"); // seq
    expect(fields[2]).toBe("request"); // direction
    expect(fields[3]).toBe("rtu"); // protocol
    expect(fields[4]).toBe("1"); // slaveAddress
    expect(fields[5]).toBe("3"); // functionCode (0x03)
    expect(fields[6]).toBe("100"); // userAddress
    expect(fields[7]).toBe("100"); // sentAddress
    expect(fields[8]).toBe("1"); // quantity
    expect(fields[9]).toBe("0"); // attempt
    expect(fields[10]).toBe("success"); // status
    expect(fields[11]).toBe(""); // errorCode
    expect(fields[12]).toBe(""); // exceptionCode
    expect(fields[13]).toBe("manual-read"); // source
    expect(fields[14]).toBe("12"); // durationMs
    expect(fields[15]).toBe("01 03 00 64 00 01 85 F2"); // bytesHex
  });

  it("keeps null fields empty and preserves uppercase hex bytes", () => {
    const e = entry({
      slaveAddress: null,
      functionCode: null,
      userAddress: null,
      sentAddress: null,
      quantity: null,
      errorCode: "ERR_TIMEOUT",
      exceptionCode: null,
      durationMs: null,
      bytesHex: "AA BB 0C 0D",
    });
    const fields = communicationLogCsvRow(e).split(",");
    expect(fields[4]).toBe("");
    expect(fields[5]).toBe("");
    expect(fields[6]).toBe("");
    expect(fields[7]).toBe("");
    expect(fields[8]).toBe("");
    expect(fields[11]).toBe("ERR_TIMEOUT");
    expect(fields[12]).toBe("");
    expect(fields[14]).toBe("");
    expect(fields[15]).toBe("AA BB 0C 0D");
  });

  it("escapes fields that contain commas or quotes", () => {
    const e = entry({ errorCode: "ERR,1", source: 'a"b' });
    const row = serializeCommunicationLogToCsv([e]).split("\r\n")[1];
    expect(row).toContain('"ERR,1"');
    expect(row).toContain('"a""b"');
  });
});

describe("communicationLogExportFileName", () => {
  const now = new Date(2026, 7, 28, 10, 20, 30).getTime();

  it("includes the protocol and a local timestamp", () => {
    expect(communicationLogExportFileName([entry()], now)).toBe(
      "comm-log-rtu-20260828-102030.csv",
    );
  });

  it("uses tcp for a tcp-only buffer", () => {
    expect(
      communicationLogExportFileName(
        [entry({ protocol: "tcp" })],
        now,
      ),
    ).toBe("comm-log-tcp-20260828-102030.csv");
  });

  it("uses mixed when entries span protocols", () => {
    expect(
      communicationLogExportFileName(
        [entry({ protocol: "rtu" }), entry({ protocol: "tcp" })],
        now,
      ),
    ).toBe("comm-log-mixed-20260828-102030.csv");
  });

  it("always ends with .csv", () => {
    expect(communicationLogExportFileName([], now)).toMatch(/\.csv$/);
  });
});

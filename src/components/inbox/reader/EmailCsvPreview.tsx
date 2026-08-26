import { useEffect, useState } from "react";
import { FileWarning } from "lucide-react";

export const EMAIL_CSV_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const EMAIL_CSV_PREVIEW_MAX_ROWS = 200;
const EMAIL_CSV_PREVIEW_MAX_COLUMNS = 50;

interface CsvPreviewData {
  rows: string[][];
  columnCount: number;
  rowsTruncated: boolean;
  columnsTruncated: boolean;
}

export default function EmailCsvPreview({ blob, filename }: { blob: Blob; filename: string }) {
  const [data, setData] = useState<CsvPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    if (blob.size > EMAIL_CSV_PREVIEW_MAX_BYTES) {
      setError("This CSV is larger than 5 MB. Download it to view the full file.");
      return;
    }

    Promise.all([
      blob.text(),
      import("csv-parse/browser/esm/sync"),
    ])
      .then(([text, { parse }]) => {
        if (cancelled) return;
        const parsed = parse(text, {
          bom: true,
          relax_column_count: true,
          skip_empty_lines: false,
          to: EMAIL_CSV_PREVIEW_MAX_ROWS + 1,
        }) as unknown[][];
        const normalizedRows = parsed.map((row) => row.map((cell) => String(cell ?? "")));
        const rowsTruncated = normalizedRows.length > EMAIL_CSV_PREVIEW_MAX_ROWS;
        const visibleRows = normalizedRows.slice(0, EMAIL_CSV_PREVIEW_MAX_ROWS);
        const widestRow = visibleRows.reduce((widest, row) => Math.max(widest, row.length), 0);
        setData({
          rows: visibleRows.map((row) => row.slice(0, EMAIL_CSV_PREVIEW_MAX_COLUMNS)),
          columnCount: Math.min(widestRow, EMAIL_CSV_PREVIEW_MAX_COLUMNS),
          rowsTruncated,
          columnsTruncated: widestRow > EMAIL_CSV_PREVIEW_MAX_COLUMNS,
        });
      })
      .catch(() => {
        if (!cancelled) setError("This CSV could not be parsed. Download it to view the original file.");
      });

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) {
    return (
      <div className="email-attachment-preview-state email-attachment-preview-error" role="alert">
        <FileWarning size={26} aria-hidden="true" />
        <strong>CSV preview unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="email-attachment-preview-state" role="status">
        <span className="email-attachment-preview-spinner" aria-hidden="true" />
        <span>Reading CSV…</span>
      </div>
    );
  }

  if (!data.rows.length || !data.columnCount) {
    return (
      <div className="email-attachment-preview-state" role="status">
        <strong>Empty CSV</strong>
        <span>This file does not contain any rows to preview.</span>
      </div>
    );
  }

  const header = data.rows[0]!;
  const body = data.rows.slice(1);
  const truncation = [
    data.rowsTruncated ? `${EMAIL_CSV_PREVIEW_MAX_ROWS} rows` : null,
    data.columnsTruncated ? `${EMAIL_CSV_PREVIEW_MAX_COLUMNS} columns` : null,
  ].filter(Boolean).join(" and ");

  return (
    <div className="email-csv-preview">
      <div className="email-csv-preview-scroll" tabIndex={0}>
        <table aria-label={`Preview of ${filename}`}>
          <thead>
            <tr>
              <th className="email-csv-preview-row-number" scope="col">#</th>
              {Array.from({ length: data.columnCount }, (_, index) => (
                <th key={index} scope="col" title={header[index] || `Column ${index + 1}`}>
                  {header[index] || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="email-csv-preview-row-number" scope="row">{rowIndex + 2}</th>
                {Array.from({ length: data.columnCount }, (_, columnIndex) => (
                  <td key={columnIndex} title={row[columnIndex] || undefined}>{row[columnIndex] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="email-csv-preview-status" role="status">
        {truncation
          ? `Showing the first ${truncation}. Download for the complete file.`
          : `${body.length} data row${body.length === 1 ? "" : "s"} · ${data.columnCount} column${data.columnCount === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}

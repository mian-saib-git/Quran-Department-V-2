export type ImportSummary = {
  created: number; conflicts: number; invalid: number; uncertain: number;
  unprocessed: number; details: string[];
};

// Never retry a mutation. Network/server failures may have occurred after commit.
export async function runSequentialImport<T>(rows: T[], create: (row: T) => Promise<unknown>): Promise<ImportSummary> {
  const result: ImportSummary = { created: 0, conflicts: 0, invalid: 0, uncertain: 0, unprocessed: 0, details: [] };
  for (let i = 0; i < rows.length; i += 1) {
    try {
      await create(rows[i]);
      result.created += 1;
    } catch (error: any) {
      result.details.push(`Row ${i + 1}: ${error?.message || "Request failed"}`);
      if (error?.status === 409) result.conflicts += 1;
      else if (error?.status === 400) result.invalid += 1;
      else {
        result.uncertain += 1;
        result.unprocessed = rows.length - i - 1;
        result.details.push("Stopped. Check the last row before retrying: its save outcome may be unknown.");
        break;
      }
    }
  }
  return result;
}
export function importSummaryText(result: ImportSummary) {
  return `Created ${result.created}; conflicts ${result.conflicts}; invalid ${result.invalid}; uncertain ${result.uncertain}; not processed ${result.unprocessed}. Existing accounts were not changed.`;
}

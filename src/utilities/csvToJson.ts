import fs from "fs";
import csv from "csv-parser";
import { ColumnMapping } from "../types";

export function csvToJson(
  csvFilePath: string,
  jsonFilePath: string,
  columnMapping: ColumnMapping | null = null,
  requiredHeaders: string[] = [],
  callback?: (rows: Record<string, string>[]) => void,
): void {
  const results: Record<string, string>[] = [];
  let headers: string[] = [];

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on("headers", (headerList: string[]) => {
      headers = headerList;
      const missing = requiredHeaders.filter((col) => !headers.includes(col));
      if (missing.length > 0) {
        console.warn(
          `⚠️ Warning: Missing columns in CSV: ${missing.join(", ")}`,
        );
      }
    })
    .on("data", (row: Record<string, string>) => {
      let entry: Record<string, string> = {};

      if (columnMapping) {
        for (const [csvCol, jsonKey] of Object.entries(columnMapping)) {
          // Normalize value, treating whitespace-only rows as empty strings
          const value = row[csvCol] !== undefined ? row[csvCol].trim() : "";
          entry[jsonKey] = value;

          // FIX 1 & 2: Only throw if this column is explicitly marked as required
          if (requiredHeaders.includes(csvCol) && value === "") {
            throw new Error(
              `Validation Error: Required column "${csvCol}" has empty data.`,
            );
          }
        }
      } else {
        entry = row;
        // FIX 3: Add validation check for when columnMapping is null
        for (const reqCol of requiredHeaders) {
          const value = entry[reqCol] !== undefined ? entry[reqCol].trim() : "";
          if (value === "") {
            throw new Error(
              `Validation Error: Required column "${reqCol}" has empty data.`,
            );
          }
        }
      }

      results.push(entry);
    })
    .on("end", () => {
      fs.writeFileSync(jsonFilePath, JSON.stringify(results, null, 2));
      console.log(`📁 JSON saved to "${jsonFilePath}"`);
      console.log(`🔁 Rows converted: ${results.length}`);
      if (typeof callback === "function") {
        callback(results);
      }
    })
    .on("error", (err: Error) => {
      console.error("❌ Error reading CSV:", err.message);
    });
}

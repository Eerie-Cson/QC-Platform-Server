// src/config/paths.ts
// import path from "path";

// const ROOT_DIR = path.join(__dirname, "..", "..");

// export const QC_INPUT_DIR = path.join(ROOT_DIR, "data", "input", "qc");
// export const CROSSCHECK_INPUT_DIR = path.join(ROOT_DIR, "data", "input", "crosscheck");

// export const QC_OUTPUT_DIR = path.join(ROOT_DIR, "data", "output", "qc");
// export const CROSSCHECK_OUTPUT_DIR = path.join(ROOT_DIR, "data", "output", "crosscheck");

// export const SESSIONS_JSON = path.join(QC_OUTPUT_DIR, "sessions.json");
// export const DATA_FILE = path.join(QC_OUTPUT_DIR, "results.json");
// export const LINKS_CSV = path.join(QC_OUTPUT_DIR, "links.csv");

// export const CROSSCHECK_FILE = path.join(CROSSCHECK_OUTPUT_DIR, "crosscheck.json");

// src/config/paths.ts
import path from "path";

const ROOT_DIR = path.join(__dirname, "..", "..");

export const QC_INPUT_JSON_DIR = path.join(ROOT_DIR, "platform-data");
export const QC_INPUT_DIR = path.join(ROOT_DIR, "data", "input", "qc");
export const CROSSCHECK_INPUT_DIR = path.join(
  ROOT_DIR,
  "data",
  "input",
  "crosscheck",
);

export const QC_OUTPUT_DIR = path.join(ROOT_DIR, "data", "output", "qc");
export const CROSSCHECK_OUTPUT_DIR = path.join(
  ROOT_DIR,
  "data",
  "output",
  "crosscheck",
);

export const SESSIONS_JSON = path.join(QC_OUTPUT_DIR, "sessions.json");
export const DATA_FILE = path.join(QC_OUTPUT_DIR, "results.json");
export const LINKS_CSV = path.join(QC_OUTPUT_DIR, "links.csv");

export const CROSSCHECK_FILE = path.join(
  CROSSCHECK_OUTPUT_DIR,
  "crosscheck.json",
);

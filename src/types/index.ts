// ---------------------------------------------------------------------------
// Enums – same as frontend (copy them here to share or define once)
// ---------------------------------------------------------------------------
export enum Severity {
  NoIssue = "No issue",
  Minor = "Minor",
  Major = "Major",
}

export enum Seated {
  StandingMoving = "Standing/ Moving",
  AllowSeated = "Allow Seated",
  Seated = "Seated",
}

export enum Environment {
  CorrectTask = "Correct Task",
  WrongTask = "Wrong Task",
}

// Other is a union of Severity values + two extras
export type Other = Severity | "Unavailable" | "Processing";

// System rating enum – same as frontend
export enum SystemRating {
  Great = "Great",
  Good = "Good",
  NeedsWork = "Needs work",
  None = "", // stored as empty string
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Entry = {
  email: string;
  recordedTimestamp: string;
  uploadedTimestamp: string;
};

export interface Ratings {
  lighting?: Severity | "";
  sharpness?: Severity | "";
  handVisibility?: Severity | "";
  fovFraming?: Severity | "";
  cameraAngle?: Severity | "";
  idle?: Severity | "";
  seated?: Seated | "";
  environment?: Environment | "";
  other?: Other | "";
  comment?: string;
  crosscheckComment?: string;
}

export type Session = Entry & {
  // email: string;
  task: string;
  minutes: string; // kept as string from CSV
  // recordedTimestamp: string; // UTC+8 formatted
  // uploadedTimestamp: string;
  sessionId: string;
  link: string | null;
  ratings: Ratings;
  systemRating?: SystemRating; // undefined means "None" (not set)
  personalGmail?: boolean;
};

export type SessionRow = Omit<
  Session,
  "ratings" | "minutes" | "recordedTimestamp" | "uploadedTimestamp"
> & {
  // email: string;
  // sessionId: string;
  // task: string;
  minutes: number;
  recorded: string;
  uploaded: string;
  // link: string | null;
};

// For CSV export – flat structure
export type FlatRow = Omit<Session, "ratings"> & {
  // email: string;
  // task: string;
  // minutes: string;
  // recordedTimestamp: string;
  // uploadedTimestamp: string;
  // sessionId: string;
  // link: string;
  lighting?: string;
  sharpness?: string;
  handVisibility?: string;
  fovFraming?: string;
  cameraAngle?: string;
  idle?: string;
  seated?: string;
  environment?: string;
  other?: string;
  comment?: string;
  crosscheckComment?: string; // for crosscheck export
};

// For CSV column mapping
export type ColumnMapping = Record<string, string>;

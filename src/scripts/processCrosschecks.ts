import fs from "fs";
import path from "path";
import { csvToJson } from "../utilities/csvToJson";
import { CROSSCHECK_INPUT_DIR, CROSSCHECK_OUTPUT_DIR } from "../config/paths";
import { Session, Ratings, FlatRow } from "../types";

function transformToSessions(flatRows: any[]): Session[] {
  return flatRows.map((row) => ({
    email: row.email || "",
    task: row.task || "",
    minutes: row.minutes || "",
    recordedTimestamp: row.recordedTimestamp || "",
    uploadedTimestamp: row.uploadedTimestamp || "",
    sessionId: row.sessionId || "",
    link: row.link || "",
    ratings: {
      lighting: row.lighting || "",
      sharpness: row.sharpness || "",
      handVisibility: row.handVisibility || "",
      fovFraming: row.fovFraming || "",
      cameraAngle: row.cameraAngle || "",
      idle: row.idle || "",
      seated: row.seated || "",
      environment: row.environment || "",
      other: row.other || "",
      comment: row.comment || "",
    } as Ratings,
    systemRating: row.systemRating || "",
  }));
}

(function csvRowToSession() {
  const crosscheckDir = CROSSCHECK_INPUT_DIR;

  const csvFiles = fs
    .readdirSync(crosscheckDir)
    .filter((file) => file.endsWith(".csv"));
  if (csvFiles.length === 0) {
    console.error("❌ No CSV file found in ./crosscheck");
    return;
  }
  const csvFile = path.join(crosscheckDir, csvFiles[0]);
  const outputFile = path.join(CROSSCHECK_OUTPUT_DIR, "crosscheck.json");

  const mapping = {
    "User Email": "email",
    "Session ID": "sessionId",
    "Task Name": "task",
    minutes_collected: "minutes",
    "Date Recorded": "recordedTimestamp",
    "Date Uploaded": "uploadedTimestamp",
    Link: "link",
    Lighting: "lighting",
    Sharpness: "sharpness",
    Hand_visibility: "handVisibility",
    FOV_framing: "fovFraming",
    Camera_angle: "cameraAngle",
    Idle_time: "idle",
    "Seated?": "seated",
    "Environment- Task assigned": "environment",
    "Other Issue": "other",
    System_Rating: "systemRating",
    Notes: "comment",
  };

  const requiredHeaders = Object.keys(mapping).filter(
    (key) => key !== "System_Rating",
  );

  csvToJson(csvFile, outputFile, mapping, requiredHeaders, (flatRows) => {
    const sessions = transformToSessions(flatRows);
    fs.writeFileSync(outputFile, JSON.stringify(sessions, null, 2));
  });
})();

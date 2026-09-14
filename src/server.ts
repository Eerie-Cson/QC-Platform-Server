import express, { Request, Response } from "express";
import fs from "fs";
import cors from "cors";
import { parse } from "json2csv";
import { DATA_FILE, CROSSCHECK_FILE } from "./config/paths";
import { Session } from "./types";
import { extractSessionId } from "./utilities/minuteApp";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("build"));

// GET /api/sessions
app.get("/api/sessions", (req: Request, res: Response) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const sessions = JSON.parse(raw);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: "Failed to read sessions" });
  }
});

app.post("/api/ratings", (req: Request, res: Response) => {
  const { sessionId, ratings, systemRating, faceVisible } = req.body;

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const sessions: (Session & { faceVisible?: boolean })[] = JSON.parse(raw);

    const session = sessions.find((s) => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.faceVisible = !!faceVisible;
    session.systemRating = systemRating || "";

    if (ratings) {
      session.ratings = ratings;
    } else {
      delete (session as any).ratings;
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2));
    return res.json({ session, success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/export-csv
app.get("/api/export-csv", (req: Request, res: Response) => {
  const { crosscheck } = req.query;
  const fileToRead = crosscheck === "true" ? CROSSCHECK_FILE : DATA_FILE;

  if (!fs.existsSync(fileToRead)) {
    return res.status(404).json({ error: "Data file not found" });
  }

  try {
    const raw = fs.readFileSync(fileToRead, "utf8");
    const sessions: Session[] = JSON.parse(raw);

    const flat = sessions.map((s) => ({
      "User Email": s.email,
      "Session ID": s.sessionId,
      "Task Name": s.task,
      minutes_collected: s.minutes,
      "Date Recorded": s.recordedTimestamp,
      "Date Uploaded": s.uploadedTimestamp,
      Lighting: s.ratings?.lighting || "",
      Sharpness: s.ratings?.sharpness || "",
      Hand_visibility: s.ratings?.handVisibility || "",
      FOV_framing: s.ratings?.fovFraming || "",
      Camera_angle: s.ratings?.cameraAngle || "",
      Idle_time: s.ratings?.idle || "",
      "Seated?": s.ratings?.seated || "",
      "Environment- Task assigned": s.ratings?.environment || "",
      "Other Issue": s.ratings?.other || "",
      Notes: s.ratings?.comment ? s.ratings.comment.replace(/\n/g, "\r\n") : "",
      link: s.link,
      ...(crosscheck === "true"
        ? { "Cross Checked QC": s.ratings?.crosscheckComment || "" }
        : {}),
      "System Rating": s.systemRating || "",
    }));

    const csv = parse(flat);
    res.header("Content-Type", "text/csv");
    res.attachment("rated_footages.csv");
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate CSV" });
  }
});

// GET /api/crosscheck
app.get("/api/crosscheck", (req: Request, res: Response) => {
  const raw = fs.readFileSync(CROSSCHECK_FILE, "utf8");
  try {
    const crosscheck_sessions = JSON.parse(raw);
    res.json(crosscheck_sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read crosscheck data" });
  }
});

// POST /api/crosscheck-ratings
app.post("/api/crosscheck-ratings", (req: Request, res: Response) => {
  const { sessionId, ratings, systemRating } = req.body;
  try {
    const raw = fs.readFileSync(CROSSCHECK_FILE, "utf8");
    const sessions = JSON.parse(raw);

    // Optional: check link mismatch
    const wrongLinks = sessions.map(
      (s: Session) => s.sessionId !== extractSessionId(s.link),
    );
    if (wrongLinks.length === 0) console.log(`Incorrect links: ${wrongLinks}`);

    const session = sessions.find((s: any) => s.sessionId === sessionId);
    if (session) {
      if (ratings) {
        // Remove any existing systemRating from the ratings object
        const { systemRating: _, ...restRatings } = ratings as any;
        session.ratings = restRatings;
        session.systemRating = systemRating || "";
      } else {
        delete session.ratings;
        delete session.systemRating;
      }
      fs.writeFileSync(CROSSCHECK_FILE, JSON.stringify(sessions, null, 2));
      res.json({ session, success: true });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

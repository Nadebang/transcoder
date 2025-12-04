import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(bodyParser.json());

// In-memory map of id -> file path in /tmp
const videoStore = new Map();

/**
 * POST /process
 * Body: { video_url: string, prediction_id?: string }
 * Returns: { success: boolean, fixed_url?: string, error?: string }
 */
app.post("/process", async (req, res) => {
  try {
    const { video_url, prediction_id } = req.body || {};

    if (!video_url || typeof video_url !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "Missing or invalid video_url" });
    }

    const id =
      typeof prediction_id === "string"
        ? prediction_id
        : crypto.randomBytes(8).toString("hex");

    // 1) Download input video to /tmp
    const response = await fetch(video_url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.status(502).json({
        success: false,
        error: "Failed to download input",
        status: response.status,
        detail: text
      });
    }

    const inputPath = path.join("/tmp", `${id}_input.mp4`);
    const outputPath = path.join("/tmp", `${id}_output.mp4`);

    const fileHandle = await fs.open(inputPath, "w");
    const fileStream = fileHandle.createWriteStream();

    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    // 2) Run ffmpeg: convert to 1080x1920 portrait, pad center
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters([
          "scale=-2:1920", // height 1920, width auto to keep aspect
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2" // pad to 1080x1920 centered
        ])
        .outputOptions(["-c:v libx264", "-c:a copy"])
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    await fileHandle.close();

    videoStore.set(id, outputPath);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fixedUrl = `${baseUrl}/video/${encodeURIComponent(id)}`;

    return res.json({
      success: true,
      fixed_url: fixedUrl
    });
  } catch (err) {
    console.error("Transcoder error:", err);
    return res
      .status(500)
      .json({ success: false, error: String(err) });
  }
});

/**
 * GET /video/:id
 * Streams the transcoded file from /tmp
 */
app.get("/video/:id", async (req, res) => {
  const id = req.params.id;
  const filePath = videoStore.get(id);
  if (!filePath) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(filePath);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Transcoder listening on port ${port}`);
});

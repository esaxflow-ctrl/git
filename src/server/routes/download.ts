import { Router } from "express";
import path from "path";
import fs from "fs";
import { jobs } from "./render";

export const downloadRouter = Router();

downloadRouter.get("/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  if (job.status !== "done") {
    res.status(409).json({ error: "not_ready", status: job.status });
    return;
  }
  if (!fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: "file_not_found" });
    return;
  }

  const filename = `sfv-${job.jobId.slice(0, 8)}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");
  fs.createReadStream(job.outputPath).pipe(res);
});

downloadRouter.get("/:jobId/srt", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  if (!fs.existsSync(job.srtPath)) {
    res.status(404).json({ error: "srt_not_found" });
    return;
  }

  const filename = `sfv-${job.jobId.slice(0, 8)}.srt`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "text/plain");
  fs.createReadStream(job.srtPath).pipe(res);
});

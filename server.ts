import "dotenv/config";

import express from "express";
import cors from "cors";

import { scrapeProfile } from "./src/scrape";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

app.post("/api/profile", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({
        error: "A LinkedIn profile URL is required",
      });
    }

    const profile = await scrapeProfile(url);

    return res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,

      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

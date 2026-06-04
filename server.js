import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

app.use(cors())
app.use(express.json())

const ASSIST_BASE = "https://prod.assistng.org"
const ASSIST_ORG = "https://assist.org"

/**
 * Browser-like headers (kept simple but useful for ASSIST)
 */
const browserHeaders = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
}

/**
 * MAIN ASSIST PROXY
 * Handles ALL /articulation/api/* requests
 */
app.use("/articulation/api", async (req, res) => {
  try {
    const url = `${ASSIST_BASE}${req.originalUrl}`

    console.log("[ASSIST PROXY]", url)

    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json",
      },
    })

    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("[ASSIST ERROR]", err.message)

    res.status(err.response?.status || 500).json({
      error: "ASSIST proxy failed",
      details: err.message,
    })
  }
})

/**
 * TRANSFERABLE COURSE LIST (your existing logic kept)
 */
app.use("/transferablecourselist", async (req, res) => {
  try {
    const url = `${ASSIST_ORG}/transferablecourselist${req.url}`

    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json, text/plain, */*",
      },
    })

    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("[TRANSFER ERROR]", err.message)

    res.status(err.response?.status || 500).json({
      error: err.message,
    })
  }
})

app.use("/assist-api", async (req, res) => {
  try {
    const url = `${ASSIST_ORG}/api${req.url}`
    console.log("[ASSIST ORG PROXY]", url)
    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json",
      },
    })
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("[ASSIST ORG ERROR]", err.message)
    res.status(err.response?.status || 500).json({ error: err.message })
  }
})

/**
 * HEALTH CHECK (optional but useful)
 */
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend running" })
})

/**
 * START SERVER
 */
const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

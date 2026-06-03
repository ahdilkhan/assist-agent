import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

app.use(cors())
app.use(express.json())

const ASSIST_BASE = "https://prod.assistng.org"
const ASSIST_ORG = "https://assist.org"

// Simple in-memory cache
const cache = new Map()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours in ms

function getCache(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
}

const browserHeaders = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
}

app.use("/articulation/api", async (req, res) => {
  try {
    const url = `${ASSIST_BASE}${req.originalUrl}`
    const cached = getCache(url)

    if (cached) {
      console.log("[CACHE HIT]", url)
      return res.json(cached)
    }

    console.log("[ASSIST PROXY]", url)

    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json",
      },
    })

    setCache(url, response.data)
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

app.use("/transferablecourselist", async (req, res) => {
  try {
    const url = `${ASSIST_ORG}/transferablecourselist${req.url}`
    const cached = getCache(url)

    if (cached) {
      console.log("[CACHE HIT]", url)
      return res.json(cached)
    }

    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json, text/plain, */*",
      },
    })

    setCache(url, response.data)
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("[TRANSFER ERROR]", err.message)
    res.status(err.response?.status || 500).json({
      error: err.message,
    })
  }
})

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend running" })
})

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
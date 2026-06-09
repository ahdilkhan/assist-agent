import express from "express"
import cors from "cors"
import axios from "axios"

const app = express()

app.use(cors())
app.use(express.json())

const ASSIST_BASE = "https://prod.assistng.org"
const ASSIST_ORG = "https://assist.org"

const browserHeaders = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
}

app.use("/articulation/api", async (req, res) => {
  try {
    const url = `${ASSIST_BASE}${req.originalUrl}`
    const response = await axios.get(url, {
      headers: { ...browserHeaders, accept: "application/json" },
    })
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: "ASSIST proxy failed",
      details: err.message,
    })
  }
})

app.use("/transferablecourselist", async (req, res) => {
  try {
    const url = `${ASSIST_ORG}/transferablecourselist${req.url}`
    const response = await axios.get(url, {
      headers: { ...browserHeaders, accept: "application/json, text/plain, */*" },
    })
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message })
  }
})

app.use("/api/transferability", async (req, res) => {
  try {
    const sessionRes = await axios.get("https://assist.org", {
      headers: { ...browserHeaders },
    })
    const cookies = sessionRes.headers["set-cookie"] || []
    const cookieString = cookies.map(c => c.split(";")[0]).join("; ")
    const xsrfCookie = cookies.find(c => c.startsWith("XSRF-TOKEN="))
    const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.split("=")[1].split(";")[0]) : ""

    const url = `${ASSIST_ORG}/api/transferability${req.url}`
    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json, text/plain, */*",
        cookie: cookieString,
        "x-xsrf-token": xsrfToken,
        referer: "https://assist.org/transfer/results",
        "content-type": "application/json",
      },
    })
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message })
  }
})

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend running" })
})

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
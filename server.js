import express from "express"
import cors from "cors"
import axios from "axios"
import puppeteer from "puppeteer"
import * as cheerio from "cheerio"

const app = express()

app.use(cors())
app.use(express.json())

const ASSIST_BASE = "https://prod.assistng.org"
const ASSIST_ORG = "https://assist.org"

const browserHeaders = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
}

// ── ASSIST Proxy Routes ──
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
    // First hit the assist.org homepage to pick up any session cookies
    const sessionRes = await axios.get(ASSIST_ORG, { headers: browserHeaders })
    const cookies = sessionRes.headers["set-cookie"]?.map(c => c.split(";")[0]).join("; ") || ""

    const url = `${ASSIST_ORG}/api/transferability${req.url}`
    const response = await axios.get(url, {
      headers: {
        ...browserHeaders,
        accept: "application/json",
        referer: "https://assist.org/",
        origin: "https://assist.org",
        cookie: cookies,
      },
    })
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("transferability proxy error:", err.response?.status, err.response?.data)
    res.status(err.response?.status || 500).json({ error: err.message })
  }
})

// ── Banner Scraper ──
async function scrapeBanner(baseUrl, subject, courseNumber) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

    const base = baseUrl.replace('/ssb/term/termSelection?mode=search', '')

    // Step 1 — visit the page to establish session cookies
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Step 2 — get terms using Puppeteer's page context (cookies included automatically)
    const termsUrl = `${base}/ssb/classSearch/getTerms?offset=1&max=10&searchTerm=`
    await page.goto(termsUrl, { waitUntil: "networkidle2", timeout: 15000 })
    
    const termsText = await page.evaluate(() => document.body.innerText)
    console.log('Terms response:', termsText.slice(0, 300))
    
    const terms = JSON.parse(termsText)
    if (!terms || terms.length === 0) throw new Error('No terms found')
    
    const termCode = terms[0].code
    console.log(`Using term: ${termCode}`)

    // Step 3 — go back to base and save term
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 })
    
    await page.evaluate(async (base, termCode) => {
      await fetch(`${base}/ssb/term/saveTerm?mode=search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`
      })
    }, base, termCode)

    // Step 4 — reset form
    await page.evaluate(async (base) => {
      await fetch(`${base}/ssb/classSearch/resetDataForm`, { method: 'POST' })
    }, base)

    // Step 5 — navigate to search results directly
    const searchUrl = `${base}/ssb/classSearch/get_subject_courses?term=${termCode}&subject=${subject}&courseNumber=${courseNumber}&pageOffset=0&pageMaxSize=50`
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 })
    
    const searchText = await page.evaluate(() => document.body.innerText)
    console.log('Search response:', searchText.slice(0, 500))

    const searchResponse = JSON.parse(searchText)
    if (!searchResponse?.data) return []

    const sections = searchResponse.data.map(section => ({
      crn: section.courseReferenceNumber,
      subject: section.subject,
      number: section.courseNumber,
      title: section.courseTitle,
      instructor: section.faculty?.[0]?.displayName || 'TBA',
      time: section.meetingsFaculty?.[0]?.meetingTime
        ? `${section.meetingsFaculty[0].meetingTime.beginTime || 'TBA'} - ${section.meetingsFaculty[0].meetingTime.endTime || 'TBA'}`
        : 'TBA',
      days: section.meetingsFaculty?.[0]?.meetingTime
        ? ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
            .filter(d => section.meetingsFaculty[0].meetingTime[d])
            .map(d => d.slice(0,3).toUpperCase())
            .join('/')
        : 'TBA',
      format: section.instructionalMethod || 'TBA',
      seatsAvailable: section.seatsAvailable,
      maximumEnrollment: section.maximumEnrollment,
      waitlistAvailable: section.waitAvailable,
      campus: section.campusDescription,
      startDate: section.meetingsFaculty?.[0]?.meetingTime?.startDate || '',
      endDate: section.meetingsFaculty?.[0]?.meetingTime?.endDate || '',
    }))

    return sections

  } finally {
    await browser.close()
  }
}

// ── Colleague Scraper ──
async function scrapeColleague(baseUrl, subject, courseNumber) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

    // Build search URL directly with query params
    const searchUrl = `${baseUrl}?subjects=${subject}&search=true`
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Wait for results
    await page.waitForSelector(".course-section, [class*='section'], [class*='course']", { timeout: 15000 })

    const html = await page.content()
    const $ = cheerio.load(html)
    const sections = []

    $("[class*='section-item'], [class*='course-section']").each((_, el) => {
      const row = $(el)

      // Filter by course number
      const title = row.find("[class*='title'], h3, h4").text().trim()
      if (!title.toUpperCase().includes(courseNumber.toUpperCase())) return

      const status = row.find("[class*='availability'], [class*='status']").text().trim()
      const seats = row.find("[class*='seats'], [class*='available']").text().trim()
      const time = row.find("[class*='meeting'], [class*='time']").text().trim()
      const instructor = row.find("[class*='instructor'], [class*='faculty']").text().trim()
      const format = row.find("[class*='method'], [class*='instruction']").text().trim()

      sections.push({ title, status, seats, time, instructor, format })
    })

    return sections

  } finally {
    await browser.close()
  }
}

async function fetchGeCoursesViaBrowser(institutionId, academicYearId) {
  const url = `https://assist.org/api/transferability/courses?institutionId=${institutionId}&academicYearId=${academicYearId}&listType=CALGETC`
  
  // Try with different referer/origin headers to pass the 400
  const response = await axios.get(url, {
    headers: {
      ...browserHeaders,
      accept: 'application/json, text/plain, */*',
      referer: `https://assist.org/transfer/results?year=${academicYearId}&institution=${institutionId}&type=CALGETC&view=transferability&viewBy=calgetcArea&viewByKey=all&viewSendingAgreements=false`,
      origin: 'https://assist.org',
      'x-requested-with': 'XMLHttpRequest',
    }
  })
  
  // Parse into byCode map: { "1A": [...courses], "2": [...], ... }
  const byCode = {}
  for (const course of (response.data.courseInformationList || [])) {
    for (const area of (course.transferAreas || [])) {
      if (!byCode[area.code]) byCode[area.code] = []
      byCode[area.code].push({
        prefix: course.prefixCode,
        courseNumber: course.courseNumber,
        courseTitle: course.courseTitle,
        minUnits: course.minUnits,
        courseIdentifierParentId: course.courseIdentifierParentId,
        isTerminated: false,
      })
    }
  }
  return byCode
}

// ── School Platform Lists ──
const BANNER_SCHOOLS = [
  "Bakersfield", "Porterville", "Copper Mountain", "Cerro Coso", "Barstow",
  "Canada College", "Skyline", "College of San Mateo", "Las Positas", "Chabot",
  "College of the Siskiyous", "Compton", "Cuesta", "Gavilan", "Monterey Peninsula",
  "Mount San Antonio", "Santa Rosa", "Sierra College", "Solano", "Taft"
]

const COLLEAGUE_SCHOOLS = [
  "Butte", "Cabrillo", "Chaffey", "Clovis", "Fresno City", "Reedley", "Madera",
  "Kings River", "College of the Canyons", "College of the Desert", "Cuyamaca",
  "Grossmont", "El Camino", "Evergreen Valley", "San Jose City", "Hartnell",
  "Lake Tahoe", "Mendocino", "Merced College", "Mt. San Jacinto", "Napa Valley",
  "Ohlone", "Palo Verde", "Santiago Canyon", "Santa Ana", "Shasta",
  "Southwestern", "Victor Valley", "Woodland"
]

// ── Schedule Endpoint ──
app.get("/api/schedule", async (req, res) => {
  const { cc, subject, number, url } = req.query

  if (!cc || !subject || !number || !url) {
    return res.status(400).json({ error: "Missing required params: cc, subject, number, url" })
  }

  try {
    let sections = []
    const isBanner = BANNER_SCHOOLS.some(s => cc.toLowerCase().includes(s.toLowerCase()))
    const isColleague = COLLEAGUE_SCHOOLS.some(s => cc.toLowerCase().includes(s.toLowerCase()))

    if (isBanner) {
      sections = await scrapeBanner(url, subject, number)
    } else if (isColleague) {
      sections = await scrapeColleague(url, subject, number)
    } else {
      return res.json({ supported: false, url })
    }

    res.json({ supported: true, cc, sections })
  } catch (err) {
    console.error("Scrape error:", err.message)
    res.status(500).json({ error: "Scrape failed", details: err.message })
  }
})

// ── GE Courses Endpoint ──
app.get("/api/ge-courses", async (req, res) => {
  const { institutionId, academicYearId } = req.query
  if (!institutionId || !academicYearId) {
    return res.status(400).json({ error: "Missing params: institutionId, academicYearId" })
  }
  try {
    const data = await fetchGeCoursesViaBrowser(institutionId, academicYearId)
    res.set("Cache-Control", "no-store")
    res.json(data)
  } catch (err) {
    console.error("GE courses fetch error:", err.message)
    res.status(500).json({ error: err.message })
  }
})
app.post("/Transferability/api/Courses", async (req, res) => {
  try {
    const response = await axios.post(
      `${ASSIST_BASE}/Transferability/api/Courses`,
      req.body,
      { headers: { ...browserHeaders, accept: "application/json", "Content-Type": "application/json" } }
    )
    res.set("Cache-Control", "no-store")
    res.json(response.data)
  } catch (err) {
    console.error("Transferability proxy error:", err.response?.status, err.response?.data)
    res.status(err.response?.status || 500).json({ error: err.message })
  }
})


// ── Health Check ──
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend running" })
})

const PORT = process.env.PORT || 3001

app.get("/api/debug", async (req, res) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")
    await page.goto("https://ct-prod-bsr.taftcollege.edu:8443/StudentRegistrationSsb/ssb/term/termSelection?mode=search", { waitUntil: "networkidle2", timeout: 30000 })
    const html = await page.content()
    res.send(html)
  } finally {
    await browser.close()
  }
})

app.get("/api/debug-banner", async (req, res) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  })
  const log = {}

  try {
    const page = await browser.newPage()
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

    const base = "https://ct-prod-bsr.taftcollege.edu:8443/StudentRegistrationSsb"
    const termSelectionUrl = `${base}/ssb/term/termSelection?mode=search`

    // Step 1
    await page.goto(termSelectionUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Step 2 - get terms (parse FULL text, don't slice before parsing)
    const termsUrl = `${base}/ssb/classSearch/getTerms?offset=1&max=10&searchTerm=`
    await page.goto(termsUrl, { waitUntil: "networkidle2", timeout: 15000 })
    const termsFullText = await page.evaluate(() => document.body.innerText)
    log.step2_terms_preview = termsFullText.slice(0, 200)

    const terms = JSON.parse(termsFullText)
    const termCode = terms[0]?.code
    log.termCode = termCode

    // Step 3 - go back to term selection page first
    await page.goto(termSelectionUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Step 4 - save term via direct navigation
    const saveTermUrl = `${base}/ssb/term/saveTerm?mode=search&term=${termCode}`
    await page.goto(saveTermUrl, { waitUntil: "networkidle2", timeout: 15000 })
    log.step4_saveTerm = (await page.evaluate(() => document.body.innerText)).slice(0, 300)
    log.step4_url = page.url()

    // Step 5 - visit class search page
    const classSearchUrl = `${base}/ssb/classSearch/classSearch`
    await page.goto(classSearchUrl, { waitUntil: "networkidle2", timeout: 15000 })
    log.step5_classSearch_preview = (await page.evaluate(() => document.body.innerText)).slice(0, 300)
    log.step5_url = page.url()

    // Step 6 - actual course search
    const subject = req.query.subject || 'MATH'
    const number = req.query.number || '1540'
    const searchUrl = `${base}/ssb/searchResults/searchResults?txt_term=${termCode}&txt_subject=${subject}&txt_courseNumber=${number}&pageOffset=0&pageMaxSize=50`
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 })
    log.step6_search_full = await page.evaluate(() => document.body.innerText)
    log.step6_url = page.url()

    res.json(log)

  } catch (err) {
    res.status(500).json({ error: err.message, log })
  } finally {
    await browser.close()
  }
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
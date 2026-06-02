import express from 'express'
import cors from 'cors'
import axios from 'axios'

const app = express()
app.use(cors())

const ASSIST_BASE = 'https://prod.assistng.org'
const ASSIST_ORG = 'https://assist.org'

const BROWSER_COOKIES = '_gid=GA1.2.857321703.1780100882; _ga_9J82FS6VLV=GS2.1.s1780186056$o3$g1$t1780186066$j50$l0$h0; XSRF-TOKEN=CfDJ8IU5_I83bWdBgh1uAlJU5ywEF0ntW1mYBoCrAK1ghSq6j0xZAu3bd_tG3lu0A0AVH4Vy_l8qCEap16jvmPNHqDkyehJK-89_8uGU5jVSY-A0pFrCwtPS1SwzqOv12yqJzbXW8UI9zz81YogjLBZpSko; X-XSRF-TOKEN=CfDJ8IU5_I83bWdBgh1uAlJU5ywCr1eBufmcHla-kvmPBPII7-oCtclxwCX5Kzb6JXI5bofFgZ82BWZ09Mc8Pj4zYBbQHiHQyD8DFY46i7CJhZhpJ07kK_fvWIzPeb_wuZ0drMwTgqogTk8G2adCKH-1UGw; _gat=1; _ga=GA1.1.2082058899.1780100882; ARRAffinity=226a915da8461b6e5e988987330ed497a395b40169ecbe3bf34a1b4a53c0c05d; ARRAffinitySameSite=226a915da8461b6e5e988987330ed497a395b40169ecbe3bf34a1b4a53c0c05d; _ga_BK5B9XCQZP=GS2.1.s1780427501$o60$g1$t1780428970$j49$l0$h0'

function extractXsrfToken(cookieString) {
  const match = cookieString.match(/X-XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const XSRF_TOKEN = extractXsrfToken(BROWSER_COOKIES)
console.log('[init] XSRF token:', XSRF_TOKEN?.slice(0, 30) + '...')

const browserHeaders = {
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

app.use('/assist', async (req, res) => {
  try {
    const url = `${ASSIST_BASE}${req.url}`
    console.log('[/assist]', url)
    const response = await axios.get(url, {
      headers: { ...browserHeaders, 'accept': 'application/json' }
    })
    res.set('Cache-Control', 'no-store')
    res.json(response.data)
  } catch (e) {
    console.error('[/assist] error', e.response?.status, e.message)
    res.status(e.response?.status || 500).json({ error: e.message })
  }
})

app.use('/transferablecourselist', async (req, res) => {
  try {
    const url = `${ASSIST_ORG}/transferablecourselist${req.url}`
    const { institutionId = '', academicYearId = '', listType = '' } = req.query

    const requestHeaders = {
      ...browserHeaders,
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'Referer': `${ASSIST_ORG}/transfer/results?year=${academicYearId}&institution=${institutionId}&type=${listType}&view=transferability`,
      'Cookie': BROWSER_COOKIES,
      'x-xsrf-token': XSRF_TOKEN,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    }

    console.log('\n[/transferablecourselist] →', url)
    console.log('[headers sent]', JSON.stringify(requestHeaders, null, 2))

    const response = await axios.get(url, { headers: requestHeaders })
    res.set('Cache-Control', 'no-store')
    res.json(response.data)
  } catch (e) {
    console.error('\n[/transferablecourselist] FAILED')
    console.error('  status:', e.response?.status)
    console.error('  response body:', JSON.stringify(e.response?.data, null, 2))
    console.error('  message:', e.message)
    res.status(e.response?.status || 500).json({
      error: e.message,
      status: e.response?.status,
      body: e.response?.data,
    })
  }
})

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`)
})
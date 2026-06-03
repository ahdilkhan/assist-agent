export default async function handler(req, res) {
  const path = req.url.replace('/api/assist', '')
  const url = `https://prod.assistng.org${path}`

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    })
    const data = await response.json()
    res.setHeader('Cache-Control', 's-maxage=3600')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
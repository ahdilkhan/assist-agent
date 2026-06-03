export default async function handler(req, res) {
  const path = req.url.replace('/api/assist', '')
  const url = `https://prod.assistng.org${path}`
  
  const response = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    }
  })
  
  const data = await response.json()
  res.setHeader('Cache-Control', 'public, s-maxage=3600')
  res.json(data)
}
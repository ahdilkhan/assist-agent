const ASSIST_BASE = 'https://assist.org'
const YEAR_ID = 76
const UNI_IDS = [79,89,120,117,144,46,7,128,132,98,143,141,50,21,29,129,81,76,1,12,42,115,75,11,60,85,23,26,116,39,88,24]
const CC_ID = 113

const titles = new Set()
let checked = 0

for (const uniId of UNI_IDS) {
  try {
    const r1 = await fetch(`${ASSIST_BASE}/articulation/api/Agreements/Published/for/${uniId}/to/${CC_ID}/in/${YEAR_ID}?types=Major`, {headers:{accept:'application/json'}})
    const d1 = await r1.json()
    const majors = (d1.result?.reports || d1.result?.allReports || []).filter(r => r.type === 'Major')
    for (const major of majors) {
      try {
        const r2 = await fetch(`${ASSIST_BASE}/articulation/api/Agreements?Key=${encodeURIComponent(major.key)}`, {headers:{accept:'application/json'}})
        const d2 = await r2.json()
        const assets = JSON.parse(d2.result?.templateAssets || '[]')
        const reqTitles = assets.filter(a => a.type === 'RequirementTitle').map(a => a.content)
        reqTitles.forEach(t => titles.add(t))
        checked++
        if (checked % 20 === 0) console.log(`checked ${checked} majors...`)
      } catch {}
    }
  } catch {}
}

console.log('\nALL UNIQUE groupTitles:')
console.log([...titles].sort().join('\n'))



import { useState, useEffect } from 'react'

const ASSIST_BASE = import.meta.env.VITE_ASSIST_BASE
const YEAR_ID = 75

async function assistGet(path) {
  const res = await fetch(`${ASSIST_BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ASSIST ${res.status}: ${path}`)
  const data = await res.json()
  if (!data.isSuccessful) throw new Error(data.validationFailure || 'ASSIST error')
  return data.result
}

async function getMajorsForUni(uniId, ccId) {
  const result = await assistGet(
    `/articulation/api/Agreements/Published/for/${uniId}/to/${ccId}/in/${YEAR_ID}?types=Major`
  )
  return result.reports?.filter(r => r.type === 'Major') || []
}

async function getAgreement(key) {
  return assistGet(`/articulation/api/Agreements?Key=${encodeURIComponent(key)}`)
}

function parseAllForProgram(agreement, programLabel) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []

    const results = []
    for (const item of arts) {
      const art = item.articulation || item
      const receiving = art.course || art.receivingCourse
      if (!receiving) continue
      const sendingArt = art.sendingArticulation
      if (!sendingArt || sendingArt.noArticulationReason) continue
      const courseGroups = sendingArt?.items || []
      if (courseGroups.length === 0) continue

      const options = courseGroups.map(group => ({
        groupNote: group.attributes?.[0]?.content || null,
        courses: (group.items || [group]).map(c => ({
          prefix: (c.prefix || '').trim(),
          number: (c.courseNumber || c.number || '').trim(),
          title: c.courseTitle || c.title || '',
          units: c.maxUnits || c.minUnits || null,
          note: c.attributes?.[0]?.content || null
        })).filter(c => c.prefix && c.number)
      })).filter(g => g.courses.length > 0)

      if (options.length > 0) {
        results.push({
          program: programLabel,
          uniRequirement: {
            prefix: (receiving.prefix || '').trim(),
            number: (receiving.courseNumber || receiving.number || '').trim(),
            title: receiving.courseTitle || receiving.title || '',
            units: receiving.maxUnits || receiving.minUnits || null
          },
          options
        })
      }
    }
    return results
  } catch (e) { return [] }
}

const KNOWN_UNIVERSITIES = [
  { group: 'UC', options: [
    { id: 79, name: 'UC Berkeley' },
    { id: 89, name: 'UC Davis' },
    { id: 120, name: 'UC Irvine' },
    { id: 117, name: 'UCLA' },
    { id: 144, name: 'UC Merced' },
    { id: 46, name: 'UC Riverside' },
    { id: 7, name: 'UC San Diego' },
    { id: 128, name: 'UC Santa Barbara' },
    { id: 132, name: 'UC Santa Cruz' },
  ]},
  { group: 'CSU', options: [
    { id: 98, name: 'CSU Bakersfield' },
    { id: 143, name: 'CSU Channel Islands' },
    { id: 141, name: 'CSU Chico' },
    { id: 50, name: 'CSU Dominguez Hills' },
    { id: 21, name: 'CSU East Bay' },
    { id: 29, name: 'CSU Fresno' },
    { id: 129, name: 'CSU Fullerton' },
    { id: 81, name: 'CSU Long Beach' },
    { id: 76, name: 'CSU Los Angeles' },
    { id: 1, name: 'CSU Maritime Academy' },
    { id: 12, name: 'CSU Monterey Bay' },
    { id: 42, name: 'CSU Northridge' },
    { id: 115, name: 'Cal Poly Humboldt' },
    { id: 75, name: 'Cal Poly Pomona' },
    { id: 11, name: 'Cal Poly SLO' },
    { id: 60, name: 'CSU Sacramento' },
    { id: 85, name: 'CSU San Bernardino' },
    { id: 23, name: 'CSU San Marcos' },
    { id: 26, name: 'San Diego State' },
    { id: 116, name: 'SF State' },
    { id: 39, name: 'San Jose State' },
    { id: 88, name: 'Sonoma State' },
    { id: 24, name: 'CSU Stanislaus' },
  ]},
  { group: 'Independent', options: [
    { id: 230, name: 'Azusa Pacific University' },
    { id: 205, name: 'California Baptist University' },
    { id: 201, name: 'California Lutheran University' },
    { id: 204, name: 'Charles R. Drew University' },
    { id: 207, name: 'Concordia University Irvine' },
    { id: 211, name: 'Dominican University of California' },
    { id: 206, name: 'Fresno Pacific University' },
    { id: 209, name: 'Loyola Marymount University' },
    { id: 216, name: 'Menlo College' },
    { id: 212, name: "Mount Saint Mary's University LA" },
    { id: 213, name: 'National University' },
    { id: 222, name: 'Palo Alto University' },
    { id: 214, name: 'Pepperdine University' },
    { id: 227, name: 'Santa Clara University' },
    { id: 228, name: 'Simpson University' },
    { id: 215, name: 'Touro University Worldwide' },
    { id: 234, name: 'University of San Diego' },
    { id: 235, name: 'University of San Francisco' },
    { id: 217, name: 'University of the Pacific' },
    { id: 220, name: 'University of Redlands' },
    { id: 224, name: 'Whittier College' },
  ]},
]

// Full list of all California community colleges with ASSIST IDs
const KNOWN_CCS = [
  { id: 110, name: 'Allan Hancock College' },
  { id: 27, name: 'American River College' },
  { id: 121, name: 'Antelope Valley College' },
  { id: 84, name: 'Bakersfield College' },
  { id: 9, name: 'Barstow Community College' },
  { id: 111, name: 'College of Alameda' },
  { id: 8, name: 'Butte College' },
  { id: 41, name: 'Cabrillo College' },
  { id: 68, name: 'Canada College' },
  { id: 104, name: 'Cerritos College' },
  { id: 14, name: 'Cerro Coso Community College' },
  { id: 96, name: 'Chabot College' },
  { id: 69, name: 'Chaffey College' },
  { id: 97, name: 'Citrus College' },
  { id: 33, name: 'City College of San Francisco' },
  { id: 150, name: 'Clovis Community College' },
  { id: 6, name: 'Columbia College' },
  { id: 140, name: 'College of the Canyons' },
  { id: 15, name: 'College of the Desert' },
  { id: 4, name: 'College of Marin' },
  { id: 83, name: 'College of the Redwoods' },
  { id: 5, name: 'College of San Mateo' },
  { id: 34, name: 'College of the Sequoias' },
  { id: 102, name: 'College of the Siskiyous' },
  { id: 153, name: 'Compton College' },
  { id: 28, name: 'Contra Costa College' },
  { id: 112, name: 'Copper Mountain College' },
  { id: 142, name: 'Cosumnes River College' },
  { id: 70, name: 'Crafton Hills College' },
  { id: 16, name: 'Cuesta College' },
  { id: 99, name: 'Cuyamaca College' },
  { id: 71, name: 'Cypress College' },
  { id: 113, name: 'De Anza College' },
  { id: 114, name: 'Diablo Valley College' },
  { id: 118, name: 'East Los Angeles College' },
  { id: 103, name: 'El Camino College' },
  { id: 2, name: 'Evergreen Valley College' },
  { id: 122, name: 'Feather River College' },
  { id: 145, name: 'Folsom Lake College' },
  { id: 51, name: 'Foothill College' },
  { id: 35, name: 'Fresno City College' },
  { id: 134, name: 'Fullerton College' },
  { id: 72, name: 'Gavilan College' },
  { id: 43, name: 'Glendale Community College' },
  { id: 55, name: 'Golden West College' },
  { id: 106, name: 'Grossmont College' },
  { id: 123, name: 'Hartnell College' },
  { id: 20, name: 'Imperial Valley College' },
  { id: 124, name: 'Irvine Valley College' },
  { id: 36, name: 'Kings River College' },
  { id: 40, name: 'Lake Tahoe Community College' },
  { id: 77, name: 'Laney College' },
  { id: 18, name: 'Las Positas College' },
  { id: 82, name: 'Lassen Community College' },
  { id: 146, name: 'Lemoore College' },
  { id: 135, name: 'Long Beach City College' },
  { id: 3, name: 'Los Angeles City College' },
  { id: 31, name: 'Los Angeles Harbor College' },
  { id: 47, name: 'Los Angeles Mission College' },
  { id: 86, name: 'Los Angeles Pierce College' },
  { id: 130, name: 'Los Angeles Southwest College' },
  { id: 25, name: 'Los Angeles Trade Technical College' },
  { id: 44, name: 'Los Angeles Valley College' },
  { id: 61, name: 'Los Medanos College' },
  { id: 200, name: 'Madera Community College' },
  { id: 100, name: 'Mendocino College' },
  { id: 17, name: 'Merced College' },
  { id: 13, name: 'Merritt College' },
  { id: 108, name: 'MiraCosta College' },
  { id: 32, name: 'Mission College' },
  { id: 52, name: 'Modesto Junior College' },
  { id: 139, name: 'Moorpark College' },
  { id: 149, name: 'Moreno Valley College' },
  { id: 62, name: 'Mount San Antonio College' },
  { id: 53, name: 'Mt. San Jacinto College' },
  { id: 73, name: 'Napa Valley College' },
  { id: 148, name: 'Norco College' },
  { id: 48, name: 'Ohlone College' },
  { id: 74, name: 'Orange Coast College' },
  { id: 87, name: 'Oxnard College' },
  { id: 63, name: 'Palo Verde College' },
  { id: 56, name: 'Palomar College' },
  { id: 49, name: 'Pasadena City College' },
  { id: 125, name: 'Porterville College' },
  { id: 107, name: 'Reedley College' },
  { id: 64, name: 'Rio Hondo College' },
  { id: 78, name: 'Riverside City College' },
  { id: 126, name: 'Sacramento City College' },
  { id: 65, name: 'Saddleback College' },
  { id: 131, name: 'San Bernardino Valley College' },
  { id: 54, name: 'San Diego City College' },
  { id: 101, name: 'San Diego Mesa College' },
  { id: 45, name: 'San Diego Miramar College' },
  { id: 109, name: 'San Joaquin Delta College' },
  { id: 10, name: 'San Jose City College' },
  { id: 136, name: 'Santa Ana College' },
  { id: 92, name: 'Santa Barbara City College' },
  { id: 137, name: 'Santa Monica College' },
  { id: 57, name: 'Santa Rosa Junior College' },
  { id: 66, name: 'Santiago Canyon College' },
  { id: 38, name: 'Shasta College' },
  { id: 93, name: 'Sierra College' },
  { id: 127, name: 'Skyline College' },
  { id: 94, name: 'Solano Community College' },
  { id: 138, name: 'Southwestern College' },
  { id: 119, name: 'Taft College' },
  { id: 95, name: 'Ventura College' },
  { id: 19, name: 'Victor Valley College' },
  { id: 91, name: 'West Los Angeles College' },
  { id: 67, name: 'West Valley College' },
  { id: 147, name: 'Woodland Community College' },
  { id: 90, name: 'Yuba College' },
].sort((a, b) => a.name.localeCompare(b.name))

export default function Tab3() {
  const [ccId, setCcId] = useState('')
  const [ccName, setCcName] = useState('')

  // Program builder
  const [selUniId, setSelUniId] = useState('')
  const [selUniName, setSelUniName] = useState('')
  const [majors, setMajors] = useState([])
  const [majorsLoading, setMajorsLoading] = useState(false)
  const [selMajor, setSelMajor] = useState(null)
  const [programs, setPrograms] = useState([]) // [{uniId, uniName, majorLabel, majorKey}]
  const majorCache = useState({})[0] // cache per uniId

  // Results
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [overlapData, setOverlapData] = useState(null) // { all, most, single }
  const [openBlocks, setOpenBlocks] = useState({})

  // Load majors when university changes in program builder
  useEffect(() => {
    if (!selUniId || !ccId) { setMajors([]); setSelMajor(null); return }
    if (majorCache[selUniId]) { setMajors(majorCache[selUniId]); setSelMajor(null); return }
    setMajors([])
    setSelMajor(null)
    setMajorsLoading(true)
    getMajorsForUni(selUniId, ccId)
      .then(list => {
        const sorted = list.sort((a, b) => a.label.localeCompare(b.label))
        majorCache[selUniId] = sorted
        setMajors(sorted)
      })
      .catch(() => setMajors([]))
      .finally(() => setMajorsLoading(false))
  }, [selUniId, ccId])

  function addProgram() {
    if (!selUniId || !selMajor) return
    const already = programs.find(p => p.uniId === selUniId && p.majorKey === selMajor.key)
    if (already) return
    setPrograms(prev => [...prev, {
      uniId: selUniId,
      uniName: selUniName,
      majorLabel: selMajor.label,
      majorKey: selMajor.key
    }])
    setSelMajor(null)
  }

  function removeProgram(i) {
    setPrograms(prev => prev.filter((_, j) => j !== i))
  }

  async function generateOverlap() {
    if (!ccId || programs.length === 0) { setError('Select a CC and add at least one program.'); return }
    setError('')
    setLoading(true)
    setOverlapData(null)
    setOpenBlocks({})

    try {
      // Fetch all program articulations in parallel
      const programArts = await Promise.all(programs.map(async prog => {
        setLoadingMsg(`Fetching ${prog.uniName} — ${prog.majorLabel}...`)
        const agreement = await getAgreement(prog.majorKey)
        const arts = parseAllForProgram(agreement, `${prog.uniName} → ${prog.majorLabel}`)
        return { prog, arts }
      }))

      const totalPrograms = programs.length

      // Build map: ccCourseKey -> { ccCourses, programs: [{program, uniReq, options}] }
      const reqMap = {}

      for (const { prog, arts } of programArts) {
        for (const art of arts) {
          // Use the option with fewest courses as the "primary" key
          const primaryOpt = art.options.reduce((a, b) => a.courses.length <= b.courses.length ? a : b)
          const ccKey = primaryOpt.courses.map(c => `${c.prefix} ${c.number}`).sort().join('+')

          if (!reqMap[ccKey]) {
            reqMap[ccKey] = {
              ccKey,
              primaryCourses: primaryOpt.courses,
              programEntries: []
            }
          }
          reqMap[ccKey].programEntries.push({
            program: `${prog.uniName} → ${prog.majorLabel}`,
            uniReq: art.uniRequirement,
            options: art.options
          })
        }
      }

      // Group by coverage
      const all = []
      const most = []
      const single = []

      for (const entry of Object.values(reqMap)) {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        entry.coverage = coverage
        entry.coverageLabel = `${coverage}/${totalPrograms} programs`
        if (coverage === totalPrograms) all.push(entry)
        else if (coverage > 1) most.push(entry)
        else single.push(entry)
      }

      // Sort each group by coverage desc then by cc course name
      const sortFn = (a, b) => b.coverage - a.coverage || a.ccKey.localeCompare(b.ccKey)
      all.sort(sortFn)
      most.sort(sortFn)
      single.sort(sortFn)

      setOverlapData({ all, most, single, totalPrograms })
    } catch (e) {
      setError(`Error: ${e.message}`)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  function toggleBlock(key) {
    setOpenBlocks(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function renderReqCard(entry) {
    const key = entry.ccKey
    const isOpen = openBlocks[key]
    return (
      <div className="result-block" key={key}>
        <div className="result-header" onClick={() => toggleBlock(key)}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>
              {entry.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {entry.primaryCourses.map(c => c.title).join(' + ')}
              {entry.primaryCourses[0]?.units ? ` · ${entry.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)} total units` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge ${entry.coverage === entry.totalPrograms ? 'badge-green' : entry.coverage > 1 ? 'badge-amber' : 'badge-gray'}`}>
              {entry.coverageLabel}
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>{isOpen ? '▲' : '▼'}</span>
          </div>
        </div>
        {isOpen && (
          <div className="result-body">
            {entry.programEntries.map((pe, i) => (
              <div key={i} style={{ marginBottom: i < entry.programEntries.length - 1 ? 14 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{pe.program}</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                  Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
                  {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                </div>
                {pe.options.map((opt, j) => (
                  <div key={j}>
                    {j > 0 && <div style={{ fontSize: 11, color: '#888', padding: '3px 0' }}>— or —</div>}
                    {opt.groupNote && <div style={{ fontSize: 11, color: '#f57f17', marginBottom: 3 }}>⚠️ {opt.groupNote}</div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {opt.courses.map((c, k) => (
                        <span key={k} style={{ background: '#f0f0f0', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontFamily: 'monospace' }}>
                          {c.prefix} {c.number}
                          {c.note ? ' ⚠️' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      {!overlapData && (
        <>
          {/* Step 1: CC */}
          <div className="card">
            <div className="section-label" style={{ marginBottom: 10 }}>Step 1 — Your community college</div>
            <div className="field" style={{ marginBottom: 0 }}>
              <select value={ccId} onChange={e => {
                setCcId(e.target.value)
                setCcName(e.target.selectedOptions[0]?.text || '')
                setPrograms([])
                setSelUniId('')
                setMajors([])
              }}>
                <option value="">Select your CC...</option>
                {KNOWN_CCS.map(cc => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
              </select>
            </div>
          </div>

          {/* Step 2: Add programs */}
          {ccId && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: 10 }}>Step 2 — Add target programs</div>

              {programs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {programs.map((p, i) => (
                    <div key={i} style={{ background: '#f0f0f0', borderRadius: 20, padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{p.uniName}</span>
                      <span style={{ color: '#666' }}>→ {p.majorLabel}</span>
                      <span onClick={() => removeProgram(i)} style={{ cursor: 'pointer', color: '#999', fontSize: 16, lineHeight: 1 }}>×</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>University</label>
                  <select value={selUniId} onChange={e => {
                    setSelUniId(e.target.value)
                    setSelUniName(e.target.selectedOptions[0]?.text || '')
                    setSelMajor(null)
                  }}>
                    <option value="">Select university...</option>
                    {KNOWN_UNIVERSITIES.map(g => (
                      <optgroup key={g.group} label={g.group}>
                        {g.options.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Major</label>
                  {majorsLoading
                    ? <div className="status" style={{ padding: '9px 0' }}><div className="spinner" />Loading...</div>
                    : <select value={selMajor?.key || ''} onChange={e => {
                        const found = majors.find(m => m.key === e.target.value)
                        setSelMajor(found || null)
                      }} disabled={!selUniId || majors.length === 0}>
                        <option value="">{!selUniId ? 'Select university first' : majors.length === 0 ? 'No majors found' : 'Select major...'}</option>
                        {majors.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                  }
                </div>
              </div>

              <button
                className="btn-secondary"
                style={{ width: '100%', marginTop: 4 }}
                onClick={addProgram}
                disabled={!selUniId || !selMajor}
              >+ Add program</button>
            </div>
          )}

          {/* Step 3: Generate */}
          {programs.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: 10 }}>Step 3 — Generate overlap</div>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
                Analyzing {programs.length} program{programs.length > 1 ? 's' : ''} to find which {ccName} courses give you the most coverage.
              </p>
              {loading
                ? <div className="status"><div className="spinner" />{loadingMsg}</div>
                : <button className="btn-primary" onClick={generateOverlap}>Generate transfer overlap →</button>
              }
            </div>
          )}
        </>
      )}

      {/* Results */}
      {overlapData && (
        <>
          <div className="top-row">
            <div className="top-row-info">
              <h2>Transfer overlap — {ccName}</h2>
              <p>{programs.map(p => `${p.uniName} → ${p.majorLabel}`).join(' · ')}</p>
            </div>
            <button className="btn-secondary" onClick={() => { setOverlapData(null); setOpenBlocks({}) }}>← Edit</button>
          </div>

          {overlapData.all.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🟢</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Required by all {overlapData.totalPrograms} programs</div>
                  <div style={{ fontSize: 12, color: '#888' }}>Highest priority — take these first</div>
                </div>
              </div>
              {overlapData.all.map(e => renderReqCard({ ...e, totalPrograms: overlapData.totalPrograms }))}
            </div>
          )}

          {overlapData.most.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🟡</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Required by multiple programs</div>
                  <div style={{ fontSize: 12, color: '#888' }}>High value — maximizes your coverage</div>
                </div>
              </div>
              {overlapData.most.map(e => renderReqCard({ ...e, totalPrograms: overlapData.totalPrograms }))}
            </div>
          )}

          {overlapData.single.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🔵</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Required by one program only</div>
                  <div style={{ fontSize: 12, color: '#888' }}>Take if you're committed to that specific program</div>
                </div>
              </div>
              {overlapData.single.map(e => renderReqCard({ ...e, totalPrograms: overlapData.totalPrograms }))}
            </div>
          )}

          {overlapData.all.length === 0 && overlapData.most.length === 0 && overlapData.single.length === 0 && (
            <div className="key-note">No articulated courses found for these programs. Try different programs or check ASSIST.org directly.</div>
          )}
        </>
      )}
    </div>
  )
}

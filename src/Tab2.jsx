import { useState, useEffect } from 'react'
import { KNOWN_UNIVERSITIES, KNOWN_CCS } from './App'

const ASSIST_BASE = import.meta.env.VITE_ASSIST_BASE
const YEAR_ID = import.meta.env.VITE_ACADEMIC_YEAR_ID || 76

async function assistGet(path) {
  const res = await fetch(`${ASSIST_BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ASSIST ${res.status}: ${path}`)
  const data = await res.json()
  if (!data.isSuccessful) throw new Error(data.validationFailure || 'ASSIST error')
  return data.result
}

async function getMajorsForUni(uniId, ccId) {
  try {
    const result = await assistGet(
      `/articulation/api/Agreements/Published/for/${uniId}/to/${ccId}/in/${YEAR_ID}?types=Major`
    )
    const reports = result.allReports || result.reports || []
    console.log(`uni ${uniId} cc ${ccId} reports:`, JSON.stringify(reports, null, 2))
    const majors = reports.filter(r => ['Major', 'Department'].includes(r.type))
    if (majors.length > 0) return majors
  } catch (e) {
    console.warn(`Standard endpoint failed uni ${uniId} cc ${ccId}:`, e.message)
  }

  try {
    const result = await assistGet(
      `/articulation/api/Agreements/Published/for/${uniId}/to/${ccId}/in/75?types=Major`
    )
    const reports = result.allReports || result.reports || []
    console.log(`year75 uni ${uniId} cc ${ccId} reports:`, JSON.stringify(reports, null, 2))
    const majors = reports.filter(r => ['Major', 'Department'].includes(r.type))
    if (majors.length > 0) return majors
  } catch (e) {
    console.warn(`Year 75 fallback failed:`, e.message)
  }

  try {
    const result = await assistGet(
      `/articulation/api/Agreements/Published/for/${ccId}/to/${uniId}/in/${YEAR_ID}?types=Major`
    )
    const reports = result.allReports || result.reports || []
    console.log(`reversed uni ${uniId} cc ${ccId} reports:`, JSON.stringify(reports, null, 2))
    const majors = reports.filter(r => ['Major', 'Department'].includes(r.type))
    if (majors.length > 0) return majors
  } catch (e) {
    console.warn(`Reversed direction failed:`, e.message)
  }

  return []
}

async function getAgreement(key) {
  return assistGet(`/articulation/api/Agreements?Key=${encodeURIComponent(key)}`)
}

function extractCourse(c) {
  const prefix = (c.prefix || '').trim()
  const number = (c.courseNumber || c.number || '').trim()
  if (!prefix || !number) return null
  return {
    prefix,
    number,
    title: c.courseTitle || c.title || '',
    units: c.maxUnits || c.minUnits || null,
    note: c.attributes?.[0]?.content || null,
  }
}

function parseSendingOptions(topItems) {
  if (!topItems || topItems.length === 0) return []
  const options = []
  for (const group of topItems) {
    const conjunction = (group.courseConjunction || '').toLowerCase()
    const subItems = group.items || []
    const groupNote = group.attributes?.[0]?.content || null
    if (subItems.length === 0) continue
    if (conjunction === 'or') {
      for (const course of subItems) {
        const c = extractCourse(course)
        if (c) options.push({ courses: [c], groupNote: course.attributes?.[0]?.content || null })
      }
    } else {
      const courses = subItems.map(extractCourse).filter(Boolean)
      if (courses.length) options.push({ courses, groupNote })
    }
  }
  return options
}

function parseAllForProgram(agreement, programLabel) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []
    const results = []

    for (const item of arts) {
      const art = item.articulation || item

      // Same 4-shape collection as Tab1
      let receivingCourses = []
      if (art.course) receivingCourses.push(art.course)
      if (art.receivingCourse) receivingCourses.push(art.receivingCourse)
      if (art.courses && Array.isArray(art.courses)) receivingCourses.push(...art.courses)
      if (art.series?.courses && Array.isArray(art.series.courses)) {
        receivingCourses.push(...art.series.courses)
      }

      if (receivingCourses.length === 0) continue

      const sendingArt = art.sendingArticulation
      if (!sendingArt || sendingArt.noArticulationReason) continue

      const options = parseSendingOptions(sendingArt.items || [])
      if (options.length === 0) continue

      // Use first course as the primary requirement label
      const primary = receivingCourses[0]
      results.push({
        program: programLabel,
        uniRequirement: {
          prefix: (primary.prefix || '').trim(),
          number: (primary.courseNumber || primary.number || '').trim(),
          title: primary.courseTitle || primary.title || '',
          units: primary.maxUnits || primary.minUnits || null
        },
        options
      })
    }
    return results
  } catch { return [] }
}

export default function Tab2() {
  const [ccId, setCcId] = useState('')
  const [ccName, setCcName] = useState('')
  const [selUniId, setSelUniId] = useState('')
  const [selUniName, setSelUniName] = useState('')
  const [majors, setMajors] = useState([])
  const [majorsLoading, setMajorsLoading] = useState(false)
  const [selMajor, setSelMajor] = useState(null)
  const [programs, setPrograms] = useState([])
  const majorCache = useState({})[0]
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [overlapData, setOverlapData] = useState(null)
  const [openBlocks, setOpenBlocks] = useState({})
  const [completedCourses, setCompletedCourses] = useState(new Set())

  useEffect(() => {
    if (!selUniId || !ccId) { setMajors([]); setSelMajor(null); return }
    if (majorCache[`${selUniId}-${ccId}`]) { setMajors(majorCache[`${selUniId}-${ccId}`]); setSelMajor(null); return }
    setMajors([])
    setSelMajor(null)
    setMajorsLoading(true)
    getMajorsForUni(selUniId, ccId)
      .then(list => {
        const sorted = list.sort((a, b) => a.label.localeCompare(b.label))
        majorCache[`${selUniId}-${ccId}`] = sorted
        setMajors(sorted)
      })
      .catch(() => setMajors([]))
      .finally(() => setMajorsLoading(false))
  }, [selUniId, ccId])

  function addProgram() {
    if (!selUniId || !selMajor) return
    if (programs.find(p => p.uniId === selUniId && p.majorKey === selMajor.key)) return
    setPrograms(prev => [...prev, { uniId: selUniId, uniName: selUniName, majorLabel: selMajor.label, majorKey: selMajor.key }])
    setSelMajor(null)
  }

  function removeProgram(i) {
    setPrograms(prev => prev.filter((_, j) => j !== i))
  }

  function toggleCourse(ccKey) {
    setCompletedCourses(prev => {
      const next = new Set(prev)
      next.has(ccKey) ? next.delete(ccKey) : next.add(ccKey)
      return next
    })
  }

  async function generateOverlap() {
    if (!ccId || programs.length === 0) { setError('Select a CC and add at least one program.'); return }
    setError('')
    setLoading(true)
    setOverlapData(null)
    setOpenBlocks({})
    setCompletedCourses(new Set())
    try {
      const programArts = await Promise.all(programs.map(async prog => {
        setLoadingMsg(`Fetching ${prog.uniName} — ${prog.majorLabel}...`)
        const agreement = await getAgreement(prog.majorKey)
        const arts = parseAllForProgram(agreement, `${prog.uniName} → ${prog.majorLabel}`)
        return { prog, arts }
      }))

      const totalPrograms = programs.length
      const reqMap = {}

      for (const { prog, arts } of programArts) {
        for (const art of arts) {
          const cheapestOpt = art.options.reduce((a, b) => a.courses.length <= b.courses.length ? a : b)
          const ccKey = cheapestOpt.courses.map(c => `${c.prefix} ${c.number}`).sort().join('+')

          if (!reqMap[ccKey]) {
            reqMap[ccKey] = { ccKey, primaryCourses: cheapestOpt.courses, programEntries: [] }
          }
          const entryKey = `${prog.uniName}|${art.uniRequirement.prefix}|${art.uniRequirement.number}`
          if (!reqMap[ccKey].programEntries.some(e => e._entryKey === entryKey)) {
            reqMap[ccKey].programEntries.push({
              _entryKey: entryKey,
              program: `${prog.uniName} → ${prog.majorLabel}`,
              uniReq: art.uniRequirement,
              options: art.options
            })
          }
        }
      }

      const all = [], most = [], single = []
      for (const entry of Object.values(reqMap)) {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        entry.coverage = coverage
        entry.coverageLabel = `${coverage}/${totalPrograms} programs`
        if (coverage === totalPrograms) all.push(entry)
        else if (coverage > 1) most.push(entry)
        else single.push(entry)
      }
      const sortFn = (a, b) => b.coverage - a.coverage || a.ccKey.localeCompare(b.ccKey)
      all.sort(sortFn); most.sort(sortFn); single.sort(sortFn)
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

  // Compute attainability summary based on checked courses
  function computeAttainability(overlapData) {
    if (!overlapData) return []
    const allEntries = [...overlapData.all, ...overlapData.most, ...overlapData.single]

    // Group entries by program
    const programMap = {}
    for (const prog of programs) {
      const label = `${prog.uniName} → ${prog.majorLabel}`
      programMap[label] = { label, total: 0, completed: 0 }
    }

    for (const entry of allEntries) {
      const isDone = completedCourses.has(entry.ccKey)
      for (const pe of entry.programEntries) {
        if (programMap[pe.program]) {
          programMap[pe.program].total += 1
          if (isDone) programMap[pe.program].completed += 1
        }
      }
    }

    return Object.values(programMap).sort((a, b) => {
      const aPct = a.total === 0 ? 0 : a.completed / a.total
      const bPct = b.total === 0 ? 0 : b.completed / b.total
      return bPct - aPct
    })
  }

  function renderReqCard(entry) {
    const key = entry.ccKey
    const isOpen = openBlocks[key]
    const isDone = completedCourses.has(key)
    const hasAlts = entry.programEntries.some(pe => pe.options.length > 1)
    const label = entry.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')

    return (
      <div className="result-block" key={key} style={{ opacity: isDone ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        <div className="result-header" onClick={() => toggleBlock(key)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <input
              type="checkbox"
              checked={isDone}
              onChange={e => { e.stopPropagation(); toggleCourse(key) }}
              onClick={e => e.stopPropagation()}
              style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, accentColor: '#1a1a1a' }}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#aaa' : '#1a1a1a' }}>{label}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {entry.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')}
                {entry.primaryCourses.some(c => c.units)
                  ? ` · ${entry.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)} units`
                  : ''}
                {hasAlts ? ' · has alternatives' : ''}
              </div>
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
              <div key={i} style={{
                marginBottom: i < entry.programEntries.length - 1 ? 16 : 0,
                paddingBottom: i < entry.programEntries.length - 1 ? 16 : 0,
                borderBottom: i < entry.programEntries.length - 1 ? '1px solid #f0f0f0' : 'none'
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{pe.program}</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>
                    {pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}
                  </span>
                  {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                </div>
                {pe.options.map((opt, j) => (
                  <div key={j}>
                    {j > 0 && <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', padding: '4px 0', fontWeight: 600 }}>— OR —</div>}
                    {opt.courses.length > 1 && (
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Take all together</div>
                    )}
                    {opt.groupNote && <div style={{ fontSize: 11, color: '#f57f17', marginBottom: 4 }}>⚠️ {opt.groupNote}</div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                      {opt.courses.map((c, k) => (
                        <div key={k} style={{ background: '#f0f0f0', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.prefix} {c.number}</span>
                          {c.title && <span style={{ color: '#666', marginLeft: 6 }}>{c.title}</span>}
                          {c.units && <span style={{ color: '#999', marginLeft: 6 }}>{c.units}u</span>}
                          {c.note && (
                            <div style={{ fontSize: 11, color: '#f57f17', marginTop: 4 }}>
                              ⚠️ {c.note}
                            </div>
                          )}
                        </div>
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

  function renderSection(emoji, title, subtitle, entries, totalPrograms) {
    if (entries.length === 0) return null
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>{emoji}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{subtitle}</div>
          </div>
        </div>
        {entries.map(e => renderReqCard({ ...e, totalPrograms }))}
      </div>
    )
  }

  function renderAttainabilitySummary() {
    if (!overlapData || completedCourses.size === 0) return null
    const summary = computeAttainability(overlapData)
    if (summary.length === 0) return null

    const best = summary[0]

    return (
      <div className="card" style={{ marginTop: 8, background: '#f9f9f7', border: '1px solid #e8e8e4' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>📊 Your progress summary</div>
        {summary.map((s, i) => {
          const pct = s.total === 0 ? 0 : Math.round((s.completed / s.total) * 100)
          const isTop = i === 0 && summary.length > 1
          return (
            <div key={i} style={{ marginBottom: i < summary.length - 1 ? 12 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: isTop ? 600 : 400, color: isTop ? '#1a1a1a' : '#555' }}>
                  {isTop && '⭐ '}{s.label}
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>{s.completed}/{s.total} done · {pct}%</div>
              </div>
              <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ background: pct === 100 ? '#4caf50' : '#1a1a1a', height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
              {isTop && summary.length > 1 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Most attainable based on courses completed</div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      {!overlapData && (
        <>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
            Add your target programs and we'll show you which courses at your CC satisfy the most requirements across all of them.
          </div>

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
                    : <select value={selMajor?.key || ''} onChange={e => setSelMajor(majors.find(m => m.key === e.target.value) || null)}
                        disabled={!selUniId || majors.length === 0}>
                        <option value="">{!selUniId ? 'Select university first' : majors.length === 0 ? 'No majors found' : 'Select major...'}</option>
                        {majors.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                  }
                </div>
              </div>
              <button className="btn-secondary" style={{ width: '100%', marginTop: 4 }}
                onClick={addProgram} disabled={!selUniId || !selMajor}>
                + Add program
              </button>
            </div>
          )}

          {programs.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: 10 }}>Step 3 — Generate overlap</div>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
                Analyzing {programs.length} program{programs.length > 1 ? 's' : ''} to find which {ccName} courses give you the most coverage.
              </p>
              {loading
                ? <div className="status"><div className="spinner" />{loadingMsg}</div>
                : <button className="btn-primary" onClick={generateOverlap}>Find my courses →</button>
              }
            </div>
          )}
        </>
      )}

      {overlapData && (
        <>
          <div className="top-row">
            <div className="top-row-info">
              <h2>Your course plan — {ccName}</h2>
              <p>{programs.map(p => `${p.uniName} → ${p.majorLabel}`).join(' · ')}</p>
            </div>
            <button className="btn-secondary" onClick={() => { setOverlapData(null); setOpenBlocks({}) }}>← Edit</button>
          </div>

          <div className="key-note" style={{ marginBottom: 16 }}>
            ☑️ Check off courses you've already completed to track your progress.
          </div>

          {renderSection('🟢', `Required by all ${overlapData.totalPrograms} programs`, 'Highest priority — take these first', overlapData.all, overlapData.totalPrograms)}
          {renderSection('🟡', 'Required by multiple programs', 'High value — maximizes your coverage', overlapData.most, overlapData.totalPrograms)}
          {renderSection('🔵', 'Required by one program only', "Take if you're committed to that specific program", overlapData.single, overlapData.totalPrograms)}

          {overlapData.all.length === 0 && overlapData.most.length === 0 && overlapData.single.length === 0 && (
            <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
          )}

          {renderAttainabilitySummary()}
        </>
      )}
    </div>
  )
}

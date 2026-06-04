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
    for (const yearId of [YEAR_ID, 75, 74]) {
      try {
        const result = await assistGet(
          `/articulation/api/Agreements/Published/for/${uniId}/to/${ccId}/in/${yearId}?types=Major&types=Department`
        )
        const reports = result.reports || result.allReports || []
        const majors = reports.filter(r => r.type === 'Major')
        if (majors.length > 0) return majors
        const departments = reports.filter(r => r.type === 'Department')
        if (departments.length > 0) return departments
        const others = reports.filter(r => r.type !== 'Major' && r.type !== 'Department' && r.type !== 'AllDepartments' && r.type !== 'SendingDepartment')
        if (others.length > 0) return others
      } catch {}
    }
  } catch {}
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
    prefix, number,
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
      let receivingCourses = []
      if (art.course) receivingCourses.push(art.course)
      if (art.receivingCourse) receivingCourses.push(art.receivingCourse)
      if (art.courses && Array.isArray(art.courses)) receivingCourses.push(...art.courses)
      if (art.series?.courses && Array.isArray(art.series.courses)) receivingCourses.push(...art.series.courses)
      if (receivingCourses.length === 0) continue
      const sendingArt = art.sendingArticulation
      if (!sendingArt || sendingArt.noArticulationReason) continue
      const options = parseSendingOptions(sendingArt.items || [])
      if (options.length === 0) continue
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
  const [expandedRow, setExpandedRow] = useState(null)
  const [completedCourses, setCompletedCourses] = useState(new Set())

  useEffect(() => {
    if (!selUniId || !ccId) { setMajors([]); setSelMajor(null); return }
    if (majorCache[`${selUniId}-${ccId}`]) { setMajors(majorCache[`${selUniId}-${ccId}`]); setSelMajor(null); return }
    setMajors([]); setSelMajor(null); setMajorsLoading(true)
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
    setError(''); setLoading(true); setOverlapData(null); setExpandedRow(null)
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

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        return { ...entry, coverage }
      })
      rows.sort((a, b) => b.coverage - a.coverage || a.ccKey.localeCompare(b.ccKey))
      setOverlapData({ rows, totalPrograms, programLabels: programs.map(p => `${p.uniName} → ${p.majorLabel}`) })
    } catch (e) {
      setError(`Error: ${e.message}`)
    } finally {
      setLoading(false); setLoadingMsg('')
    }
  }

  function computeAttainability() {
    if (!overlapData || completedCourses.size === 0) return []
    const programMap = {}
    for (const label of overlapData.programLabels) {
      programMap[label] = { label, total: 0, completed: 0 }
    }
    for (const row of overlapData.rows) {
      const isDone = completedCourses.has(row.ccKey)
      for (const pe of row.programEntries) {
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

  // Shorten program label for column headers
  function shortLabel(label) {
    // "UC Berkeley → Computer Science, B.A." -> "Berkeley CS"
    const parts = label.split(' → ')
    const uni = parts[0]?.replace('UC ', '').replace('CSU ', '').replace(' State', '').replace(' University', '')
    const major = parts[1]?.split(',')[0]?.split(' ').slice(0, 2).join(' ')
    return `${uni}\n${major || ''}`
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
                setPrograms([]); setSelUniId(''); setMajors([])
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
              <div className="section-label" style={{ marginBottom: 10 }}>Step 3 — Find my courses</div>
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
            <button className="btn-secondary" onClick={() => { setOverlapData(null); setExpandedRow(null) }}>← Edit</button>
          </div>

          <div className="key-note" style={{ marginBottom: 16 }}>
            ☑️ Check off courses you've already completed to track your progress. Click any row for details.
          </div>

          {/* Grid table */}
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 32, padding: '8px 6px', borderBottom: '2px solid #e0e0e0' }}></th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e0e0e0', fontWeight: 600, color: '#1a1a1a' }}>
                    Course at {ccName}
                  </th>
                  {overlapData.programLabels.map((label, i) => (
                    <th key={i} style={{
                      padding: '8px 10px', borderBottom: '2px solid #e0e0e0',
                      fontWeight: 600, color: '#555', fontSize: 11,
                      textAlign: 'center', whiteSpace: 'pre-line', minWidth: 80
                    }}>
                      {shortLabel(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overlapData.rows.map((row, idx) => {
                  const isDone = completedCourses.has(row.ccKey)
                  const isExpanded = expandedRow === row.ccKey
                  const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                  const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
                  const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
                  const hasAlts = row.programEntries.some(pe => pe.options.length > 1)
                  const coverageAll = row.coverage === overlapData.totalPrograms
                  const coverageMost = row.coverage > 1 && !coverageAll

                  return (
                    <>
                      <tr
                        key={row.ccKey}
                        onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)}
                        style={{
                          background: isDone ? '#fafafa' : idx % 2 === 0 ? '#fff' : '#fafafa',
                          cursor: 'pointer',
                          opacity: isDone ? 0.5 : 1,
                          transition: 'background 0.15s',
                          borderBottom: isExpanded ? 'none' : '1px solid #f0f0f0',
                        }}
                      >
                        <td style={{ padding: '10px 6px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={() => toggleCourse(row.ccKey)}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1a1a1a' }}
                          />
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div>
                              <div style={{
                                fontWeight: 600, fontSize: 13,
                                textDecoration: isDone ? 'line-through' : 'none',
                                color: isDone ? '#aaa' : '#1a1a1a'
                              }}>
                                {label}
                                {coverageAll && <span style={{ marginLeft: 6, fontSize: 10, background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL</span>}
                                {coverageMost && <span style={{ marginLeft: 6, fontSize: 10, background: '#fff8e1', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                              </div>
                              {subtitle && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                {subtitle}{units ? ` · ${units} units` : ''}{hasAlts ? ' · has alternatives' : ''}
                              </div>}
                            </div>
                          </div>
                        </td>
                        {overlapData.programLabels.map((label, pi) => {
                          const entry = row.programEntries.find(pe => pe.program === label)
                          return (
                            <td key={pi} style={{ padding: '10px', textAlign: 'center', borderLeft: '1px solid #f0f0f0' }}>
                              {entry ? (
                                <span style={{ fontSize: 16 }}>✅</span>
                              ) : (
                                <span style={{ fontSize: 14, color: '#ddd' }}>—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${row.ccKey}-detail`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td></td>
                          <td colSpan={overlapData.programLabels.length + 1} style={{ padding: '0 12px 16px' }}>
                            <div style={{ background: '#f9f9f7', borderRadius: 8, padding: 14, marginTop: 4 }}>
                              {row.programEntries.map((pe, i) => (
                                <div key={i} style={{
                                  marginBottom: i < row.programEntries.length - 1 ? 14 : 0,
                                  paddingBottom: i < row.programEntries.length - 1 ? 14 : 0,
                                  borderBottom: i < row.programEntries.length - 1 ? '1px solid #eee' : 'none'
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
                                      {opt.courses.length > 1 && <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Take all together</div>}
                                      {opt.groupNote && <div style={{ fontSize: 11, color: '#f57f17', marginBottom: 4 }}>⚠️ {opt.groupNote}</div>}
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {opt.courses.map((c, k) => (
                                          <div key={k} style={{ background: '#efefed', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.prefix} {c.number}</span>
                                            {c.title && <span style={{ color: '#666', marginLeft: 6 }}>{c.title}</span>}
                                            {c.units && <span style={{ color: '#999', marginLeft: 6 }}>{c.units}u</span>}
                                            {c.note && <div style={{ fontSize: 11, color: '#f57f17', marginTop: 4 }}>⚠️ {c.note}</div>}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {overlapData.rows.length === 0 && (
            <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
          )}

          {/* Progress summary */}
          {completedCourses.size > 0 && (() => {
            const summary = computeAttainability()
            if (summary.length === 0) return null
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
                          {isTop && summary.length > 1 && '⭐ '}{s.label}
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
          })()}
        </>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { KNOWN_UNIVERSITIES, KNOWN_CCS } from './App'

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
      const receiving = art.course || art.receivingCourse
      if (!receiving) continue
      const sendingArt = art.sendingArticulation
      if (!sendingArt || sendingArt.noArticulationReason) continue
      const options = parseSendingOptions(sendingArt.items || [])
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
    if (programs.find(p => p.uniId === selUniId && p.majorKey === selMajor.key)) return
    setPrograms(prev => [...prev, { uniId: selUniId, uniName: selUniName, majorLabel: selMajor.label, majorKey: selMajor.key }])
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

  function renderReqCard(entry) {
    const key = entry.ccKey
    const isOpen = openBlocks[key]
    const hasAlts = entry.programEntries.some(pe => pe.options.length > 1)
    const label = entry.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')

    return (
      <div className="result-block" key={key}>
        <div className="result-header" onClick={() => toggleBlock(key)}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {entry.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')}
              {entry.primaryCourses.some(c => c.units)
                ? ` · ${entry.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)} units`
                : ''}
              {hasAlts ? ' · has alternatives' : ''}
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

          {renderSection('🟢', `Required by all ${overlapData.totalPrograms} programs`, 'Highest priority — take these first', overlapData.all, overlapData.totalPrograms)}
          {renderSection('🟡', 'Required by multiple programs', 'High value — maximizes your coverage', overlapData.most, overlapData.totalPrograms)}
          {renderSection('🔵', 'Required by one program only', "Take if you're committed to that specific program", overlapData.single, overlapData.totalPrograms)}

          {overlapData.all.length === 0 && overlapData.most.length === 0 && overlapData.single.length === 0 && (
            <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
          )}
        </>
      )}
    </div>
  )
}

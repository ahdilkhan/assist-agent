import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
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
    const noArticulationResults = []

    for (const item of arts) {
      const art = item.articulation || item
      let receivingCourses = []
      if (art.course) receivingCourses.push(art.course)
      if (art.receivingCourse) receivingCourses.push(art.receivingCourse)
      if (art.courses && Array.isArray(art.courses)) receivingCourses.push(...art.courses)
      if (art.series?.courses && Array.isArray(art.series.courses)) receivingCourses.push(...art.series.courses)
      if (receivingCourses.length === 0) continue

      const primary = receivingCourses[0]
      const allCourseLabels = receivingCourses.map(rc =>
        `${(rc.prefix || '').trim()} ${(rc.courseNumber || rc.number || '').trim()}`
      )

      const sendingArt = art.sendingArticulation

      // No articulation — track separately so we can show ⚠️ section
      if (!sendingArt || sendingArt.noArticulationReason) {
        noArticulationResults.push({
          program: programLabel,
          uniRequirement: {
            prefix: (primary.prefix || '').trim(),
            number: (primary.courseNumber || primary.number || '').trim(),
            title: primary.courseTitle || primary.title || '',
            units: primary.maxUnits || primary.minUnits || null,
            allCourseLabels,
          },
          noArticulation: true,
          reason: sendingArt?.noArticulationReason || null,
        })
        continue
      }

      const options = parseSendingOptions(sendingArt.items || [])
      if (options.length === 0) continue

      results.push({
        program: programLabel,
        uniRequirement: {
          prefix: (primary.prefix || '').trim(),
          number: (primary.courseNumber || primary.number || '').trim(),
          title: primary.courseTitle || primary.title || '',
          units: primary.maxUnits || primary.minUnits || null,
          allCourseLabels, // e.g. ['CHEM 8A', 'CHEM 8LA']
        },
        options,
      })
    }
    return { articulated: results, noArticulation: noArticulationResults }
  } catch { return { articulated: [], noArticulation: [] } }
}

// Generate a stable save key from program keys
function getPlanSaveKey(programs) {
  return 'tab2_progress_' + programs.map(p => p.majorKey).sort().join('|')
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
  const [isWide, setIsWide] = useState(window.innerWidth > 768)
  const saveTimeoutRef = useRef(null)

  // Track window width for responsive layout
  useEffect(() => {
    const handler = () => setIsWide(window.innerWidth > 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
  supabase.auth.getUser().then(async ({ data: { user } }) => {
    if (!user) return
    const { data } = await supabase.from('tab2_plan').select('*').eq('user_id', user.id).maybeSingle()
    if (!data) return
    setCcId(data.cc_id || '')
    setCcName(data.cc_name || '')
    setPrograms(data.programs || [])
  })
}, [])

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

  // Load saved progress when overlapData is set
  useEffect(() => {
    if (!overlapData || programs.length === 0) return
    const key = getPlanSaveKey(programs)
    supabase.from('tab2_progress').select('completed_courses').eq('plan_key', key).maybeSingle()
  .then(({ data }) => {
    if (data?.completed_courses) {
      setCompletedCourses(new Set(data.completed_courses))
    }
  })
  }, [overlapData])

  // Save progress to Supabase (debounced)
  async function saveProgress(newCompleted, progs) {
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
  saveTimeoutRef.current = setTimeout(async () => {
    const key = getPlanSaveKey(progs)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('tab2_progress').upsert({
      plan_key: key,
      user_id: user.id,
      completed_courses: [...newCompleted],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_key,user_id' })
    console.log('saveProgress result:', error ? 'ERROR: ' + error.message : 'saved ok', [...newCompleted])
  }, 1000)
}

async function savePlan(newCcId, newCcName, newPrograms) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('tab2_plan').upsert({
    user_id: user.id,
    cc_id: newCcId,
    cc_name: newCcName,
    programs: newPrograms,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

  function addProgram() {
  if (!selUniId || !selMajor) return
  if (programs.find(p => p.uniId === selUniId && p.majorKey === selMajor.key)) return
  const newPrograms = [...programs, { uniId: selUniId, uniName: selUniName, majorLabel: selMajor.label, majorKey: selMajor.key }]
  setPrograms(newPrograms)
  savePlan(ccId, ccName, newPrograms)
  setSelMajor(null)
}

  function removeProgram(i) {
  const newPrograms = programs.filter((_, j) => j !== i)
  setPrograms(newPrograms)
  savePlan(ccId, ccName, newPrograms)
}

  function toggleCourse(ccKey) {
    setCompletedCourses(prev => {
      const next = new Set(prev)
      next.has(ccKey) ? next.delete(ccKey) : next.add(ccKey)
      saveProgress(next, programs)
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
        const parsed = parseAllForProgram(agreement, `${prog.uniName} → ${prog.majorLabel}`)
        return { prog, arts: parsed.articulated, noArts: parsed.noArticulation }
      }))

      const totalPrograms = programs.length
      const reqMap = {}
      const noArtMap = {} // key: "uniName|prefix|number"

      for (const { prog, arts, noArts } of programArts) {
        // Articulated courses
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
              options: art.options,
            })
          }
        }

        // No articulation courses
        for (const na of noArts) {
          const naKey = `${prog.uniName}|${na.uniRequirement.prefix}|${na.uniRequirement.number}`
          if (!noArtMap[naKey]) {
            noArtMap[naKey] = {
              program: `${prog.uniName} → ${prog.majorLabel}`,
              uniReq: na.uniRequirement,
              reason: na.reason,
            }
          }
        }
      }

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        return { ...entry, coverage }
      })
      rows.sort((a, b) => b.coverage - a.coverage || a.ccKey.localeCompare(b.ccKey))

      setOverlapData({
        rows,
        totalPrograms,
        programLabels: programs.map(p => `${p.uniName} → ${p.majorLabel}`),
        noArticulation: Object.values(noArtMap),
      })
    } catch (e) {
      setError(`Error: ${e.message}`)
    } finally {
      setLoading(false); setLoadingMsg('')
    }
  }

  function computeAttainability() {
    if (!overlapData) return []
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

  function shortLabel(label) {
    const parts = label.split(' → ')
    const uni = parts[0]?.replace('UC ', '').replace('CSU ', '').replace(' State', '').replace(' University', '')
    const major = parts[1]?.split(',')[0]?.split(' ').slice(0, 2).join(' ')
    return `${uni}\n${major || ''}`
  }

  const summary = computeAttainability()

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
  const newCcId = e.target.value
  const newCcName = e.target.selectedOptions[0]?.text || ''
  setCcId(newCcId)
  setCcName(newCcName)
  setPrograms([])
  setSelUniId('')
  setMajors([])
  savePlan(newCcId, newCcName, [])
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
                  <label>Major / Department</label>
                  {majorsLoading
                    ? <div className="status" style={{ padding: '9px 0' }}><div className="spinner" />Loading...</div>
                    : <select value={selMajor?.key || ''} onChange={e => setSelMajor(majors.find(m => m.key === e.target.value) || null)}
                        disabled={!selUniId || majors.length === 0}>
                        <option value="">{!selUniId ? 'Select university first' : majors.length === 0 ? 'No agreement found' : 'Select major or department...'}</option>
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

          {/* Legend */}
          <div style={{
            display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12,
            fontSize: 12, color: '#666', alignItems: 'center',
            background: '#f9f9f7', borderRadius: 8, padding: '8px 12px',
          }}>
            <span style={{ fontWeight: 600, color: '#1a1a1a' }}>Key:</span>
            <span><span style={{ color: '#6C5CE7', fontWeight: 700, fontSize: 14 }}>●</span> Required by this program</span>
            <span><span style={{ color: '#ddd', fontSize: 14 }}>●</span> Not required</span>
            <span>☑ = you've completed it</span>
          </div>

          {/* Side-by-side layout on desktop */}
          <div style={{
            display: isWide ? 'grid' : 'block',
            gridTemplateColumns: isWide ? '1fr 400px' : undefined,
            gap: isWide ? 20 : 0,
            alignItems: 'start',
          }}>

            {/* LEFT: Grid table */}
            <div>
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
                              <div>
                                <div style={{
                                  fontWeight: 600, fontSize: 13,
                                  textDecoration: isDone ? 'line-through' : 'none',
                                  color: isDone ? '#aaa' : '#1a1a1a'
                                }}>
                                  {label}
                                  {coverageAll && <span style={{ marginLeft: 6, fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                                  {coverageMost && <span style={{ marginLeft: 6, fontSize: 10, background: '#fff8e1', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                                </div>
                                {subtitle && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                  {subtitle}{units ? ` · ${units} units` : ''}{hasAlts ? ' · has alternatives' : ''}
                                </div>}
                              </div>
                            </td>
                            {overlapData.programLabels.map((progLabel, pi) => {
                              const entry = row.programEntries.find(pe => pe.program === progLabel)
                              return (
                                <td key={pi} style={{ padding: '10px', textAlign: 'center', borderLeft: '1px solid #f0f0f0' }}>
                                  {entry
                                    ? <span style={{ color: '#6C5CE7', fontSize: 18, lineHeight: 1 }}>●</span>
                                    : <span style={{ color: '#e0e0e0', fontSize: 18, lineHeight: 1 }}>●</span>
                                  }
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
                                      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                                        Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>
                                          {pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}
                                        </span>
                                        {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                                      </div>
                                      {/* Also satisfies */}
                                      {pe.uniReq.allCourseLabels?.length > 1 && (
                                        <div style={{ fontSize: 12, color: '#6C5CE7', marginBottom: 8 }}>
                                          ✅ Also satisfies: {pe.uniReq.allCourseLabels.slice(1).join(', ')}
                                        </div>
                                      )}
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

              {/* No articulation section */}
              {overlapData.noArticulation?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#f57f17', marginBottom: 10 }}>
                    ⚠️ Requirements with no CC equivalent at {ccName}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                    These university requirements don't have an articulated equivalent at {ccName}. You may need to take them at the university or find another CC with an agreement.
                  </div>
                  {overlapData.noArticulation.map((na, i) => (
                    <div key={i} style={{
                      background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8,
                      padding: '10px 14px', marginBottom: 8,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {na.uniReq.prefix} {na.uniReq.number} — {na.uniReq.title}
                          {na.uniReq.units ? <span style={{ fontWeight: 400, color: '#888', fontSize: 12, marginLeft: 6 }}>{na.uniReq.units} units</span> : ''}
                        </div>
                        {na.uniReq.allCourseLabels?.length > 1 && (
                          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                            Part of: {na.uniReq.allCourseLabels.join(' + ')}
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{na.program}</div>
                        {na.reason && <div style={{ fontSize: 12, color: '#f57f17', marginTop: 4 }}>{na.reason}</div>}
                      </div>
                      <span style={{ fontSize: 11, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>No equivalent</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT: Progress summary (sticky on desktop) */}
            <div style={{ position: isWide ? 'sticky' : 'static', top: 20 }}>
              <div className="card" style={{ background: '#f9f9f7', border: '1px solid #e8e8e4' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>📈 Progress</div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                  Saved automatically · check off completed courses
                </div>
                {summary.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#aaa' }}>Check off courses to track progress</div>
                ) : (
                  summary.map((s, i) => {
                    const pct = s.total === 0 ? 0 : Math.round((s.completed / s.total) * 100)
                    const isTop = i === 0 && summary.length > 1
                    return (
                      <div key={i} style={{ marginBottom: i < summary.length - 1 ? 16 : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: isTop ? 600 : 400, color: isTop ? '#1a1a1a' : '#555', flex: 1, marginRight: 8 }}>
                            {isTop && summary.length > 1 && completedCourses.size > 0 && <span style={{ color: '#6C5CE7' }}>★ </span>}{s.label}
                          </div>
                          <div style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{s.completed} / {s.total}</div>
                        </div>
                        <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                          <div style={{
                            background: pct === 100 ? '#4caf50' : '#6C5CE7',
                            height: '100%', width: `${pct}%`,
                            borderRadius: 4, transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  )
}

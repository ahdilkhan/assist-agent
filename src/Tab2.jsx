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

function buildCellMap(templateAssets) {
  const cellMap = new Map()
  let assets
  try {
    assets = typeof templateAssets === 'string' ? JSON.parse(templateAssets) : templateAssets || []
  } catch { return cellMap }

  const reqTitles = assets
    .filter(a => a.type === 'RequirementTitle')
    .sort((a, b) => a.position - b.position)

  const reqGroups = assets.filter(a => a.type === 'RequirementGroup')

  for (const group of reqGroups) {
    const groupTitle = reqTitles
      .filter(t => t.position < group.position)
      .sort((a, b) => b.position - a.position)[0]?.content || 'MAJOR REQUIREMENTS'

    const sections = group.sections || []
    const sectionHeader = sections.find(s => s.type === 'SectionHeader')
    const sectionLabel = sectionHeader?.content || ''
    const dataSections = sections.filter(s => s.type === 'Section')

    for (const section of dataSections) {
      const nFollowing = section.advisements?.find(a => a.type === 'NFollowing')
      const nRequired = nFollowing ? nFollowing.amount : null
      const sectionGroupId = `${group.groupId}_${section.position}`

      for (const row of section.rows || []) {
        for (const cell of row.cells || []) {
          if (cell.id) {
            cellMap.set(cell.id, {
              sectionLabel,
              groupTitle,
              nRequired,
              groupId: sectionGroupId,
              sectionPosition: section.position,
              groupPosition: group.position,
            })
          }
        }
      }
    }
  }
  return cellMap
}

function parseAllForProgram(agreement, programLabel) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []

    const cellMap = buildCellMap(agreement.templateAssets)
    const results = []
    const noArticulationResults = []

    for (const item of arts) {
      const art = item.articulation || item
      const templateCellId = item.templateCellId

      const cellContext = cellMap.get(templateCellId) || {
        sectionLabel: '',
        groupTitle: 'MAJOR REQUIREMENTS',
        nRequired: null,
        groupId: templateCellId || Math.random().toString(),
        sectionPosition: 0,
        groupPosition: 0,
      }

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
          ...cellContext,
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
          allCourseLabels,
        },
        options,
        ...cellContext,
      })
    }

    return { articulated: results, noArticulation: noArticulationResults }
  } catch (e) {
    console.warn('parseAllForProgram error:', e)
    return { articulated: [], noArticulation: [] }
  }
}

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
  const [includeRecommended, setIncludeRecommended] = useState(false)
  const [isWide, setIsWide] = useState(window.innerWidth > 768)
  const [showBanner, setShowBanner] = useState(() => localStorage.getItem('tab2_banner_dismissed') !== '1')
  const saveTimeoutRef = useRef(null)

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

  useEffect(() => {
    if (!overlapData || programs.length === 0) return
    const key = getPlanSaveKey(programs)
    supabase.from('tab2_progress').select('completed_courses').eq('plan_key', key).maybeSingle()
      .then(({ data }) => {
        if (data?.completed_courses) setCompletedCourses(new Set(data.completed_courses))
      })
  }, [overlapData])

  async function saveProgress(newCompleted, progs) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      const key = getPlanSaveKey(progs)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('tab2_progress').upsert({
        plan_key: key,
        user_id: user.id,
        completed_courses: [...newCompleted],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plan_key,user_id' })
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
      const noArtMap = {}

      for (const { prog, arts, noArts } of programArts) {
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
              groupTitle: art.groupTitle,
              sectionLabel: art.sectionLabel,
              nRequired: art.nRequired,
              groupId: art.groupId,
            })
          }
        }

        for (const na of noArts) {
          const naKey = `${prog.uniName}|${na.uniRequirement.prefix}|${na.uniRequirement.number}`
          if (!noArtMap[naKey]) {
            noArtMap[naKey] = {
              program: `${prog.uniName} → ${prog.majorLabel}`,
              uniReq: na.uniRequirement,
              reason: na.reason,
              groupTitle: na.groupTitle,
              sectionLabel: na.sectionLabel,
            }
          }
        }
      }

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        const pe0 = entry.programEntries[0]
        return {
          ...entry,
          coverage,
          _groupPosition: pe0?.groupPosition ?? 999,
          _sectionPosition: pe0?.sectionPosition ?? 999,
        }
      })
      rows.sort((a, b) => {
        if (a._groupPosition !== b._groupPosition) return a._groupPosition - b._groupPosition
        if (a._sectionPosition !== b._sectionPosition) return a._sectionPosition - b._sectionPosition
        return b.coverage - a.coverage || a.ccKey.localeCompare(b.ccKey)
      })

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

  function isRecommendedSection(groupTitle) {
    if (!groupTitle) return false
    const lower = groupTitle.toLowerCase()
    return lower.includes('recommended') || lower.includes('suggested') ||
           lower.includes('advised') || lower.includes('optional') ||
           lower.includes('preparation') || lower.includes('strongly')
  }

  function computeAttainability() {
    if (!overlapData) return []
    const programMap = {}
    for (const label of overlapData.programLabels) {
      programMap[label] = { label, total: 0, completed: 0 }
    }

    const programGroupMap = {}

    for (const row of overlapData.rows) {
      const isDone = completedCourses.has(row.ccKey)
      for (const pe of row.programEntries) {
        if (!programMap[pe.program]) continue
        if (!includeRecommended && isRecommendedSection(pe.groupTitle)) continue
        const pgKey = `${pe.program}|${pe.groupId}`
        if (!programGroupMap[pgKey]) {
          programGroupMap[pgKey] = { program: pe.program, nRequired: pe.nRequired, totalCourses: 0, completedCourses: 0 }
        }
        programGroupMap[pgKey].totalCourses += 1
        if (isDone) programGroupMap[pgKey].completedCourses += 1
      }
    }

    for (const pg of Object.values(programGroupMap)) {
      if (!programMap[pg.program]) continue
      if (pg.nRequired !== null) {
        programMap[pg.program].total += 1
        if (pg.completedCourses >= pg.nRequired) programMap[pg.program].completed += 1
      } else {
        programMap[pg.program].total += pg.totalCourses
        programMap[pg.program].completed += pg.completedCourses
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

          {showBanner && (
            <div style={{
              background: '#f0edff',
              border: '1px solid #d4ccff',
              borderRadius: 10,
              padding: '14px 16px',
              marginBottom: 20,
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
            }}>
              <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>👋</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a', marginBottom: 6 }}>
                  How to read your course plan
                </div>
                <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div><span style={{ color: '#6C5CE7', fontWeight: 700 }}>●</span> purple dot = this course counts toward that program's requirements</div>
                  <div><span style={{ color: '#d4d4d4', fontWeight: 700 }}>●</span> grey dot = not required for that program</div>
                  <div>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#ffe082', verticalAlign: 'middle', marginRight: 4 }} />
                    amber cards = you only need to pick <strong>one</strong> course from the group, not all of them
                  </div>
                  <div>☑ check off a course once you've taken it — your progress saves automatically</div>
                  <div style={{ color: '#888' }}>Tap any course row to see exactly which university requirement it satisfies.</div>
                </div>
              </div>
              <button
                onClick={() => { setShowBanner(false); localStorage.setItem('tab2_banner_dismissed', '1') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}

          <div style={{
            display: isWide ? 'grid' : 'block',
            gridTemplateColumns: isWide ? '1fr 300px' : undefined,
            gap: isWide ? 24 : 0,
            alignItems: 'start',
          }}>

            {/* LEFT: grouped course list */}
            <div>
              {(() => {
                // Pre-group rows by groupId to render pick-N groups as single visual units
                const groups = []
                const groupIdToGroup = {}

                for (const row of overlapData.rows) {
                  const pe0 = row.programEntries[0]
                  const groupId = pe0?.groupId ?? `singleton_${row.ccKey}`
                  const nRequired = pe0?.nRequired ?? null

                  if (!groupIdToGroup[groupId]) {
                    const g = {
                      groupId,
                      groupTitle: pe0?.groupTitle || 'MAJOR REQUIREMENTS',
                      sectionLabel: pe0?.sectionLabel || '',
                      nRequired,
                      rows: [],
                    }
                    groupIdToGroup[groupId] = g
                    groups.push(g)
                  }
                  groupIdToGroup[groupId].rows.push(row)
                }

                // Sort groups: required sections first, recommended/optional last
                // Within each bucket, preserve original ASSIST order
                const isRecommendedGroup = (g) => isRecommendedSection(g.groupTitle) || isRecommendedSection(g.sectionLabel)
                groups.sort((a, b) => {
                  const aRec = isRecommendedGroup(a) ? 1 : 0
                  const bRec = isRecommendedGroup(b) ? 1 : 0
                  return aRec - bRec
                })

                let lastDisplayLabel = null
                const rendered = []

                for (const group of groups) {
                  const isPickN = group.nRequired !== null
                  const totalAvailableAtCC = group.rows.length
                  // If it's pick-N but only 1 option exists at this CC, treat as effectively required
                  const isEffectivelyRequired = isPickN && totalAvailableAtCC <= 1

                  // Show the most specific label available. If sectionLabel exists use it,
                  // otherwise fall back to groupTitle. Never stack both — they're usually redundant.
                  const displayLabel = group.sectionLabel || group.groupTitle || 'REQUIREMENTS'

                  if (displayLabel !== lastDisplayLabel) {
                    lastDisplayLabel = displayLabel
                    rendered.push(
                      <div key={`sec-${displayLabel}-${group.groupId}`} style={{
                        marginTop: rendered.length === 0 ? 0 : 32,
                        marginBottom: 10,
                        paddingBottom: 8,
                        borderBottom: '2px solid #e8e8e4',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          {displayLabel}
                        </div>
                      </div>
                    )
                  }

                  if (isPickN && !isEffectivelyRequired) {
                    // Render as a grouped card with amber border — whole group = one choice
                    rendered.push(
                      <div key={`group-${group.groupId}`} style={{
                        border: '1.5px solid #ffe082',
                        borderRadius: 10,
                        marginBottom: 12,
                        overflow: 'hidden',
                        background: '#fffdf5',
                      }}>
                        {/* Group header — clearly explains the choice */}
                        <div style={{
                          padding: '9px 14px',
                          borderBottom: '1px solid #ffe082',
                          background: '#fff8e1',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}>
                          <span style={{ fontSize: 14 }}>↓</span>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>
                              Choose any {group.nRequired} of these {totalAvailableAtCC} options
                            </span>
                            <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>
                              — you don't need all of them
                            </span>
                          </div>
                        </div>

                        {group.rows.map((row, rowIdx) => {
                          const isDone = completedCourses.has(row.ccKey)
                          const isExpanded = expandedRow === row.ccKey
                          const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                          const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
                          const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
                          const coverageAll = row.coverage === overlapData.totalPrograms
                          const coverageMost = row.coverage > 1 && !coverageAll

                          return (
                            <div key={row.ccKey} style={{
                              borderTop: rowIdx > 0 ? '1px dashed #f0e6c8' : 'none',
                              background: isDone ? '#f7f4ec' : '#fffdf5',
                              opacity: isDone ? 0.6 : 1,
                            }}>
                              {rowIdx > 0 && (
                                <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#ccc', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>
                              )}
                              <div
                                onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                              >
                                <div onClick={e => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isDone}
                                    onChange={() => toggleCourse(row.ccKey)}
                                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#b45309' }}
                                  />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#aaa' : '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {label}
                                    {coverageAll && <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                                    {coverageMost && <span style={{ fontSize: 10, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                                  </div>
                                  {subtitle && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  {overlapData.programLabels.map((progLabel, pi) => {
                                    const has = row.programEntries.some(pe => pe.program === progLabel)
                                    return (
                                      <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                        {overlapData.programLabels.length > 1 && (
                                          <div style={{ fontSize: 9, color: '#bbb', textAlign: 'center', maxWidth: 48, lineHeight: 1.2 }}>{shortLabel(progLabel).split('\n')[0]}</div>
                                        )}
                                        <span style={{ color: has ? '#6C5CE7' : '#e0e0e0', fontSize: 16, lineHeight: 1 }}>●</span>
                                      </div>
                                    )
                                  })}
                                </div>
                                <div style={{ fontSize: 11, color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</div>
                              </div>

                              {isExpanded && (
                                <div style={{ borderTop: '1px solid #f0e6c8', background: '#faf5e8', padding: '12px 14px 14px 38px' }}>
                                  {row.programEntries.map((pe, i) => (
                                    <div key={i} style={{ marginBottom: i < row.programEntries.length - 1 ? 14 : 0, paddingBottom: i < row.programEntries.length - 1 ? 14 : 0, borderBottom: i < row.programEntries.length - 1 ? '1px solid #eee' : 'none' }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{pe.program}</div>
                                      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                                        Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
                                        {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                                      </div>
                                      {pe.uniReq.allCourseLabels?.length > 1 && (
                                        <div style={{ fontSize: 12, color: '#6C5CE7', marginBottom: 8 }}>✅ Also satisfies: {pe.uniReq.allCourseLabels.slice(1).join(', ')}</div>
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
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  } else {
                    // Normal required rows (or effectively-required pick-N with 1 option)
                    group.rows.forEach((row) => {
                      const isDone = completedCourses.has(row.ccKey)
                      const isExpanded = expandedRow === row.ccKey
                      const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                      const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
                      const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
                      const hasAlts = row.programEntries.some(pe => pe.options.length > 1)
                      const coverageAll = row.coverage === overlapData.totalPrograms
                      const coverageMost = row.coverage > 1 && !coverageAll

                      rendered.push(
                        <div key={row.ccKey} style={{
                          border: '1px solid #efefed',
                          borderRadius: 8,
                          marginBottom: 6,
                          background: isDone ? '#fafafa' : '#fff',
                          opacity: isDone ? 0.55 : 1,
                          overflow: 'hidden',
                        }}>
                          <div
                            onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                          >
                            <div onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={() => toggleCourse(row.ccKey)}
                                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1a1a1a' }}
                              />
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#aaa' : '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                {label}
                                {coverageAll && <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                                {coverageMost && <span style={{ fontSize: 10, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                              </div>
                              {subtitle && (
                                <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
                                  {subtitle}{units ? ` · ${units} units` : ''}{hasAlts ? ' · has alternatives' : ''}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              {overlapData.programLabels.map((progLabel, pi) => {
                                const has = row.programEntries.some(pe => pe.program === progLabel)
                                return (
                                  <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    {overlapData.programLabels.length > 1 && (
                                      <div style={{ fontSize: 9, color: '#bbb', textAlign: 'center', maxWidth: 48, lineHeight: 1.2 }}>{shortLabel(progLabel).split('\n')[0]}</div>
                                    )}
                                    <span style={{ color: has ? '#6C5CE7' : '#e0e0e0', fontSize: 16, lineHeight: 1 }}>●</span>
                                  </div>
                                )
                              })}
                            </div>

                            <div style={{ fontSize: 11, color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</div>
                          </div>

                          {isExpanded && (
                            <div style={{ borderTop: '1px solid #f0f0f0', background: '#fafafa', padding: '12px 14px 14px 38px' }}>
                              {isEffectivelyRequired && (
                                <div style={{ fontSize: 12, color: '#888', background: '#f0f0f0', borderRadius: 6, padding: '7px 10px', marginBottom: 12 }}>
                                  ℹ️ The university offers multiple ways to satisfy this requirement, but this is the only one with an equivalent course at {ccName}.
                                </div>
                              )}
                              {row.programEntries.map((pe, i) => (
                                <div key={i} style={{ marginBottom: i < row.programEntries.length - 1 ? 14 : 0, paddingBottom: i < row.programEntries.length - 1 ? 14 : 0, borderBottom: i < row.programEntries.length - 1 ? '1px solid #eee' : 'none' }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{pe.program}</div>
                                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                                    Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
                                    {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                                  </div>
                                  {pe.uniReq.allCourseLabels?.length > 1 && (
                                    <div style={{ fontSize: 12, color: '#6C5CE7', marginBottom: 8 }}>✅ Also satisfies: {pe.uniReq.allCourseLabels.slice(1).join(', ')}</div>
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
                          )}
                        </div>
                      )
                    })
                  }
                }

                return rendered
              })()}

              {overlapData.rows.length === 0 && (
                <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
              )}

              {/* No articulation section */}
              {overlapData.noArticulation?.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
                    letterSpacing: '0.1em', paddingBottom: 8, borderBottom: '2px solid #e8e8e4', marginBottom: 12
                  }}>
                    No equivalent at {ccName}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
                    These are required by the university but have no articulated course at {ccName}. You may need to take them after transferring or at another CC.
                  </div>
                  {overlapData.noArticulation.map((na, i) => (
                    <div key={i} style={{
                      background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8,
                      padding: '10px 14px', marginBottom: 8,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', marginBottom: 4 }}>
                          {na.groupTitle}{na.sectionLabel ? ` · ${na.sectionLabel}` : ''}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {na.uniReq.prefix} {na.uniReq.number} — {na.uniReq.title}
                          {na.uniReq.units ? <span style={{ fontWeight: 400, color: '#888', fontSize: 12, marginLeft: 6 }}>{na.uniReq.units} units</span> : ''}
                        </div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{na.program}</div>
                        {na.reason && <div style={{ fontSize: 12, color: '#f57f17', marginTop: 4 }}>{na.reason}</div>}
                      </div>
                      <span style={{ fontSize: 11, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>No equivalent</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT: Progress + legend */}
            <div style={{ position: isWide ? 'sticky' : 'static', top: 20 }}>
              <div className="card" style={{ background: '#f9f9f7', border: '1px solid #e8e8e4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>📊 Progress</div>
                  <button
                    onClick={() => setIncludeRecommended(r => !r)}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 20, cursor: 'pointer', border: '1px solid',
                      borderColor: includeRecommended ? '#6C5CE7' : '#ccc',
                      background: includeRecommended ? '#ede9ff' : '#f5f5f5',
                      color: includeRecommended ? '#6C5CE7' : '#888',
                      fontWeight: 500, transition: 'all 0.15s',
                    }}
                  >
                    {includeRecommended ? '✓ ' : ''}+ recommended
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 14 }}>
                  {includeRecommended ? 'Including recommended courses' : 'Required courses only'} · check off to track
                </div>

                {/* Legend — moved here so it's always visible */}
                <div style={{ borderTop: '1px solid #e8e8e4', paddingTop: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 8 }}>How to read this</div>
                  <div style={{ fontSize: 11, color: '#777', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#6C5CE7', fontSize: 14 }}>●</span>
                      <span>Required by that program</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#e0e0e0', fontSize: 14 }}>●</span>
                      <span>Not required</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 4 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: '#ffe082', flexShrink: 0, marginTop: 1 }} />
                      <span>Yellow groups = choose any 1 (not all required)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>☑</span>
                      <span>Check off completed courses</span>
                    </div>
                  </div>
                </div>

                {summary.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#aaa' }}>Check off courses to see your progress</div>
                ) : (
                  summary.map((s, i) => {
                    const pct = s.total === 0 ? 0 : Math.round((s.completed / s.total) * 100)
                    const isTop = i === 0 && summary.length > 1
                    return (
                      <div key={i} style={{ marginBottom: i < summary.length - 1 ? 16 : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: isTop ? 600 : 400, color: isTop ? '#1a1a1a' : '#555', flex: 1, marginRight: 8 }}>
                            {isTop && summary.length > 1 && <span style={{ color: '#6C5CE7' }}>⭐ </span>}{s.label}
                          </div>
                          <div style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{s.completed}/{s.total} · {pct}%</div>
                        </div>
                        <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                          <div style={{
                            background: pct === 100 ? '#4caf50' : '#6C5CE7',
                            height: '100%', width: `${pct}%`,
                            borderRadius: 4, transition: 'width 0.3s ease'
                          }} />
                        </div>
                        {isTop && summary.length > 1 && (
                          <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>Most attainable so far</div>
                        )}
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

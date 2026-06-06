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
  // groupFallbackMap: keyed by raw ASSIST group.groupId → context of its first section
  // Used when a templateCellId isn't in cellMap but we can infer the group from the item itself
  const groupFallbackMap = new Map()
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
      const ctx = { sectionLabel, groupTitle, nRequired, groupId: sectionGroupId, sectionPosition: section.position, groupPosition: group.position }

      // Store fallback by raw group.groupId so sibling items can find each other
      // even when their templateCellId isn't a direct cell.id match
      if (!groupFallbackMap.has(String(group.groupId))) {
        groupFallbackMap.set(String(group.groupId), ctx)
      }

      for (const row of section.rows || []) {
        for (const cell of row.cells || []) {
          if (cell.id) {
            cellMap.set(cell.id, ctx)
            // Also index by string version in case of type mismatch
            cellMap.set(String(cell.id), ctx)
          }
        }
      }
    }
  }
  // Attach fallback map so parseAllForProgram can use it
  cellMap._groupFallback = groupFallbackMap
  return cellMap
}

function parseAllForProgram(agreement, programLabel) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []

    const cellMap = buildCellMap(agreement.templateAssets)
    const results = []
    const noArticulationResults = []

    // Group items by their ASSIST groupId so we can detect when a pick-N group
    // has some articulated and some unarticulated members.
    const groupRegistry = {}

    for (const item of arts) {
      const art = item.articulation || item
      const templateCellId = item.templateCellId
      // Try direct cell ID lookup first, then try the raw group fallback,
      // then use templateCellId as last resort (keeps the item isolated but safe)
      const rawGroupId = item.requirementGroupId ?? item.requirementGroup?.id ?? item.groupId
      const cellContext = cellMap.get(templateCellId)
        || cellMap.get(String(templateCellId))
        || (rawGroupId != null ? cellMap._groupFallback?.get(String(rawGroupId)) : null)
        || {
          sectionLabel: '',
          groupTitle: 'MAJOR REQUIREMENTS',
          nRequired: null,
          groupId: templateCellId || Math.random().toString(),
          sectionPosition: 0,
          groupPosition: 0,
        }
      const gid = cellContext.groupId
      if (!groupRegistry[gid]) {
        groupRegistry[gid] = { nRequired: cellContext.nRequired, articulated: [], unarticulated: [] }
      }

      let receivingCourses = []
      if (art.course) receivingCourses.push(art.course)
      if (art.receivingCourse) receivingCourses.push(art.receivingCourse)
      if (art.courses && Array.isArray(art.courses)) receivingCourses.push(...art.courses)
      if (art.series?.courses && Array.isArray(art.series.courses)) receivingCourses.push(...art.series.courses)
      if (receivingCourses.length === 0) continue

      const primary = receivingCourses[0]
      const sendingArt = art.sendingArticulation
      const hasArt = sendingArt && !sendingArt.noArticulationReason
      const entry = { art, cellContext, receivingCourses, primary, sendingArt }
      if (hasArt) groupRegistry[gid].articulated.push(entry)
      else groupRegistry[gid].unarticulated.push(entry)
    }

    // Emit results from each group
    for (const gid of Object.keys(groupRegistry)) {
      const grp = groupRegistry[gid]
      const isPickN = grp.nRequired !== null
      const hasArticulatedSibling = grp.articulated.length > 0

      for (const { art, cellContext, receivingCourses, primary } of grp.articulated) {
        const allCourseLabels = receivingCourses.map(rc =>
          `${(rc.prefix || '').trim()} ${(rc.courseNumber || rc.number || '').trim()}`
        )
        const options = parseSendingOptions(art.sendingArticulation.items || [])
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

      // Emit unarticulated entries — always surface them, but flag pick-group ones
      for (const { cellContext, receivingCourses, primary, sendingArt } of grp.unarticulated) {
        const allCourseLabels = receivingCourses.map(rc =>
          `${(rc.prefix || '').trim()} ${(rc.courseNumber || rc.number || '').trim()}`
        )
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
          partOfPickGroup: isPickN,
          coveredByAnotherOption: isPickN && hasArticulatedSibling,
          ...cellContext,
        })
      }
    }

    // ASSIST sometimes omits cells entirely from the articulations array (no entry at all,
    // not even a noArticulationReason). This happens for ECON C3 style cases.
    // Fix: scan templateAssets for any cell IDs in pick-N groups that were never seen,
    // and emit them as noArticulation so they surface in the UI.
    const seenCellIds = new Set(arts.map(item => item.templateCellId))
    const assets = typeof agreement.templateAssets === 'string'
      ? JSON.parse(agreement.templateAssets) : agreement.templateAssets || []
    for (const group of assets.filter(a => a.type === 'RequirementGroup')) {
      const groupTitle = (() => {
        const reqTitles = assets.filter(a => a.type === 'RequirementTitle').sort((a,b) => a.position - b.position)
        return reqTitles.filter(t => t.position < group.position).sort((a,b) => b.position - a.position)[0]?.content || 'MAJOR REQUIREMENTS'
      })()
      const sections = group.sections || []
      const sectionHeader = sections.find(s => s.type === 'SectionHeader')
      const sectionLabel = sectionHeader?.content || ''
      for (const section of sections.filter(s => s.type === 'Section')) {
        const nFollowing = section.advisements?.find(a => a.type === 'NFollowing')
        const nRequired = nFollowing ? nFollowing.amount : null
        const sectionGroupId = `${group.groupId}_${section.position}`
        for (const row of section.rows || []) {
          for (const cell of row.cells || []) {
            if (!cell.id || seenCellIds.has(cell.id)) continue
            // This cell was never in articulations at all — emit as noArticulation
            const course = cell.course || {}
            const isPickN = nRequired !== null
            // Check if any sibling in this group was articulated
            const siblingArticulated = groupRegistry[sectionGroupId]?.articulated?.length > 0
            noArticulationResults.push({
              program: programLabel,
              uniRequirement: {
                prefix: (course.prefix || '').trim(),
                number: (course.courseNumber || course.number || '').trim(),
                title: course.courseTitle || course.title || '',
                units: course.maxUnits || course.minUnits || null,
                allCourseLabels: [`${(course.prefix||'').trim()} ${(course.courseNumber||course.number||'').trim()}`],
              },
              noArticulation: true,
              reason: null,
              partOfPickGroup: isPickN,
              coveredByAnotherOption: isPickN && siblingArticulated,
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
              groupId: na.groupId,
              nRequired: na.nRequired ?? null,
              partOfPickGroup: na.partOfPickGroup || false,
              coveredByAnotherOption: na.coveredByAnotherOption || false,
            }
          }
        }
      }

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        // Use the strictest entry for section placement: if any program requires this course,
        // file it under that required section rather than a recommended one.
        const requiredEntry = entry.programEntries.find(
          pe => !isRecommendedSection(pe.groupTitle) && !isRecommendedSection(pe.sectionLabel)
        )
        const canonicalEntry = requiredEntry || entry.programEntries[0]
        return {
          ...entry,
          coverage,
          groupTitle: canonicalEntry?.groupTitle,
          sectionLabel: canonicalEntry?.sectionLabel,
          groupId: canonicalEntry?.groupId,
          nRequired: canonicalEntry?.nRequired ?? null,
          _groupPosition: canonicalEntry?.groupPosition ?? 999,
          _sectionPosition: canonicalEntry?.sectionPosition ?? 999,
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
        if (!includeRecommended && (isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel))) continue
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
              background: '#f0edff', border: '1px solid #d4ccff', borderRadius: 10,
              padding: '12px 14px', marginBottom: 20,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1, fontSize: 12, color: '#444' }}>
                <strong style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#1a1a1a' }}>How to read this</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><span style={{ color: '#6C5CE7', fontWeight: 700 }}>●</span> purple = that program requires this course &nbsp;·&nbsp; <span style={{ color: '#ccc', fontWeight: 700 }}>●</span> grey = not required</div>
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffe082', verticalAlign: 'middle', marginRight: 4 }}/>yellow-bordered card = choose <em>any one</em> from the group — you don't need all of them</div>
                  <div>▼ tap any row to see which university requirement it satisfies and additional info</div>
                  <div>☑ check it off once you've taken it — progress saves automatically</div>
                  <div>📊 the progress bar tracks required courses only by default — click "+ Add recommended" to include recommended courses in your progress too</div>
                </div>
              </div>
              <button
                onClick={() => { setShowBanner(false); localStorage.setItem('tab2_banner_dismissed', '1') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0, marginTop: 2 }}
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
                  // Use row-level context (already resolved to strictest entry in generateOverlap)
                  const groupId = row.groupId ?? `singleton_${row.ccKey}`
                  const nRequired = row.nRequired ?? null

                  if (!groupIdToGroup[groupId]) {
                    const g = {
                      groupId,
                      groupTitle: row.groupTitle || 'MAJOR REQUIREMENTS',
                      sectionLabel: row.sectionLabel || '',
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
                // "Required" sections first, then named dept sections, then recommended last
                // Within each tier, preserve original ASSIST groupPosition order
                const sectionTier = (g) => {
                  if (isRecommendedGroup(g)) return 2
                  const label = (g.sectionLabel || g.groupTitle || '').toLowerCase()
                  if (label.includes('required')) return 0
                  return 1  // named dept sections like "Computer Science Engineering"
                }
                groups.sort((a, b) => {
                  const aTier = sectionTier(a)
                  const bTier = sectionTier(b)
                  if (aTier !== bTier) return aTier - bTier
                  // Within same tier, preserve ASSIST order via groupPosition
                  return (a.rows[0]?._groupPosition ?? 999) - (b.rows[0]?._groupPosition ?? 999)
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
                                      {(() => {
                                        const isRec = isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel)
                                        return (
                                          <span style={{ fontSize: 11, color: isRec ? '#b45309' : '#166534', marginBottom: 4, display: 'block' }}>
                                            {isRec ? '★ Recommended by this program' : '✓ Required by this program'}
                                          </span>
                                        )
                                      })()}
                                      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                                        Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
                                        {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                                      </div>
                                      {pe.uniReq.allCourseLabels?.length > 1 && (
                                        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Also counts toward: {pe.uniReq.allCourseLabels.slice(1).join(', ')}</div>
                                      )}
                                      {pe.options.map((opt, j) => (
                                        <div key={j}>
                                          {j > 0 && <div style={{ fontSize: 11, color: '#bbb', padding: '6px 0', borderTop: '1px dashed #eee', marginTop: 6, marginBottom: 2 }}>or instead:</div>}
                                          {opt.courses.length > 1 && <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Take all of these together:</div>}
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
                                  {subtitle}{units ? ` · ${units} units` : ''}
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
                                  {(() => {
                                    const isRec = isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel)
                                    return (
                                      <div style={{ fontSize: 11, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                                        background: isRec ? '#fff8e1' : '#f0fdf4', borderRadius: 4, padding: '2px 8px',
                                        color: isRec ? '#b45309' : '#166534', fontWeight: 600 }}>
                                        {isRec ? '★ Recommended by this program' : '✓ Required by this program'}
                                      </div>
                                    )
                                  })()}
                                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                                    Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
                                    {pe.uniReq.units ? ` (${pe.uniReq.units} units)` : ''}
                                  </div>
                                  {pe.uniReq.allCourseLabels?.length > 1 && (
                                    <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Also counts toward: {pe.uniReq.allCourseLabels.slice(1).join(', ')}</div>
                                  )}
                                  {pe.options.map((opt, j) => (
                                    <div key={j}>
                                      {j > 0 && <div style={{ fontSize: 11, color: '#bbb', padding: '6px 0', borderTop: '1px dashed #eee', marginTop: 6, marginBottom: 2 }}>or instead:</div>}
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

              {/* No articulation section — split into truly missing vs covered by another option */}
              {overlapData.noArticulation?.length > 0 && (() => {
                const trulyMissing = overlapData.noArticulation.filter(na => !na.coveredByAnotherOption)
                const coveredElsewhere = overlapData.noArticulation.filter(na => na.coveredByAnotherOption)
                return (
                  <div style={{ marginTop: 32 }}>
                    {trulyMissing.length > 0 && (
                      <>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
                          letterSpacing: '0.1em', paddingBottom: 8, borderBottom: '2px solid #e8e8e4', marginBottom: 8
                        }}>
                          Required — no course available at {ccName}
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
                          These university requirements have no equivalent course at {ccName}. You may need to complete them after transferring, or check if another CC offers an articulated equivalent.
                        </div>
                        {trulyMissing.map((na, i) => (
                          <div key={i} style={{
                            background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8,
                            padding: '10px 14px', marginBottom: 8,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
                          }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', marginBottom: 4 }}>
                                {na.sectionLabel || na.groupTitle}
                              </div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>
                                {na.uniReq.prefix} {na.uniReq.number} — {na.uniReq.title}
                                {na.uniReq.units ? <span style={{ fontWeight: 400, color: '#888', fontSize: 12, marginLeft: 6 }}>{na.uniReq.units} units</span> : ''}
                              </div>
                              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{na.program}</div>
                              {na.reason && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{na.reason}</div>}
                            </div>
                            <span style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>No equivalent</span>
                          </div>
                        ))}
                      </>
                    )}

                    {coveredElsewhere.length > 0 && (
                      <>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
                          letterSpacing: '0.1em', paddingBottom: 8, borderBottom: '2px solid #e8e8e4',
                          marginBottom: 8, marginTop: trulyMissing.length > 0 ? 28 : 0
                        }}>
                          Already covered — alternative available at {ccName}
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
                          These university courses have no direct equivalent at {ccName}, but they're part of a "choose any one" group — and another option in that group <em>is</em> available at {ccName}, so <strong>you're already covered</strong>. You could also look for an equivalent at another CC if you prefer this path.
                        </div>
                        {coveredElsewhere.map((na, i) => (
                          <div key={i} style={{
                            background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8,
                            padding: '10px 14px', marginBottom: 8,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                            opacity: 0.8,
                          }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', marginBottom: 4 }}>
                                {na.sectionLabel || na.groupTitle} · choose any {na.nRequired || 1}
                              </div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#555' }}>
                                {na.uniReq.prefix} {na.uniReq.number} — {na.uniReq.title}
                                {na.uniReq.units ? <span style={{ fontWeight: 400, color: '#999', fontSize: 12, marginLeft: 6 }}>{na.uniReq.units} units</span> : ''}
                              </div>
                              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{na.program}</div>
                              {(() => {
                                // Find the articulated sibling — must match exact groupId from the same program
                                // The noArt entry's groupId is `${group.groupId}_${section.position}` from buildCellMap.
                                // The row's programEntries store the original groupId before canonical override.
                                const sibling = overlapData.rows.find(r =>
                                  r.programEntries.some(pe =>
                                    pe.program === na.program &&
                                    pe.nRequired !== null &&
                                    pe.groupId === na.groupId
                                  )
                                )
                                const siblingLabel = sibling
                                  ? sibling.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                                  : null
                                return (
                                  <div style={{ fontSize: 12, color: '#166534', marginTop: 6, fontWeight: 500 }}>
                                    ✓ {siblingLabel
                                      ? <><strong>{siblingLabel}</strong> at {ccName} satisfies this requirement — you're covered</>
                                      : <>Another option in this group is available at {ccName} — you're covered</>
                                    }
                                  </div>
                                )
                              })()}
                            </div>
                            <span style={{ fontSize: 11, background: '#f0f0f0', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>Optional path</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )
              })()}
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
                    {includeRecommended ? '✓ Including recommended' : '+ Add recommended'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                  Tracking {includeRecommended ? 'required + recommended' : 'required only'} · check rows to update
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
                            {isTop && summary.length > 1 && <span>💜 </span>}{s.label}
                          </div>
                          <div style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{s.completed}/{s.total}</div>
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

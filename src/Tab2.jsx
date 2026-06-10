import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { KNOWN_UNIVERSITIES, KNOWN_CCS } from './App'

const ASSIST_BASE = import.meta.env.VITE_ASSIST_BASE
const YEAR_ID = import.meta.env.VITE_ACADEMIC_YEAR_ID || 76

const TERMS = [
  'Fall 2025', 'Spring 2026', 'Summer 2026',
  'Fall 2026', 'Spring 2027', 'Summer 2027',
  'Fall 2027', 'Spring 2028',
]

// ─── ASSIST helpers ───────────────────────────────────────────────────────────

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
        const others = reports.filter(r =>
          r.type !== 'Major' && r.type !== 'Department' &&
          r.type !== 'AllDepartments' && r.type !== 'SendingDepartment'
        )
        if (others.length > 0) return others
      } catch {}
    }
  } catch {}
  return []
}

async function getAgreement(key) {
  return assistGet(`/articulation/api/Agreements?Key=${encodeURIComponent(key)}`)
}

// ─── Course parsing ───────────────────────────────────────────────────────────

function extractCourse(c) {
  const prefix = (c.prefix || '').trim()
  const number = (c.courseNumber || c.number || '').trim()
  if (!prefix || !number) return null
  return {
    prefix, number,
    title: c.courseTitle || c.title || '',
    units: c.maxUnits || c.minUnits || 3,
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

  for (const group of assets.filter(a => a.type === 'RequirementGroup')) {
    const groupTitle = reqTitles
      .filter(t => t.position < group.position)
      .sort((a, b) => b.position - a.position)[0]?.content || 'MAJOR REQUIREMENTS'

    const sections = group.sections || []
    const sectionHeader = sections.find(s => s.type === 'SectionHeader')
    const sectionLabel = sectionHeader?.content || ''
    const dataSections = sections.filter(s => s.type === 'Section')

    const instr = group.instruction || {}
    const instrType = instr.type || ''
    const instrConjunction = (instr.conjunction || '').toLowerCase()

    let groupIsPickN = false
    let groupNRequired = null
    let groupPickType = null
    let groupPickMin = null
    let groupPickMax = null
    let isSectionBundled = false

    if (instrType === 'NFromArea' || instrType === 'NFromConjunction') {
      groupIsPickN = true
      groupNRequired = instr.amount ?? 1
      const isUnitBased = ['SemesterUnit', 'QuarterUnit', 'Unit'].includes(instr.amountUnitType)
      groupPickType = isUnitBased ? 'units' : 'count'
      isSectionBundled = groupPickType === 'count' && (instr.amount ?? 1) < dataSections.length
    } else if (instrType === 'NToNFromConjunction') {
      groupIsPickN = true
      groupPickMin = instr.amount ?? 1
      groupPickMax = instr.toAmount ?? null
      groupNRequired = groupPickMin
      groupPickType = 'range'
    } else if (instrType === 'NOrUnits') {
      groupIsPickN = true
      groupNRequired = instr.amount ?? 1
      groupPickType = 'count'
    } else if (instrType === 'NFollowing') {
      groupIsPickN = true
      groupNRequired = instr.amount ?? 1
      groupPickType = 'count'
    } else if (instrType === 'NFromUnits') {
      groupIsPickN = true
      groupNRequired = instr.amount ?? 1
      groupPickType = 'units'
    } else if (instrType === 'NToNFollowing') {
      groupIsPickN = true
      groupPickMin = instr.amount ?? 1
      groupPickMax = instr.toAmount ?? null
      groupNRequired = groupPickMin
      groupPickType = 'range'
    } else if (instrConjunction === 'or') {
      groupIsPickN = true
      const groupNAdv = (group.advisements || []).find(a => a.type === 'NFollowing')
      groupNRequired = groupNAdv?.amount ?? 1
      groupPickType = 'count'
      isSectionBundled = true
    }

    for (const section of dataSections) {
      const secAdvs = section.advisements || []
      const secNFollowing = secAdvs.find(a => a.type === 'NFollowing')
      const secNFromUnits = secAdvs.find(a => a.type === 'NFromUnits')
      const secNToN = secAdvs.find(a => a.type === 'NToNFollowing')
      const secNInAreas = secAdvs.find(a => a.type === 'NInNDifferentAreas')
      const secCompleteAll = secAdvs.find(a => a.type === 'CompleteFollowing')

      let nRequired = null
      let pickType = null
      let pickMin = null
      let pickMax = null
      let groupId

      if (secCompleteAll) {
        nRequired = null; pickType = null
        groupId = `${group.groupId}_${section.position}`
      } else if (secNFollowing) {
        nRequired = secNFollowing.amount ?? 1; pickType = 'count'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNFromUnits) {
        nRequired = secNFromUnits.amount ?? 1; pickType = 'units'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNToN) {
        pickMin = secNToN.minAmount ?? secNToN.amount ?? 1
        pickMax = secNToN.maxAmount ?? null
        nRequired = pickMin; pickType = 'range'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNInAreas) {
        nRequired = secNInAreas.amount ?? 1; pickType = 'areas'
        groupId = `${group.groupId}_${section.position}`
      } else if (groupIsPickN) {
        nRequired = groupNRequired
        pickType = groupPickType
        pickMin = groupPickMin
        pickMax = groupPickMax
        groupId = `pick_${group.groupId}`
      } else {
        nRequired = null; pickType = null
        groupId = `${group.groupId}_${section.position}`
      }

      const ctx = {
        sectionLabel, groupTitle, nRequired, pickType, pickMin, pickMax, groupId,
        isSectionBundled: groupIsPickN ? isSectionBundled : false,
        sectionPosition: section.position,
        groupPosition: group.position,
      }

      for (const row of section.rows || []) {
        for (const cell of row.cells || []) {
          if (cell.id) {
            cellMap.set(cell.id, ctx)
            cellMap.set(String(cell.id), ctx)
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
    const groupRegistry = {}

    for (const item of arts) {
      const art = item.articulation || item
      const templateCellId = item.templateCellId
      const cellContext = cellMap.get(templateCellId) || cellMap.get(String(templateCellId)) || {
        sectionLabel: '', groupTitle: 'MAJOR REQUIREMENTS',
        nRequired: null, pickType: null, pickMin: null, pickMax: null,
        groupId: templateCellId || Math.random().toString(),
        isSectionBundled: false, sectionPosition: 0, groupPosition: 0,
      }

      const gid = cellContext.groupId
      if (!groupRegistry[gid]) {
        groupRegistry[gid] = { nRequired: cellContext.nRequired, pickType: cellContext.pickType, articulated: [], unarticulated: [] }
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
          options, ...cellContext,
        })
      }

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

    const seenCellIds = new Set(arts.map(item => item.templateCellId))
    const assets = typeof agreement.templateAssets === 'string'
      ? JSON.parse(agreement.templateAssets) : agreement.templateAssets || []

    for (const group of assets.filter(a => a.type === 'RequirementGroup')) {
      for (const section of (group.sections || []).filter(s => s.type === 'Section')) {
        for (const row of section.rows || []) {
          for (const cell of row.cells || []) {
            if (!cell.id || seenCellIds.has(cell.id)) continue
            const ctx = cellMap.get(cell.id) || cellMap.get(String(cell.id))
            if (!ctx) continue
            const course = cell.course || {}
            const isPickN = ctx.nRequired !== null
            const siblingArticulated = groupRegistry[ctx.groupId]?.articulated?.length > 0
            noArticulationResults.push({
              program: programLabel,
              uniRequirement: {
                prefix: (course.prefix || '').trim(),
                number: (course.courseNumber || course.number || '').trim(),
                title: course.courseTitle || course.title || '',
                units: course.maxUnits || course.minUnits || null,
                allCourseLabels: [`${(course.prefix || '').trim()} ${(course.courseNumber || course.number || '').trim()}`],
              },
              noArticulation: true, reason: null,
              partOfPickGroup: isPickN,
              coveredByAnotherOption: isPickN && siblingArticulated,
              ...ctx,
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

// ─── Utility ─────────────────────────────────────────────────────────────────

function getPlanSaveKey(programs) {
  return 'tab2_progress_' + programs.map(p => p.majorKey).sort().join('|')
}

function isRecommendedSection(label) {
  if (!label) return false
  const lower = label.toLowerCase().trim()
  return (
    lower === 'recommended courses' || lower === 'recommended electives' ||
    lower === 'recommended preparation' || lower === 'recommended but not required' ||
    lower === 'recommended to complete prior to transfer' ||
    lower === 'strongly recommended courses' || lower === 'highly recommended' ||
    lower === 'departmental recommendations' ||
    lower.includes('strongly recommended') || lower.includes('highly recommended') ||
    lower.includes('recommended but not required') || lower.includes('departmental recommendation')
  )
}

function pickGroupLabel(group) {
  const n = group.nRequired
  const total = group.rows.length
  switch (group.pickType) {
    case 'units': return `Choose courses totaling ${n} unit${n !== 1 ? 's' : ''} from these ${total} options`
    case 'range': return group.pickMax
      ? `Choose ${group.pickMin}–${group.pickMax} courses from these ${total} options`
      : `Choose at least ${n} course${n !== 1 ? 's' : ''} from these ${total} options`
    case 'areas': return `Choose ${n} course${n !== 1 ? 's' : ''} from different areas (${total} options)`
    default:
      return group.isSectionBundled
        ? `Complete ${n === 1 ? '1' : n} of these ${total} options`
        : `Choose any ${n} of these ${total} options`
  }
}

// ─── Main Tab2 component ──────────────────────────────────────────────────────

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
  const [showBanner, setShowBanner] = useState(() => localStorage.getItem('tab2_banner_dismissed') !== '1')
  const [plannerStart, setPlannerStart] = useState(TERMS[0])
  const [plannerEnd, setPlannerEnd] = useState(TERMS[4])
  const [geTaken, setGeTaken] = useState(0)
  const GE_TOTAL = 35
  const [includeSummer, setIncludeSummer] = useState(false)
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
        plan_key: key, user_id: user.id,
        completed_courses: [...newCompleted],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plan_key,user_id' })
    }, 1000)
  }

  async function savePlan(newCcId, newCcName, newPrograms) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('tab2_plan').upsert({
      user_id: user.id, cc_id: newCcId, cc_name: newCcName,
      programs: newPrograms, updated_at: new Date().toISOString(),
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
          const isPickGroup = art.nRequired !== null
          const ccCourseKey = cheapestOpt.courses.map(c => `${c.prefix} ${c.number}`).sort().join('+')
          let ccKey
          if (isPickGroup && art.isSectionBundled) ccKey = `${art.groupId}__sec${art.sectionPosition}`
          else if (isPickGroup) ccKey = `${art.groupId}__${ccCourseKey}`
          else ccKey = ccCourseKey

          if (!reqMap[ccKey]) {
            reqMap[ccKey] = { ccKey, primaryCourses: [...cheapestOpt.courses], programEntries: [], isSectionBundled: art.isSectionBundled || false }
          }

          if (art.isSectionBundled) {
            cheapestOpt.courses.forEach(c => {
              if (!reqMap[ccKey].primaryCourses.some(e => e.prefix === c.prefix && e.number === c.number))
                reqMap[ccKey].primaryCourses.push(c)
            })
          }

          const entryKey = `${prog.uniName}|${art.uniRequirement.prefix}|${art.uniRequirement.number}`
          if (!reqMap[ccKey].programEntries.some(e => e._entryKey === entryKey)) {
            reqMap[ccKey].programEntries.push({
              _entryKey: entryKey,
              program: `${prog.uniName} → ${prog.majorLabel}`,
              uniReq: art.uniRequirement, options: art.options,
              groupTitle: art.groupTitle, sectionLabel: art.sectionLabel,
              nRequired: art.nRequired, pickType: art.pickType,
              pickMin: art.pickMin, pickMax: art.pickMax,
              groupId: art.groupId, isSectionBundled: art.isSectionBundled || false,
              groupPosition: art.groupPosition, sectionPosition: art.sectionPosition,
            })
          }
        }

        for (const na of noArts) {
          const naKey = `${prog.uniName}|${na.uniRequirement.prefix}|${na.uniRequirement.number}`
          if (!noArtMap[naKey]) {
            noArtMap[naKey] = {
              program: `${prog.uniName} → ${prog.majorLabel}`,
              uniReq: na.uniRequirement, reason: na.reason,
              groupTitle: na.groupTitle, sectionLabel: na.sectionLabel,
              groupId: na.groupId, nRequired: na.nRequired ?? null,
              pickType: na.pickType ?? null, isSectionBundled: na.isSectionBundled || false,
              partOfPickGroup: na.partOfPickGroup || false,
              coveredByAnotherOption: na.coveredByAnotherOption || false,
              groupPosition: na.groupPosition ?? 999, sectionPosition: na.sectionPosition ?? 999,
            }
          }
        }
      }

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
        const requiredEntry = entry.programEntries.find(pe => !isRecommendedSection(pe.groupTitle) && !isRecommendedSection(pe.sectionLabel))
        const canonicalEntry = requiredEntry || entry.programEntries[0]
        return {
          ...entry, coverage,
          groupTitle: canonicalEntry?.groupTitle,
          sectionLabel: canonicalEntry?.sectionLabel,
          groupId: canonicalEntry?.groupId,
          nRequired: canonicalEntry?.nRequired ?? null,
          pickType: canonicalEntry?.pickType ?? null,
          pickMin: canonicalEntry?.pickMin ?? null,
          pickMax: canonicalEntry?.pickMax ?? null,
          isSectionBundled: canonicalEntry?.isSectionBundled || false,
          _groupPosition: canonicalEntry?.groupPosition ?? 999,
          _sectionPosition: canonicalEntry?.sectionPosition ?? 999,
        }
      })

      rows.sort((a, b) => {
        if (a._groupPosition !== b._groupPosition) return a._groupPosition - b._groupPosition
        if (a._sectionPosition !== b._sectionPosition) return a._sectionPosition - b._sectionPosition
        if (b.coverage !== a.coverage) return b.coverage - a.coverage
        return a.ccKey.localeCompare(b.ccKey)
      })

      setOverlapData({
        rows, totalPrograms,
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
        if (!programMap[pe.program]) continue
        if (isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel)) continue
        programMap[pe.program].total += 1
        if (isDone) programMap[pe.program].completed += 1
      }
    }
    for (const na of (overlapData.noArticulation || [])) {
      if (!programMap[na.program]) continue
      if (isRecommendedSection(na.groupTitle) || isRecommendedSection(na.sectionLabel)) continue
      if (na.coveredByAnotherOption) continue
      programMap[na.program].total += 1
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

  function computePacingPerProgram(majorUnitsLeft, majorUnitsTotal, majorUnitsDone) {
    const termList = includeSummer ? TERMS : TERMS.filter(t => !t.startsWith('Summer'))
    const startIdx = termList.indexOf(plannerStart)
    const endIdx = termList.indexOf(plannerEnd)
    if (endIdx <= startIdx) return null
    const semesters = endIdx - startIdx
    if (semesters === 0) return null

    const geLeft = Math.max(0, GE_TOTAL - geTaken)
    const totalLeft = majorUnitsLeft + geLeft
    const perSemester = Math.round(totalLeft / semesters)

    const barPct = Math.min(100, Math.round((perSemester / 20) * 100))
    return { majorUnitsLeft, majorUnitsTotal, majorUnitsDone, geLeft, semesters, perSemester, barPct }
  }

  const summary = computeAttainability()

  const programMajorUnits = (() => {
    if (!overlapData) return {}
    const mu = {}
    for (const label of overlapData.programLabels) mu[label] = { total: 0, done: 0 }
    for (const row of overlapData.rows) {
      const isDone = completedCourses.has(row.ccKey)
      const rowUnits = row.primaryCourses.reduce((s, c) => s + (c.units || 3), 0)
      for (const pe of row.programEntries) {
        if (!mu[pe.program]) continue
        mu[pe.program].total += rowUnits
        if (isDone) mu[pe.program].done += rowUnits
      }
    }
    return mu
  })()

  const perProgramPacings = overlapData
    ? overlapData.programLabels.map(label => {
        const mu = programMajorUnits[label] || { total: 0, done: 0 }
        return computePacingPerProgram(Math.max(0, mu.total - mu.done), mu.total, mu.done)
      })
    : []

  // ─── Sidebar ─────────────────────────────────────────────────────────────

  function renderSidebar() {
    const termList = includeSummer ? TERMS : TERMS.filter(t => !t.startsWith('Summer'))
    const startIdx = termList.indexOf(plannerStart)
    const endIdx = termList.indexOf(plannerEnd)
    const validTerms = endIdx > startIdx

    return (
      <>
        {/* ── Progress ── */}
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#1a1a1a' }}>Your plan</div>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 14 }}>Check rows to mark as done</div>

        {summary.length === 0 ? (
          <div style={{ fontSize: 12, color: '#888' }}>Check off courses to see your progress</div>
        ) : (
          summary.map((s, i) => {
            const pct = s.total === 0 ? 0 : Math.round((s.completed / s.total) * 100)
            const isTop = i === 0 && summary.length > 1
            const showHeart = isTop && completedCourses.size > 0
            return (
              <div key={i} style={{ marginBottom: i < summary.length - 1 ? 14 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: isTop ? 600 : 400, color: isTop ? '#1a1a1a' : '#333', flex: 1, marginRight: 8 }}>
                    {showHeart && <span>💜 </span>}{s.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>{s.completed}/{s.total}</div>
                </div>
                <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: pct === 100 ? '#4caf50' : '#6C5CE7', height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
              </div>
            )
          })
        )}

        {/* ── Transfer Pacing ── */}
        <div style={{ marginTop: 20, borderTop: '1px solid #d4ccff', paddingTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#3730a3' }}>🗓 Transfer pacing</div>

          {/* Term selectors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>Starting term</div>
              <select value={plannerStart} onChange={e => setPlannerStart(e.target.value)} style={{ fontSize: 12, width: '100%' }}>
                {TERMS.slice(0, -1).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ color: '#aaa', marginTop: 14, fontSize: 12 }}>→</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>Transfer goal</div>
              <select value={plannerEnd} onChange={e => setPlannerEnd(e.target.value)} style={{ fontSize: 12, width: '100%' }}>
                {TERMS.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Include summer toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div
              onClick={() => setIncludeSummer(v => !v)}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
                background: includeSummer ? '#6C5CE7' : '#ccc',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2,
                left: includeSummer ? 16 : 2,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 12, color: '#444', cursor: 'pointer' }} onClick={() => setIncludeSummer(v => !v)}>
              Include summer
            </span>
          </div>

          {/* GE units taken input */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>GE units completed so far (out of {GE_TOTAL})</div>
            <input
              type="number" min={0} max={GE_TOTAL}
              value={geTaken}
              onChange={e => setGeTaken(Math.min(GE_TOTAL, Math.max(0, Number(e.target.value))))}
              style={{ fontSize: 13, width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>

          {!validTerms ? (
            <div style={{ fontSize: 12, color: '#666' }}>Set a valid start and transfer term above.</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#444', marginBottom: 10, lineHeight: 1.5 }}>
                {GE_TOTAL - Math.min(geTaken, GE_TOTAL)} GE units left · {perProgramPacings.find(p => p)?.semesters ?? '—'} semesters ({plannerStart} → {plannerEnd})
              </div>

              {/* Pacing cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                {overlapData.programLabels.map((label, i) => {
                  const pacing = perProgramPacings[i]
                  const mu = programMajorUnits[label] || { total: 0, done: 0 }
                  const majorLeft = Math.max(0, mu.total - mu.done)
                  const parts = label.split(' → ')
                  const uniName = parts[0] || label
                  const majorName = parts[1] || ''
                  if (!pacing) return null
                  const isDone = majorLeft === 0
                  const avgUnits = 4
                  const coursesPerSem = Math.max(1, Math.round(pacing.perSemester / avgUnits))
                  const loadColor = isDone ? '#16a34a' : coursesPerSem <= 3 ? '#16a34a' : coursesPerSem <= 4 ? '#d97706' : '#dc2626'
                  const loadBg = isDone ? '#f0fdf4' : coursesPerSem <= 3 ? '#f0fdf4' : coursesPerSem <= 4 ? '#fffbeb' : '#fef2f2'
                  const loadBorder = isDone ? '#86efac' : coursesPerSem <= 3 ? '#86efac' : coursesPerSem <= 4 ? '#fde68a' : '#fca5a5'
                  return (
                    <div key={label} style={{
                      borderRadius: 10,
                      padding: '12px',
                      background: loadBg,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      border: `1px solid ${loadBorder}`,
                      borderLeft: `4px solid ${loadColor}`,
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#1a1a1a', lineHeight: 1.3 }}>{uniName}</div>
                      <div style={{ fontSize: 10, color: '#666', lineHeight: 1.2 }}>{majorName}</div>
                      <div style={{ borderTop: '1px solid #e8e8e4', paddingTop: 8, marginTop: 2 }}>
                        {isDone ? (
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>✓ Done</div>
                        ) : (
                          <div style={{ fontSize: 22, fontWeight: 800, color: loadColor, lineHeight: 1 }}>
                            ~{coursesPerSem}
                            <span style={{ fontSize: 11, fontWeight: 400, color: '#666', marginLeft: 2 }}>courses/sem</span>
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: '#666', marginTop: 3 }}>
                          {isDone ? `${mu.total}u complete` : `${majorLeft}u left · ${mu.done}u done`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Workload legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14, background: '#f5f4ff', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3730a3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Workload key</div>
                {[
                  { color: '#16a34a', bg: '#dcfce7', label: '≤ 3 courses/sem', sub: 'manageable' },
                  { color: '#d97706', bg: '#fef3c7', label: '4 courses/sem', sub: 'busy but doable' },
                  { color: '#dc2626', bg: '#fee2e2', label: '5+ courses/sem', sub: 'heavy semester' },
                ].map(({ color, bg, label, sub }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `2px solid ${color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#333' }}><strong>{label}</strong> — {sub}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Disclaimer */}
          <div style={{
            marginTop: 4,
            background: '#f5f5f3',
            border: '1px solid #e8e8e4',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>How this is calculated</div>
            <div style={{ fontSize: 11, color: '#444', lineHeight: 1.65 }}>
              Major prep is based on your <strong>unchecked courses</strong> above. GE (IGETC) is shared across all UC/CSU schools — enter how many units you've already completed. The per-semester number combines remaining major prep + remaining GE, divided evenly across your semesters. Summer is excluded unless toggled on. Always verify sequencing with your counselor.
            </div>
          </div>
        </div>
      </>
    )
  }

  // ─── Course list rendering ────────────────────────────────────────────────

  function renderCourseList() {
    const groups = []
    const groupIdToGroup = {}
    const noArtByGroupId = {}
    const noArtByGroupIdFlat = {}
    const inlineRequiredNoArt = []

    for (const na of (overlapData.noArticulation || [])) {
      if (na.partOfPickGroup) {
        if (!noArtByGroupId[na.groupId]) noArtByGroupId[na.groupId] = {}
        const secKey = na.sectionPosition ?? 'unknown'
        if (!noArtByGroupId[na.groupId][secKey]) {
          noArtByGroupId[na.groupId][secKey] = { courses: [], reason: na.reason, sectionPosition: na.sectionPosition }
        }
        const slot = noArtByGroupId[na.groupId][secKey]
        if (!slot.courses.some(x => x.prefix === na.uniReq.prefix && x.number === na.uniReq.number))
          slot.courses.push({ prefix: na.uniReq.prefix, number: na.uniReq.number, title: na.uniReq.title, units: na.uniReq.units })
        if (na.reason && !slot.reason) slot.reason = na.reason
        if (!noArtByGroupIdFlat[na.groupId]) noArtByGroupIdFlat[na.groupId] = []
        if (!noArtByGroupIdFlat[na.groupId].some(x => x.uniReq.prefix === na.uniReq.prefix && x.uniReq.number === na.uniReq.number))
          noArtByGroupIdFlat[na.groupId].push(na)
      } else if (!na.coveredByAnotherOption) {
        inlineRequiredNoArt.push(na)
      }
    }

    for (const row of overlapData.rows) {
      const groupId = row.groupId ?? `singleton_${row.ccKey}`
      if (!groupIdToGroup[groupId]) {
        const g = {
          groupId, groupTitle: row.groupTitle || 'MAJOR REQUIREMENTS',
          sectionLabel: row.sectionLabel || '',
          nRequired: row.nRequired ?? null, pickType: row.pickType ?? null,
          pickMin: row.pickMin ?? null, pickMax: row.pickMax ?? null,
          isSectionBundled: row.isSectionBundled || false, rows: [],
        }
        groupIdToGroup[groupId] = g
        groups.push(g)
      }
      groupIdToGroup[groupId].rows.push(row)
    }

    for (const g of Object.values(groupIdToGroup)) {
      g.rows.sort((a, b) => b.coverage - a.coverage)
    }

    for (const na of inlineRequiredNoArt) {
      const groupId = na.groupId ?? `noart_${na.uniReq.prefix}_${na.uniReq.number}`
      if (!groupIdToGroup[groupId]) {
        const g = {
          groupId, groupTitle: na.groupTitle || 'MAJOR REQUIREMENTS',
          sectionLabel: na.sectionLabel || '',
          nRequired: null, pickType: null, pickMin: null, pickMax: null,
          isSectionBundled: false, rows: [], noArtRows: [],
          _groupPosition: na.groupPosition ?? 999, _sectionPosition: na.sectionPosition ?? 999,
        }
        groupIdToGroup[groupId] = g
        groups.push(g)
      }
      if (!groupIdToGroup[groupId].noArtRows) groupIdToGroup[groupId].noArtRows = []
      groupIdToGroup[groupId].noArtRows.push(na)
    }

    const isRecommendedGroup = g => isRecommendedSection(g.groupTitle) || isRecommendedSection(g.sectionLabel)
    const sectionTier = g => {
      if (isRecommendedGroup(g)) return 2
      const label = (g.sectionLabel || g.groupTitle || '').toLowerCase()
      if (label.includes('required')) return 0
      return 1
    }
    groups.sort((a, b) => {
      const aTier = sectionTier(a), bTier = sectionTier(b)
      if (aTier !== bTier) return aTier - bTier
      const aPos = a.rows[0]?._groupPosition ?? a._groupPosition ?? 999
      const bPos = b.rows[0]?._groupPosition ?? b._groupPosition ?? 999
      return aPos - bPos
    })

    let lastDisplayLabel = null
    const rendered = []
    // FIX: single global set to track all rendered no-art keys across both passes
    const renderedNoArtKeys = new Set()

    for (const group of groups) {
      const isPickN = group.nRequired !== null
      const noArtSiblingSlots = Object.keys(noArtByGroupId[group.groupId] || {}).length
      const noArtSiblingsFlat = (noArtByGroupIdFlat[group.groupId] || []).length
      const isEffectivelyRequired = isPickN && group.rows.length <= 1 && noArtSiblingSlots === 0 && noArtSiblingsFlat === 0
      const displayLabel = group.sectionLabel || group.groupTitle || 'REQUIREMENTS'

      if (displayLabel !== lastDisplayLabel) {
        lastDisplayLabel = displayLabel
        rendered.push(
          <div key={`sec-${displayLabel}-${group.groupId}`} style={{ marginTop: rendered.length === 0 ? 0 : 32, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e8e8e4' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{displayLabel}</div>
          </div>
        )
      }

      if (isPickN && !isEffectivelyRequired) {
        rendered.push(
          <div key={`group-${group.groupId}`} style={{ border: '1.5px solid #ffe082', borderRadius: 10, marginBottom: 12, overflow: 'hidden', background: '#fffdf5' }}>
            <div style={{ padding: '9px 14px', borderBottom: '1px solid #ffe082', background: '#fff8e1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>↓</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>{pickGroupLabel(group)}</span>
                <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>— you don't need all of them</span>
              </div>
              {group.pickType === 'units' && (
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 6, padding: '4px 8px', background: '#fef3c7', borderRadius: 4, display: 'inline-block' }}>
                  ⚠️ Unit counts refer to the <strong>university's course units</strong>, not your CC's — tap any row to see details
                </div>
              )}
            </div>

            {[...group.rows, ...Object.values(noArtByGroupId[group.groupId] || {}).map(slot => ({ _isNoArt: true, slot }))].map((rowOrNa, rowIdx) => {
              if (rowOrNa._isNoArt) {
                const { slot } = rowOrNa
                const label = slot.courses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                const subtitle = slot.courses.map(c => c.title).filter(Boolean).join(' + ')
                const units = slot.courses.reduce((sum, c) => sum + (c.units || 0), 0)
                return (
                  <div key={`noart-${label}`} style={{ borderTop: '1px dashed #fecaca', background: '#fff5f5' }}>
                    <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fca5a5', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                      <span style={{ color: '#fca5a5', fontSize: 14, flexShrink: 0 }}>✕</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {label}
                          <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>No equivalent at {ccName}</span>
                        </div>
                        {subtitle && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
                        {slot.reason && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{slot.reason}</div>}
                        <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4, fontStyle: 'italic' }}>Choose a different option from this group instead</div>
                      </div>
                    </div>
                  </div>
                )
              }

              const row = rowOrNa
              const isDone = completedCourses.has(row.ccKey)
              const isExpanded = expandedRow === row.ccKey
              const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
              const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
              const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
              const coverageAll = row.coverage === overlapData.totalPrograms
              const coverageMost = row.coverage > 1 && !coverageAll
              const isSchoolSpecific = row.coverage === 1 && overlapData.totalPrograms > 1

              return (
                <div key={row.ccKey} style={{ borderTop: rowIdx > 0 ? '1px dashed #f0e6c8' : 'none', background: isDone ? '#f7f4ec' : '#fffdf5', opacity: isDone ? 0.6 : 1 }}>
                  {rowIdx > 0 && <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#ccc', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>}
                  <div onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
                    <div onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isDone} onChange={() => toggleCourse(row.ccKey)} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#b45309' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#aaa' : '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {label}
                        {coverageAll && <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                        {coverageMost && <span style={{ fontSize: 10, background: '#e0f7f4', color: '#0d7377', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                        {isSchoolSpecific && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>SCHOOL-SPECIFIC</span>}
                      </div>
                      {subtitle && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {overlapData.programLabels.map((progLabel, pi) => {
                        const has = row.programEntries.some(pe => pe.program === progLabel)
                        return (
                          <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            {overlapData.programLabels.length > 1 && <div style={{ fontSize: 9, color: '#bbb', textAlign: 'center', maxWidth: 48, lineHeight: 1.2 }}>{shortLabel(progLabel).split('\n')[0]}</div>}
                            <span style={{ color: has ? '#6C5CE7' : '#e0e0e0', fontSize: 16, lineHeight: 1 }}>●</span>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</div>
                  </div>
                  {isExpanded && renderExpandedRow(row)}
                </div>
              )
            })}
          </div>
        )
      } else {
        const effectiveNoArtRows = isEffectivelyRequired ? (noArtByGroupIdFlat[group.groupId] || []) : (group.noArtRows || [])

        group.rows.forEach(row => {
          const isDone = completedCourses.has(row.ccKey)
          const isExpanded = expandedRow === row.ccKey
          const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
          const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
          const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
          const coverageAll = row.coverage === overlapData.totalPrograms
          const coverageMost = row.coverage > 1 && !coverageAll
          const isSchoolSpecific = row.coverage === 1 && overlapData.totalPrograms > 1

          rendered.push(
            <div key={row.ccKey} style={{ border: '1px solid #efefed', borderRadius: 8, marginBottom: 6, background: isDone ? '#fafafa' : '#fff', opacity: isDone ? 0.55 : 1, overflow: 'hidden' }}>
              <div onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
                <div onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={isDone} onChange={() => toggleCourse(row.ccKey)} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1a1a1a' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#aaa' : '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {label}
                    {coverageAll && <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                    {coverageMost && <span style={{ fontSize: 10, background: '#e0f7f4', color: '#0d7377', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                    {isSchoolSpecific && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>SCHOOL-SPECIFIC</span>}
                  </div>
                  {subtitle && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {overlapData.programLabels.map((progLabel, pi) => {
                    const has = row.programEntries.some(pe => pe.program === progLabel)
                    return (
                      <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {overlapData.programLabels.length > 1 && <div style={{ fontSize: 9, color: '#bbb', textAlign: 'center', maxWidth: 48, lineHeight: 1.2 }}>{shortLabel(progLabel).split('\n')[0]}</div>}
                        <span style={{ color: has ? '#6C5CE7' : '#e0e0e0', fontSize: 16, lineHeight: 1 }}>●</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</div>
              </div>
              {isExpanded && renderExpandedRow(row, isEffectivelyRequired)}
            </div>
          )
        })

        // FIX: register each inline no-art key before pushing, so the bottom pass skips them
        effectiveNoArtRows.forEach(na => {
          const naInlineKey = `${na.uniReq.prefix}|${na.uniReq.number}|${na.program}`
          renderedNoArtKeys.add(naInlineKey)
          rendered.push(
            <div key={`noart-inline-${na.uniReq.prefix}-${na.uniReq.number}-${na.program}`} style={{ border: '1px solid #fecaca', borderRadius: 8, marginBottom: 6, background: '#fff5f5', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ color: '#fca5a5', fontSize: 14, flexShrink: 0 }}>✕</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {na.uniReq.prefix} {na.uniReq.number}
                    {na.uniReq.title && <span style={{ fontWeight: 400, color: '#b91c1c' }}>— {na.uniReq.title}</span>}
                  </div>
                  {na.uniReq.units && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{na.uniReq.units} units · {na.program}</div>}
                  {na.reason && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{na.reason}</div>}
                </div>
                <span style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0 }}>No equivalent at {ccName}</span>
              </div>
            </div>
          )
        })
      }
    }

    // Bottom pass: only render orphan no-art groups not already rendered above
    for (const g of groups) {
      const unrenderedNoArtRows = (g.noArtRows || []).filter(na => {
        const key = `${na.uniReq.prefix}|${na.uniReq.number}|${na.program}`
        return !renderedNoArtKeys.has(key)
      })
      if (unrenderedNoArtRows.length > 0 && g.rows.length === 0) {
        const displayLabel = g.sectionLabel || g.groupTitle || 'REQUIREMENTS'
        if (displayLabel !== lastDisplayLabel) {
          lastDisplayLabel = displayLabel
          rendered.push(
            <div key={`sec-noart-${displayLabel}-${g.groupId}`} style={{ marginTop: rendered.length === 0 ? 0 : 32, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e8e8e4' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{displayLabel}</div>
            </div>
          )
        }
        for (const na of unrenderedNoArtRows) {
          const naRenderKey = `${na.uniReq.prefix}|${na.uniReq.number}|${na.program}`
          renderedNoArtKeys.add(naRenderKey)
          rendered.push(
            <div key={`noart-req-${na.uniReq.prefix}-${na.uniReq.number}-${na.program}`} style={{ border: '1px solid #fecaca', borderRadius: 8, marginBottom: 6, background: '#fff5f5', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ color: '#fca5a5', fontSize: 14, flexShrink: 0 }}>✕</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {na.uniReq.prefix} {na.uniReq.number}
                    {na.uniReq.title && <span style={{ fontWeight: 400, color: '#b91c1c' }}>— {na.uniReq.title}</span>}
                  </div>
                  {na.uniReq.units && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{na.uniReq.units} units · {na.program}</div>}
                  {na.reason && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{na.reason}</div>}
                </div>
                <span style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0 }}>No equivalent at {ccName}</span>
              </div>
            </div>
          )
        }
      }
    }

    return rendered
  }

  function renderExpandedRow(row, isEffectivelyRequired = false) {
    return (
      <div style={{ borderTop: '1px solid #f0f0f0', background: '#fafafa', padding: '12px 14px 14px 38px' }}>
        {isEffectivelyRequired && (
          <div style={{ fontSize: 12, color: '#888', background: '#f0f0f0', borderRadius: 6, padding: '7px 10px', marginBottom: 12 }}>
            ℹ️ The university offers multiple ways to satisfy this requirement, but this is the only one with an equivalent at {ccName}.
          </div>
        )}
        {row.programEntries.map((pe, i) => (
          <div key={i} style={{ marginBottom: i < row.programEntries.length - 1 ? 14 : 0, paddingBottom: i < row.programEntries.length - 1 ? 14 : 0, borderBottom: i < row.programEntries.length - 1 ? '1px solid #eee' : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{pe.program}</div>
            {(() => {
              const isRec = isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel)
              return (
                <div style={{ fontSize: 11, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: isRec ? '#fff8e1' : '#f0fdf4', borderRadius: 4, padding: '2px 8px', color: isRec ? '#b45309' : '#166534', fontWeight: 600 }}>
                  {isRec ? '★ Recommended by this program' : '✓ Required by this program'}
                </div>
              )
            })()}
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              Satisfies: <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
              {pe.uniReq.units ? ` (${pe.uniReq.units} uni units)` : ''}
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
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

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
                setCcId(newCcId); setCcName(newCcName); setPrograms([]); setSelUniId(''); setMajors([])
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
                  <select value={selUniId} onChange={e => { setSelUniId(e.target.value); setSelUniName(e.target.selectedOptions[0]?.text || ''); setSelMajor(null) }}>
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
                    : <select value={selMajor?.key || ''} onChange={e => setSelMajor(majors.find(m => m.key === e.target.value) || null)} disabled={!selUniId || majors.length === 0}>
                        <option value="">{!selUniId ? 'Select university first' : majors.length === 0 ? 'No agreement found' : 'Select major or department...'}</option>
                        {majors.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                  }
                </div>
              </div>
              <button className="btn-secondary" style={{ width: '100%', marginTop: 4 }} onClick={addProgram} disabled={!selUniId || !selMajor}>
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
            <div style={{ background: '#f0edff', border: '1px solid #d4ccff', borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a' }}>How to read this</div>
                <button onClick={() => { setShowBanner(false); localStorage.setItem('tab2_banner_dismissed', '1') }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 }} aria-label="Dismiss">×</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr' : '1fr', gap: '8px 20px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ color: '#6C5CE7', fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>●</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Purple dot</strong> — this program requires the course
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ color: '#e0e0e0', fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>●</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Grey dot</strong> — not required by that program
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>🟡</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Yellow card</strong> — choose from the group, you don't need all of them
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>🔴</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Red row</strong> — no equivalent course at your CC
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>▼</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Tap any row</strong> — see which university requirement it satisfies
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>☑</span>
                  <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                    <strong style={{ color: '#1a1a1a' }}>Check it off</strong> — progress saves automatically
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, paddingTop: 12, borderTop: '1px solid #d4ccff' }}>
                <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '3px 8px', fontWeight: 700 }}>ALL PROGRAMS</span>
                <span style={{ fontSize: 10, background: '#e0f7f4', color: '#0d7377', borderRadius: 4, padding: '3px 8px', fontWeight: 700 }}>MULTIPLE</span>
                <span style={{ fontSize: 10, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '3px 8px', fontWeight: 700 }}>SCHOOL-SPECIFIC</span>
              </div>

              {overlapData.totalPrograms > 1 && (
                <div style={{ background: '#fff', border: '1px solid #d4ccff', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a', marginBottom: 8 }}>📋 Prioritize for max efficiency</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '3px 8px', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>1st ALL PROGRAMS</span>
                      <span style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>Do these first — one course counts toward every school at once. Maximum efficiency.</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 10, background: '#e0f7f4', color: '#0d7377', borderRadius: 4, padding: '3px 8px', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>2nd MULTIPLE</span>
                      <span style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>Do these next — solid overlap, keeps several options open.</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 10, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '3px 8px', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>3rd SCHOOL-SPECIFIC</span>
                      <span style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>Do these last, with your remaining units, once you've narrowed down your top-choice school. Transfer students can bring a max of 70 units.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: isWide ? 'grid' : 'block', gridTemplateColumns: isWide ? '1fr 380px' : undefined, gap: isWide ? 40 : 0, alignItems: 'start' }}>
            <div>
              {renderCourseList()}
              {overlapData.rows.length === 0 && (
                <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
              )}
            </div>

            {/* Sidebar — sticky with independent scroll */}
            <div style={{ position: isWide ? 'sticky' : 'static', top: 16, maxHeight: isWide ? 'calc(100vh - 32px)' : undefined, overflowY: isWide ? 'auto' : undefined }}>
              <div className="card" style={{ background: '#f9f9f7', border: '1px solid #e8e8e4' }}>
                {renderSidebar()}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

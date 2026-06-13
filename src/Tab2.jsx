import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { KNOWN_UNIVERSITIES, KNOWN_CCS } from './App'

const ASSIST_BASE = import.meta.env.VITE_ASSIST_BASE
const YEAR_ID = import.meta.env.VITE_ACADEMIC_YEAR_ID || 77

const TERMS = [
  'Fall 2025', 'Spring 2026', 'Summer 2026',
  'Fall 2026', 'Spring 2027', 'Summer 2027',
  'Fall 2027', 'Spring 2028',
]

const CAL_GETC_AREAS = [
  { code: '1A', name: 'English Composition', desc: 'One course in expository writing', slots: 1 },
  { code: '1B', name: 'Critical Thinking & Writing', desc: 'Argument and analysis', slots: 1 },
  { code: '1C', name: 'Oral Communication', desc: 'Speech or communication course', slots: 1 },
  { code: '2', name: 'Mathematical Concepts', desc: 'College-level math', slots: 1 },
  { code: '3A', name: 'Arts', desc: 'Visual art, music, film, or theatre', slots: 1 },
  { code: '3B', name: 'Humanities', desc: 'Literature, philosophy, or languages', slots: 1 },
  { code: '4', name: 'Social & Behavioral Sciences', desc: 'Three courses from different disciplines', slots: 3 },
  { code: '5A', name: 'Physical Sciences', desc: 'Chemistry, physics, or astronomy', slots: 1 },
  { code: '5B', name: 'Biological Sciences', desc: 'Biology or life sciences', slots: 1 },
  // FIX 1: Removed CC-specific "often bundled with 5A or 5B" description
  { code: '5C', name: 'Science Lab', desc: 'A lab component course', slots: 1 },
  { code: '6', name: 'Ethnic Studies', desc: 'One ethnic studies course', slots: 1 },
]

function initGeState() {
  const s = {}
  for (const a of CAL_GETC_AREAS) {
    for (let i = 0; i < a.slots; i++) {
      s[a.slots > 1 ? `${a.code}_${i}` : a.code] = false
    }
  }
  return s
}

async function assistGet(path) {
  const res = await fetch(`${ASSIST_BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ASSIST ${res.status}: ${path}`)
  const data = await res.json()
  if (!data.isSuccessful) throw new Error(data.validationFailure || 'ASSIST error')
  return data.result
}

async function getMajorsForUni(uniId, ccId) {
  try {
    for (const yearId of [77, 76, 75, 74]) {
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

function isCourseExpired(c) {
  const end = (c.end || '').trim()
  if (!end) return false
  // ASSIST end dates are like "Su2025", "F2024", "Sp2023"
  // Parse term + year and compare to current date
  const match = end.match(/^(F|Su|Sp|S|W)(\d{4})$/)
  if (!match) return false
  const [, term, yearStr] = match
  const year = parseInt(yearStr)
  const now = new Date()
  const currentYear = now.getFullYear()
  if (year < currentYear) return true
  if (year > currentYear) return false
  // Same year — check term
  const month = now.getMonth() // 0-indexed
  if (term === 'Sp' || term === 'S') return month > 4  // Spring ends ~May
  if (term === 'Su') return month > 7                  // Summer ends ~Aug
  if (term === 'F') return month > 11                  // Fall ends ~Dec
  if (term === 'W') return month > 1                   // Winter ends ~Feb
  return false
}

function extractCourse(c) {
  const prefix = (c.prefix || '').trim()
  const number = (c.courseNumber || c.number || '').trim()
  if (!prefix || !number) return null
  return {
    prefix, number,
    title: c.courseTitle || c.title || '',
    units: c.maxUnits || c.minUnits || 3,
    note: c.attributes?.[0]?.content || null,
    courseIdentifierParentId: c.courseIdentifierParentId || null,
    expired: isCourseExpired(c),
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
      // Courses within this group are alternatives — each becomes its own separate option
      for (const course of subItems) {
        const c = extractCourse(course)
        if (c) options.push({ courses: [c], groupNote: course.attributes?.[0]?.content || null })
      }
    } else {
      // Courses within this group must be taken together (AND).
      // Each top-level group is always its own separate option.
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

    let groupIsPickN = false, groupNRequired = null, groupPickType = null
    let groupPickMin = null, groupPickMax = null, isSectionBundled = false

    if (instrType === 'NFromArea' || instrType === 'NFromConjunction') {
      groupIsPickN = true; groupNRequired = instr.amount ?? 1
      const isUnitBased = ['SemesterUnit', 'QuarterUnit', 'Unit'].includes(instr.amountUnitType)
      groupPickType = isUnitBased ? 'units' : 'count'
      isSectionBundled = groupPickType === 'count' && (instr.amount ?? 1) < dataSections.length
    } else if (instrType === 'NToNFromConjunction') {
      groupIsPickN = true; groupPickMin = instr.amount ?? 1; groupPickMax = instr.toAmount ?? null
      groupNRequired = groupPickMin; groupPickType = 'range'
    } else if (instrType === 'NOrUnits' || instrType === 'NFollowing') {
      groupIsPickN = true; groupNRequired = instr.amount ?? 1; groupPickType = 'count'
    } else if (instrType === 'NFromUnits') {
      groupIsPickN = true; groupNRequired = instr.amount ?? 1; groupPickType = 'units'
    } else if (instrType === 'NToNFollowing') {
      groupIsPickN = true; groupPickMin = instr.amount ?? 1; groupPickMax = instr.toAmount ?? null
      groupNRequired = groupPickMin; groupPickType = 'range'
    } else if (instrConjunction === 'or') {
      groupIsPickN = true
      const groupNAdv = (group.advisements || []).find(a => a.type === 'NFollowing')
      groupNRequired = groupNAdv?.amount ?? 1; groupPickType = 'count'; isSectionBundled = true
    }

    for (const section of dataSections) {
      const secAdvs = section.advisements || []
      const secNFollowing = secAdvs.find(a => a.type === 'NFollowing')
      const secNFromUnits = secAdvs.find(a => a.type === 'NFromUnits')
      const secNToN = secAdvs.find(a => a.type === 'NToNFollowing')
      const secNInAreas = secAdvs.find(a => a.type === 'NInNDifferentAreas')
      const secCompleteAll = secAdvs.find(a => a.type === 'CompleteFollowing')

      let nRequired = null, pickType = null, pickMin = null, pickMax = null, groupId

      if (secCompleteAll) { nRequired = null; pickType = null; groupId = `${group.groupId}_${section.position}` }
      else if (secNFollowing) { nRequired = secNFollowing.amount ?? 1; pickType = 'count'; groupId = `${group.groupId}_${section.position}` }
      else if (secNFromUnits) { nRequired = secNFromUnits.amount ?? 1; pickType = 'units'; groupId = `${group.groupId}_${section.position}` }
      else if (secNToN) { pickMin = secNToN.minAmount ?? secNToN.amount ?? 1; pickMax = secNToN.maxAmount ?? null; nRequired = pickMin; pickType = 'range'; groupId = `${group.groupId}_${section.position}` }
      else if (secNInAreas) { nRequired = secNInAreas.amount ?? 1; pickType = 'areas'; groupId = `${group.groupId}_${section.position}` }
      else if (groupIsPickN) { nRequired = groupNRequired; pickType = groupPickType; pickMin = groupPickMin; pickMax = groupPickMax; groupId = `pick_${group.groupId}` }
      else { nRequired = null; pickType = null; groupId = `${group.groupId}_${section.position}` }

      const ctx = {
        sectionLabel, groupTitle, nRequired, pickType, pickMin, pickMax, groupId,
        isSectionBundled: groupIsPickN ? isSectionBundled : false,
        sectionPosition: section.position, groupPosition: group.position,
      }

      for (const row of section.rows || []) {
        for (const cell of row.cells || []) {
          if (cell.id) { cellMap.set(cell.id, ctx); cellMap.set(String(cell.id), ctx) }
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
  const total = group._totalOptions ?? group.rows.length
  if (total <= 1) return null
  switch (group.pickType) {
    case 'units': return `Choose courses totaling ${n} unit${n !== 1 ? 's' : ''} from these ${total} options`
    case 'range': return group.pickMax
      ? `Choose ${group.pickMin}–${group.pickMax} of these ${total} options`
      : `Choose at least ${n} of these ${total} options`
    case 'areas': return `Choose ${n} course${n !== 1 ? 's' : ''} from different areas (${total} options)`
    default:
      return group.isSectionBundled
        ? `Complete ${n === 1 ? '1' : n} of these ${total} options`
        : `Choose any ${n} of these ${total} options`
  }
}

const PREREQ_CHAINS = {
  'MATH 1B': 'MATH 1A', 'MATH 1C': 'MATH 1B', 'MATH 193': 'MATH 192',
  'MATH 292': 'MATH 193', 'MATH 194': 'MATH 193',
  'PHYS 4B': 'PHYS 4A', 'PHYS 121': 'PHYS 120', 'PHYS 130': 'MATH 192',
  'PHYS 230': 'PHYS 130', 'PHYS 231': 'PHYS 230',
  'CHEM 121': 'CHEM 120', 'CHEM 226': 'CHEM 121', 'CHEM 227': 'CHEM 226',
  'BIOL 131': 'BIOL 130', 'BIOL 140': 'BIOL 130',
}

function getPrereqKey(course) {
  const key = `${course.prefix} ${course.number}`
  return PREREQ_CHAINS[key] || null
}

function topoSortCourses(courses) {
  const byKey = {}
  courses.forEach(c => { byKey[`${c.prefix} ${c.number}`] = c })
  const visited = new Set()
  const result = []
  function visit(c) {
    const key = `${c.prefix} ${c.number}`
    if (visited.has(key)) return
    const prereqKey = getPrereqKey(c)
    if (prereqKey && byKey[prereqKey]) visit(byKey[prereqKey])
    visited.add(key)
    result.push(c)
  }
  const coverageOrder = { all: 0, multi: 1, school: 2 }
  ;[...courses].sort((a, b) => coverageOrder[a.badge] - coverageOrder[b.badge]).forEach(visit)
  return result
}

// FIX 2: Improved planner — multi-pass greedy so gaps get filled properly
function buildSemesterPlan({ rows, completedCourses, geState, plannerStart, plannerEnd, includeSummer, maxUnitsPerSem = 15 }) {
  const GE_UNIT = 3
  const MAX_AREA4_PER_SEM = 1
  rows = rows.filter(r => {
    const pe = r.programEntries?.[0]
    return !isRecommendedSection(pe?.groupTitle) && !isRecommendedSection(pe?.sectionLabel)
  })

  const termList = includeSummer ? TERMS : TERMS.filter(t => !t.startsWith('Summer'))
  const startIdx = termList.indexOf(plannerStart)
  const endIdx = termList.indexOf(plannerEnd)
  if (startIdx < 0 || endIdx <= startIdx) return []

  const pending = []
  for (const row of rows) {
    if (completedCourses.has(row.ccKey)) continue
    const badge = row.coverage >= (row.totalPrograms || 1)
      ? 'all' : row.coverage > 1 ? 'multi' : 'school'
    const primaryCourse = row.primaryCourses[0]
    if (!primaryCourse) continue
    pending.push({
      ccKey: row.ccKey,
      prefix: primaryCourse.prefix,
      number: primaryCourse.number,
      title: primaryCourse.title || '',
      units: row.primaryCourses.reduce((s, c) => s + (c.units || 3), 0),
      badge,
      coverage: row.coverage,
    })
  }

  const sorted = topoSortCourses(pending)

  const geNeeded = []
  for (const area of CAL_GETC_AREAS) {
    for (let i = 0; i < area.slots; i++) {
      const key = area.slots > 1 ? `${area.code}_${i}` : area.code
      if (!geState[key]) {
        geNeeded.push({
          areaCode: area.code,
          label: area.slots > 1
            ? `Area ${area.code} – ${area.name} (${i + 1} of ${area.slots})`
            : `Area ${area.code} – ${area.name}`,
        })
      }
    }
  }

  const UNIT_CAP = maxUnitsPerSem

  // plannerEnd is the transfer term itself — don't schedule into it.
  // Schedule only up to (but not including) that term.
  const scheduleEndIdx = endIdx - 1
  if (scheduleEndIdx < startIdx) return []

  // Build semester slots (exclusive of transfer term)
  const semSlots = []
  for (let ti = startIdx; ti <= scheduleEndIdx; ti++) {
    semSlots.push({ term: termList[ti], courses: [], ge: [], units: 0 })
  }

  const ready = new Set(
    rows.filter(r => completedCourses.has(r.ccKey))
      .flatMap(r => r.primaryCourses.map(c => `${c.prefix} ${c.number}`))
  )

  // How many GE slots to reserve per semester so they get interleaved with majors.
  // We spread remaining GE evenly across semesters, capped at 2 per sem so majors
  // still get placed. In the last semester we use whatever's left.
  const numSemSlots = semSlots.length
  const GE_PER_SEM = Math.min(2, Math.ceil(geNeeded.length / Math.max(numSemSlots, 1)))

  // Multi-pass: interleave GE and major courses each semester.
  // Each pass: reserve GE slots first, then fill remaining capacity with majors.
  let anyPlaced = true
  while (anyPlaced && (sorted.length > 0 || geNeeded.length > 0)) {
    anyPlaced = false
    for (let si = 0; si < semSlots.length; si++) {
      const sem = semSlots[si]
      const isLastSem = si === semSlots.length - 1

      // Step 1: Fill GE first — reserve space for interleaving
      // In the last semester, take all remaining GE; otherwise cap at GE_PER_SEM per pass
      const geTarget = isLastSem ? geNeeded.length : GE_PER_SEM
      const area4ThisSem = sem.ge.filter(g => g.areaCode === '4').length
      let area4Count = area4ThisSem
      let gi = 0
      let geThisSem = sem.ge.length
      while (gi < geNeeded.length && geThisSem < geTarget && sem.units + GE_UNIT <= UNIT_CAP) {
        const g = geNeeded[gi]
        if (g.areaCode === '4' && area4Count >= MAX_AREA4_PER_SEM) { gi++; continue }
        if (g.areaCode === '4') area4Count++
        sem.ge.push(geNeeded[gi])
        sem.units += GE_UNIT
        geNeeded.splice(gi, 1)
        geThisSem++
        anyPlaced = true
      }

      // Step 2: Fill remaining capacity with major courses
      let changed = true
      while (changed) {
        changed = false
        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i]
          const prereqKey = getPrereqKey(c)
          const prereqOk = !prereqKey || ready.has(prereqKey)
          if (!prereqOk) continue
          if (sem.units + c.units > UNIT_CAP) continue
          sem.courses.push(c)
          sem.units += c.units
          ready.add(`${c.prefix} ${c.number}`)
          sorted.splice(i, 1)
          changed = true
          anyPlaced = true
          break
        }
      }

      // Step 3: If there's still room after majors, fill more GE
      area4Count = sem.ge.filter(g => g.areaCode === '4').length
      gi = 0
      while (gi < geNeeded.length && sem.units + GE_UNIT <= UNIT_CAP) {
        const g = geNeeded[gi]
        if (g.areaCode === '4' && area4Count >= MAX_AREA4_PER_SEM) { gi++; continue }
        if (g.areaCode === '4') area4Count++
        sem.ge.push(geNeeded[gi])
        sem.units += GE_UNIT
        geNeeded.splice(gi, 1)
        anyPlaced = true
      }
    }
  }

  const semesters = semSlots.filter(s => s.courses.length > 0 || s.ge.length > 0)

  // Remaining courses that couldn't fit
  if (sorted.length > 0 || geNeeded.length > 0) {
    semesters.push({
      term: 'Remaining',
      courses: sorted,
      ge: geNeeded,
      units: sorted.reduce((s, c) => s + c.units, 0) + geNeeded.length * GE_UNIT,
      overflow: true,
    })
  }

  return semesters
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

  const [geState, setGeState] = useState(initGeState)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [overlapData, setOverlapData] = useState(null)
  const [expandedRow, setExpandedRow] = useState(null)
  const [completedCourses, setCompletedCourses] = useState(new Set())

  const [step, setStep] = useState(1)
  const [isWide, setIsWide] = useState(window.innerWidth > 768)
  const [showBanner, setShowBanner] = useState(() => localStorage.getItem('tab2_banner_dismissed') !== '1')

  const [plannerStart, setPlannerStart] = useState(TERMS[0])
  const [plannerEnd, setPlannerEnd] = useState(TERMS[4])
  const [includeSummer, setIncludeSummer] = useState(false)
  const [maxUnitsPerSem, setMaxUnitsPerSem] = useState(15)

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
      if (data.ge_state) setGeState(data.ge_state)
    })
  }, [])

  useEffect(() => {
    if (!selUniId || !ccId) { setMajors([]); setSelMajor(null); return }
    if (majorCache[`${selUniId}-${ccId}`]) {
      setMajors(majorCache[`${selUniId}-${ccId}`]); setSelMajor(null); return
    }
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

  async function savePlan(newCcId, newCcName, newPrograms, newGeState) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('tab2_plan').upsert({
      user_id: user.id, cc_id: newCcId, cc_name: newCcName,
      programs: newPrograms, ge_state: newGeState || geState,
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

  function toggleGeSlot(key) {
    const next = { ...geState, [key]: !geState[key] }
    setGeState(next)
    savePlan(ccId, ccName, programs, next)
  }

  async function generateOverlap() {
    if (!ccId || programs.length === 0) { setError('Select a CC and add at least one program.'); return }
    setError(''); setLoading(true); setOverlapData(null); setExpandedRow(null)
    try {
      const programArts = await Promise.all(programs.map(async prog => {
        const agreement = await getAgreement(prog.majorKey)
        const parsed = parseAllForProgram(agreement, `${prog.uniName} - ${prog.majorLabel}`)
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
              program: `${prog.uniName} - ${prog.majorLabel}`,
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
              program: `${prog.uniName} - ${prog.majorLabel}`,
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
          ...entry, coverage, totalPrograms,
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
        programLabels: programs.map(p => `${p.uniName} - ${p.majorLabel}`),
        noArticulation: Object.values(noArtMap),
      })
    } catch (e) {
      setError(`Error: ${e.message}`)
    } finally {
      setLoading(false)
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

  function geTotal() {
    return CAL_GETC_AREAS.reduce((s, a) => s + a.slots, 0)
  }
  function geDone() {
    return CAL_GETC_AREAS.reduce((s, a) => {
      for (let i = 0; i < a.slots; i++) {
        const k = a.slots > 1 ? `${a.code}_${i}` : a.code
        if (geState[k]) s++
      }
      return s
    }, 0)
  }

  function shortLabel(label) {
    const parts = label.split(' - ')
    const uni = parts[0]?.replace('UC ', '').replace('CSU ', '').replace(' State', '').replace(' University', '')
    const major = parts[1]?.split(',')[0]?.split(' ').slice(0, 2).join(' ')
    return `${uni}\n${major || ''}`
  }

  const semesterPlan = overlapData
    ? buildSemesterPlan({ rows: overlapData.rows, completedCourses, geState, plannerStart, plannerEnd, includeSummer, maxUnitsPerSem })
    : []

  const realSems = semesterPlan.filter(s => !s.overflow)
  const overflowSem = semesterPlan.find(s => s.overflow)
  const summary = computeAttainability()

  // ─── STEP 1: Setup ────────────────────────────────────────────────────────
  function renderStep1() {
    return (
      <>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Add your target programs and we'll show you which courses at your CC satisfy the most requirements across all of them.
        </div>

        <div className="card">
          <div className="section-label" style={{ marginBottom: 10 }}>Step 1 — Your community college</div>
          <div className="field" style={{ marginBottom: 0 }}>
            <select value={ccId} onChange={e => {
              const newCcId = e.target.value
              const newCcName = e.target.selectedOptions[0]?.text || ''
              setCcId(newCcId); setCcName(newCcName); setPrograms([])
              setSelUniId(''); setMajors([]); setGeState(initGeState())
              savePlan(newCcId, newCcName, [], initGeState())
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
                  <div key={i} style={{ background: 'var(--bg-chip-selected)', border: '1px solid var(--border-chip-selected)', borderRadius: 20, padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>{p.uniName}</span>
                    <span style={{ color: 'var(--text-muted)' }}>— {p.majorLabel}</span>
                    <span onClick={() => removeProgram(i)} style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>×</span>
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
            <div className="section-label" style={{ marginBottom: 10 }}>Step 3 — Set your transfer timeline</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Starting term</div>
                <select value={plannerStart} onChange={e => setPlannerStart(e.target.value)} style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
                  {TERMS.slice(0, -1).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 14 }}>→</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Transfer term</div>
                <select value={plannerEnd} onChange={e => setPlannerEnd(e.target.value)} style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
                  {TERMS.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, background: 'var(--bg-step)', borderRadius: 6, padding: '7px 10px' }}>
              Classes will be scheduled up to the semester <em>before</em> your transfer term — since you'll be starting at the university that semester, not taking CC classes.
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Max units per semester</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range" min={9} max={25} step={1} value={maxUnitsPerSem}
                  onChange={e => setMaxUnitsPerSem(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#6C5CE7' }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 28 }}>{maxUnitsPerSem}u</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div onClick={() => setIncludeSummer(v => !v)} style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0, background: includeSummer ? '#6C5CE7' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: includeSummer ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setIncludeSummer(v => !v)}>Include summer</span>
            </div>
            <button className="btn-primary" onClick={async () => {
              await generateOverlap()
              setStep(2)
            }} disabled={loading}>
              {loading ? 'Loading...' : 'View my courses →'}
            </button>
          </div>
        )}
      </>
    )
  }

  // ─── STEP 2: Major courses ────────────────────────────────────────────────
  function renderStep2() {
    // FIX 3: Only count required (non-recommended) rows for the progress counters
    const allRequired = overlapData.rows.filter(r => {
      const pe = r.programEntries[0]
      return !isRecommendedSection(pe?.groupTitle) && !isRecommendedSection(pe?.sectionLabel)
    })
    const requiredDone = allRequired.filter(r => completedCourses.has(r.ccKey)).length

    return (
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Major requirements</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{ccName} · {programs.map(p => `${p.uniName} – ${p.majorLabel}`).join(' / ')}</div>
          </div>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => { setOverlapData(null); setStep(1); setCompletedCourses(new Set()) }}>← Edit</button>
        </div>

        {/* Progress bar */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Required courses checked off</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{requiredDone} / {allRequired.length}</span>
          </div>
          <div style={{ background: 'var(--progress-track)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{ background: '#6C5CE7', height: '100%', width: `${allRequired.length === 0 ? 0 : Math.round((requiredDone / allRequired.length) * 100)}%`, borderRadius: 4, transition: 'width 0.3s ease' }} />
          </div>
        </div>

        {/* FIX 4: Compact banner — single-column list, no nested grid */}
        {showBanner && (
          <div style={{ background: 'var(--bg-hint)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>How to read this</div>
              <button onClick={() => { setShowBanner(false); localStorage.setItem('tab2_banner_dismissed', '1') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { icon: <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />, text: <><strong style={{ color: 'var(--text)' }}>Purple dot</strong> — program requires this course</> },
                { icon: <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #4a4a6a', display: 'inline-block' }} />, text: <><strong style={{ color: 'var(--text)' }}>Empty dot</strong> — not required by that program</> },
                { icon: <span style={{ fontSize: 9, background: 'var(--bg-chip-selected)', color: '#a78bfa', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>, text: 'Counts toward every program — take first' },
                { icon: <span style={{ fontSize: 9, background: '#0d2a28', color: '#34d399', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>, text: 'Counts toward more than one program' },
                { icon: <span style={{ fontSize: 9, background: '#0d1a2e', color: '#60a5fa', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>SCHOOL-SPECIFIC</span>, text: 'Only counts toward one program' },
                { icon: <span style={{ fontSize: 9, background: '#221a05', color: '#fbbf24', border: '1px solid #5a4a10', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>CHOOSE 1</span>, text: 'Yellow group — pick one option, not all' },
                { icon: <span style={{ fontSize: 9, background: '#2a1010', color: '#f87171', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>No equivalent</span>, text: 'No matching course at your CC' },
              ].map(({ icon, text }, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', flexShrink: 0, minWidth: 80, justifyContent: 'flex-end' }}>{icon}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {renderCourseList()}

        {/* Bottom CTA */}
        <div style={{ marginTop: 32, padding: '20px 0', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {requiredDone < allRequired.length && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              You've checked off {requiredDone} of {allRequired.length} required courses. Check off any you've already completed before continuing.
            </div>
          )}
          <button className="btn-primary" style={{ minWidth: 240 }} onClick={() => setStep(3)}>
            Move to GE requirements →
          </button>
        </div>
      </div>
    )
  }

  // ─── STEP 3: GE Checklist ─────────────────────────────────────────────────
  function renderStep3() {
    const done = geDone()
    const total = geTotal()

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Cal-GETC requirements</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Check off any areas you've already satisfied</div>
          </div>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setStep(2)}>← Back</button>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Areas completed</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{done} / {total}</span>
          </div>
          <div style={{ background: 'var(--progress-track)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{ background: done === total ? '#4ade80' : '#a78bfa', height: '100%', width: `${Math.round((done / total) * 100)}%`, borderRadius: 4, transition: 'width 0.3s ease' }} />
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Check off areas you've already completed through AP credit, IB exams, dual enrollment, or courses at another school. If a major course you checked off also satisfies a GE area, check that area here too.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CAL_GETC_AREAS.map(area => {
            const isMulti = area.slots > 1
            const slotKeys = Array.from({ length: area.slots }, (_, i) =>
              isMulti ? `${area.code}_${i}` : area.code
            )
            const slotsDone = slotKeys.filter(k => geState[k]).length

            return (
              <div key={area.code} style={{ background: 'var(--bg-card)', border: `1px solid ${slotsDone === area.slots ? '#4a3a7a' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px', transition: 'border-color 0.2s' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, background: slotsDone === area.slots ? '#4a3a7a' : 'var(--bg-step)', color: slotsDone === area.slots ? '#a78bfa' : 'var(--text-muted)', borderRadius: 4, padding: '2px 7px' }}>
                        Area {area.code}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{area.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{area.desc}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    {slotKeys.map((k, i) => (
                      <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <div
                          onClick={() => toggleGeSlot(k)}
                          style={{
                            width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                            border: `2px solid ${geState[k] ? '#6C5CE7' : 'var(--border-input)'}`,
                            background: geState[k] ? '#6C5CE7' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          {geState[k] && <span style={{ color: '#fff', fontSize: 12, lineHeight: 1 }}>✓</span>}
                        </div>
                        {isMulti && (
                          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{i + 1}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 32, padding: '20px 0', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {done < total && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              {total - done} GE area{total - done !== 1 ? 's' : ''} unchecked — these will be added to your semester plan.
            </div>
          )}
          {done === total && (
            <div style={{ fontSize: 12, color: '#4ade80', textAlign: 'center', fontWeight: 600 }}>
              All GE areas complete — your semester plan will only include major courses.
            </div>
          )}
          <button className="btn-primary" style={{ minWidth: 240 }} onClick={() => setStep(4)}>
            View my semester plan →
          </button>
        </div>
      </div>
    )
  }

  // ─── STEP 4: Semester Plan ────────────────────────────────────────────────
  function renderStep4() {
    // FIX 5: majorLeft only counts required (non-recommended) rows not yet completed
    const requiredRows = overlapData.rows.filter(r => {
      const pe = r.programEntries?.[0]
      return !isRecommendedSection(pe?.groupTitle) && !isRecommendedSection(pe?.sectionLabel)
    })
    const majorLeft = requiredRows.filter(r => !completedCourses.has(r.ccKey)).length
    const geLeft = geTotal() - geDone()

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Semester plan</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {plannerStart} → transferring {plannerEnd}{includeSummer ? ' (with summers)' : ''}
            </div>
          </div>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setStep(3)}>← Back</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {[
            { label: 'Semesters', value: realSems.length },
            { label: 'Major courses left', value: majorLeft },
            { label: 'GE areas left', value: geLeft },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--bg-step)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
            </div>
          ))}
        </div>

        {overflowSem && (
          <div style={{ background: '#1a1505', border: '1px solid #5a4a10', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>
                {overflowSem.courses.length + overflowSem.ge.length} course{overflowSem.courses.length + overflowSem.ge.length !== 1 ? 's' : ''} couldn't fit in your timeline
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Consider{!includeSummer ? ' toggling summer semesters on,' : ''} raising your max units above {maxUnitsPerSem}u, pushing your transfer term past {plannerEnd}, or checking off courses you've already completed.
              </div>
              <button
                onClick={() => setStep(1)}
                style={{ marginTop: 8, fontSize: 11, color: '#fbbf24', background: 'none', border: '1px solid #5a4a10', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
              >
                Adjust timeline
              </button>
            </div>
          </div>
        )}

        {semesterPlan.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
            You're all set — no courses left to schedule!
          </div>
        )}

        {realSems.map((sem, si) => {
          const totalU = sem.courses.reduce((s, c) => s + c.units, 0) + sem.ge.length * 3
          return (
            <div key={si} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', background: 'var(--bg-step)', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{sem.term}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sem.courses.length} major · {sem.ge.length} GE · {Math.round(totalU)}u</div>
                </div>
              </div>
              {sem.courses.map((c, ci) => (
                <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div
                    onClick={() => toggleCourse(c.ccKey)}
                    style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer', border: `2px solid ${completedCourses.has(c.ccKey) ? '#6C5CE7' : 'var(--border-input)'}`, background: completedCourses.has(c.ccKey) ? '#6C5CE7' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {completedCourses.has(c.ccKey) && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, opacity: completedCourses.has(c.ccKey) ? 0.45 : 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textDecoration: completedCourses.has(c.ccKey) ? 'line-through' : 'none', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {c.prefix} {c.number}
                    </div>
                    {c.title && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.title}</div>}
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4, flexShrink: 0, background: c.badge === 'all' ? 'var(--bg-chip-selected)' : c.badge === 'multi' ? '#0d2a28' : '#0d1a2e', color: c.badge === 'all' ? '#a78bfa' : c.badge === 'multi' ? '#34d399' : '#60a5fa' }}>
                    {c.badge === 'all' ? 'ALL' : c.badge === 'multi' ? 'MULTI' : 'SCHOOL'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.units}u</span>
                </div>
              ))}
              {sem.ge.map((g, gi) => (
                <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: '1px dashed var(--border)', opacity: 0.6 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px dashed var(--border-input)', flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{g.label}</div>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: 'var(--bg-step)', color: 'var(--text-muted)' }}>Cal-GETC</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>3u</span>
                </div>
              ))}
            </div>
          )
        })}

        {overflowSem && (overflowSem.courses.length > 0 || overflowSem.ge.length > 0) && (
          <div style={{ border: '1px dashed #5a4a10', borderRadius: 10, marginBottom: 10, overflow: 'hidden', background: '#1a1505' }}>
            <div style={{ padding: '9px 14px', borderBottom: '1px dashed #5a4a10' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24' }}>Couldn't complete before transferring {plannerEnd}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{overflowSem.courses.length} major · {overflowSem.ge.length} GE</div>
            </div>
            {overflowSem.courses.map((c, ci) => (
              <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #2a1a05' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24' }}>{c.prefix} {c.number}</div>
                  {c.title && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.title}</div>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.units}u</span>
              </div>
            ))}
            {overflowSem.ge.map((g, gi) => (
              <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: '1px dashed #2a1a05', opacity: 0.6 }}>
                <div style={{ flex: 1, fontSize: 12, color: '#fbbf24' }}>{g.label}</div>
                <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: '#2a1a05', color: '#fbbf24' }}>Cal-GETC</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── COURSE LIST (used in step 2) ─────────────────────────────────────────
  function renderCourseList() {
    const groups = []
    const groupIdToGroup = {}
    const noArtByGroupId = {}
    const noArtByGroupIdFlat = {}
    const inlineRequiredNoArt = []

    // Which groupIds have at least one articulated CC course (i.e. appear in overlapData.rows)
    const articulatedGroupIds = new Set(overlapData.rows.map(r => r.groupId).filter(Boolean))

    for (const na of (overlapData.noArticulation || [])) {
      if (na.partOfPickGroup) {
        if (!noArtByGroupId[na.groupId]) noArtByGroupId[na.groupId] = {}
        // If this group has articulated siblings, each unarticulated course is its own OR option.
        // If the entire group is unarticulated (e.g. POLI 5 + POLI 30 both have no CC equivalent),
        // bundle by sectionPosition so they show as one combined slot.
        const hasArticulatedSibling = articulatedGroupIds.has(na.groupId)
        const secKey = hasArticulatedSibling
          ? `${na.uniReq.prefix}_${na.uniReq.number}`
          : `sec_${na.sectionPosition ?? 'unknown'}`
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
        const g = { groupId, groupTitle: row.groupTitle || 'MAJOR REQUIREMENTS', sectionLabel: row.sectionLabel || '', nRequired: row.nRequired ?? null, pickType: row.pickType ?? null, pickMin: row.pickMin ?? null, pickMax: row.pickMax ?? null, isSectionBundled: row.isSectionBundled || false, rows: [] }
        groupIdToGroup[groupId] = g
        groups.push(g)
      }
      groupIdToGroup[groupId].rows.push(row)
    }

    // FIX 6: Sort rows within each group: ALL > MULTIPLE > SCHOOL-SPECIFIC
    for (const g of Object.values(groupIdToGroup)) {
      const coverageOrder = (row) => {
        if (row.coverage >= (row.totalPrograms || 1)) return 0 // all
        if (row.coverage > 1) return 1 // multi
        return 2 // school-specific
      }
      g.rows.sort((a, b) => coverageOrder(a) - coverageOrder(b))
    }

    for (const na of inlineRequiredNoArt) {
      const groupId = na.groupId ?? `noart_${na.uniReq.prefix}_${na.uniReq.number}`
      if (!groupIdToGroup[groupId]) {
        const g = { groupId, groupTitle: na.groupTitle || 'MAJOR REQUIREMENTS', sectionLabel: na.sectionLabel || '', nRequired: null, pickType: null, pickMin: null, pickMax: null, isSectionBundled: false, rows: [], noArtRows: [], _groupPosition: na.groupPosition ?? 999, _sectionPosition: na.sectionPosition ?? 999 }
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
    const renderedNoArtKeys = new Set()

    for (const group of groups) {
      const isPickN = group.nRequired !== null
      const noArtSiblingSlots = Object.keys(noArtByGroupId[group.groupId] || {}).length
      const noArtSiblingsFlat = (noArtByGroupIdFlat[group.groupId] || []).length
      const isEffectivelyRequired = isPickN && group.rows.length <= 1 && noArtSiblingSlots === 0 && noArtSiblingsFlat === 0
      const displayLabel = group.sectionLabel || group.groupTitle || 'REQUIREMENTS'
      const totalPickOptions = group.rows.length + noArtSiblingSlots
      const groupLabel = isPickN
        ? pickGroupLabel({ ...group, _totalOptions: totalPickOptions })
        : null

      if (displayLabel !== lastDisplayLabel) {
        lastDisplayLabel = displayLabel
        rendered.push(
          <div key={`sec-${displayLabel}-${group.groupId}`} style={{ marginTop: rendered.length === 0 ? 0 : 32, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{displayLabel}</div>
          </div>
        )
      }

      const renderCourseRow = (row, rowIdx, inPickGroup = false) => {
        const isDone = completedCourses.has(row.ccKey)
        const isExpanded = expandedRow === row.ccKey
        const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
        const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
        const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
        const coverageAll = row.coverage === overlapData.totalPrograms
        const coverageMost = row.coverage > 1 && !coverageAll
        const hasExpired = row.primaryCourses.some(c => c.expired)

        return (
          <div key={row.ccKey}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
              <div
                onClick={() => toggleCourse(row.ccKey)}
                style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, cursor: 'pointer', border: `2px solid ${isDone ? (inPickGroup ? '#fbbf24' : '#6C5CE7') : 'var(--border-input)'}`, background: isDone ? (inPickGroup ? '#fbbf24' : '#6C5CE7') : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
              >
                {isDone && <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }} onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)}>
                <div style={{ fontWeight: 600, fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--text-muted)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {label}
                  {coverageAll && <span style={{ fontSize: 10, background: 'var(--bg-chip-selected)', color: '#a78bfa', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>ALL PROGRAMS</span>}
                  {coverageMost && <span style={{ fontSize: 10, background: '#0d2a28', color: '#34d399', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                  {row.coverage === 1 && overlapData.totalPrograms > 1 && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 600, background: '#0d1a2e', color: '#60a5fa' }}>SCHOOL-SPECIFIC</span>}
                  {hasExpired && <span style={{ fontSize: 10, background: '#1a1200', color: '#f59e0b', border: '1px solid #5a4a00', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>⚠ Verify with counselor</span>}
                </div>
                {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={() => setExpandedRow(isExpanded ? null : row.ccKey)}>
                {overlapData.programLabels.map((progLabel, pi) => {
                  const has = row.programEntries.some(pe => pe.program === progLabel)
                  return (
                    <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      {overlapData.programLabels.length > 1 && <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 48, lineHeight: 1.2 }}>{shortLabel(progLabel).split('\n')[0]}</div>}
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: has ? '#a78bfa' : 'transparent', border: has ? 'none' : '2px solid #4a4a6a', display: 'inline-block' }} />
                    </div>
                  )
                })}
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</div>
              </div>
            </div>
            {isExpanded && renderExpandedRow(row, isEffectivelyRequired)}
          </div>
        )
      }

      if (isPickN && !isEffectivelyRequired && (groupLabel || noArtSiblingSlots > 0)) {
        rendered.push(
          <div key={`group-${group.groupId}`} style={{ border: '1.5px solid #5a4a10', borderRadius: 10, marginBottom: 12, overflow: 'hidden', background: '#1a1505' }}>
            <div style={{ padding: '9px 14px', borderBottom: '1px solid #5a4a10', background: '#221a05' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>{groupLabel}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>— you don't need all of them</span>
              </div>
            </div>
            {[...group.rows, ...Object.values(noArtByGroupId[group.groupId] || {}).map(slot => ({ _isNoArt: true, slot }))].map((rowOrNa, rowIdx) => {
              if (rowOrNa._isNoArt) {
                const { slot } = rowOrNa
                const label = slot.courses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                const subtitle = slot.courses.map(c => c.title).filter(Boolean).join(' + ')
                const units = slot.courses.reduce((sum, c) => sum + (c.units || 0), 0)
                return (
                  <div key={`noart-${label}`} style={{ borderTop: '1px dashed #5a2020', background: '#1a0a0a' }}>
                    <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#5a4a10', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                      <span style={{ color: '#f87171', fontSize: 14, flexShrink: 0 }}>✕</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {label}
                          <span style={{ fontSize: 10, background: '#2a1010', color: '#f87171', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>No equivalent at {ccName}</span>
                        </div>
                        {subtitle && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{subtitle}{units ? ` — ${units} units` : ''}</div>}
                        {slot.reason && <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>{slot.reason}</div>}
                      </div>
                    </div>
                  </div>
                )
              }
              const row = rowOrNa
              const isDone = completedCourses.has(row.ccKey)
              return (
                <div key={row.ccKey} style={{ borderTop: rowIdx > 0 ? '1px dashed #3a3010' : 'none', background: isDone ? '#141208' : '#1a1505', opacity: isDone ? 0.6 : 1 }}>
                  {rowIdx > 0 && <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#5a4a10', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>}
                  {renderCourseRow(row, rowIdx, true)}
                </div>
              )
            })}
          </div>
        )
      } else {
        const effectiveNoArtRows = isEffectivelyRequired ? (noArtByGroupIdFlat[group.groupId] || []) : (group.noArtRows || [])
        group.rows.forEach(row => {
          const isDone = completedCourses.has(row.ccKey)
          rendered.push(
            <div key={row.ccKey} style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, background: isDone ? 'var(--bg-step)' : 'var(--bg-card)', opacity: isDone ? 0.55 : 1, overflow: 'hidden' }}>
              {renderCourseRow(row, 0, false)}
            </div>
          )
        })
        effectiveNoArtRows.forEach(na => {
          const naInlineKey = `${na.uniReq.prefix}|${na.uniReq.number}|${na.program}`
          renderedNoArtKeys.add(naInlineKey)
          rendered.push(
            <div key={`noart-inline-${na.uniReq.prefix}-${na.uniReq.number}-${na.program}`} style={{ border: '1px solid #5a2020', borderRadius: 8, marginBottom: 6, background: '#1a0a0a', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ color: '#f87171', fontSize: 14, flexShrink: 0 }}>✕</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {na.uniReq.prefix} {na.uniReq.number}
                    {na.uniReq.title && <span style={{ fontWeight: 400, color: '#f87171' }}>— {na.uniReq.title}</span>}
                  </div>
                  {na.uniReq.units && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{na.uniReq.units} units · {na.program}</div>}
                  {na.reason && <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>{na.reason}</div>}
                </div>
                <span style={{ fontSize: 11, background: '#2a1010', color: '#f87171', borderRadius: 4, padding: '2px 8px', fontWeight: 600, flexShrink: 0 }}>No equivalent at {ccName}</span>
              </div>
            </div>
          )
        })
      }
    }

    return rendered
  }

  // ─── EXPANDED ROW ─────────────────────────────────────────────────────────
  function renderExpandedRow(row, isEffectivelyRequired = false) {
    return (
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-step)', padding: '12px 14px 14px 42px' }}>
        {isEffectivelyRequired && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-input)', borderRadius: 6, padding: '7px 10px', marginBottom: 12 }}>
            The university offers multiple ways to satisfy this requirement, but this is the only one with an equivalent at {ccName}.
          </div>
        )}
        {row.programEntries.map((pe, i) => (
          <div key={i} style={{ marginBottom: i < row.programEntries.length - 1 ? 14 : 0, paddingBottom: i < row.programEntries.length - 1 ? 14 : 0, borderBottom: i < row.programEntries.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{pe.program}</div>
            {(() => {
              const isRec = isRecommendedSection(pe.groupTitle) || isRecommendedSection(pe.sectionLabel)
              return (
                <div style={{ fontSize: 11, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: isRec ? '#2a2010' : '#0d2a1a', borderRadius: 4, padding: '2px 8px', color: isRec ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>
                  {isRec ? 'Recommended by this program' : 'Required by this program'}
                </div>
              )
            })()}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Satisfies: <span style={{ fontWeight: 500, color: 'var(--text)' }}>{pe.uniReq.prefix} {pe.uniReq.number} — {pe.uniReq.title}</span>
              {pe.uniReq.units ? ` (${pe.uniReq.units} uni units)` : ''}
            </div>
            {pe.uniReq.allCourseLabels?.length > 1 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Also counts toward: {pe.uniReq.allCourseLabels.slice(1).join(', ')}</div>
            )}
            {pe.options.map((opt, j) => (
              <div key={j}>
                {j > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0', borderTop: '1px dashed var(--border)', marginTop: 6, marginBottom: 2 }}>or instead:</div>}
                {opt.courses.length > 1 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Take all together</div>}
                {opt.groupNote && <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Note: {opt.groupNote}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {opt.courses.map((c, k) => (
                    <div key={k} style={{ background: c.expired ? '#1a1200' : 'var(--bg-input)', border: c.expired ? '1px solid #5a4a00' : 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: c.expired ? '#f59e0b' : '#a78bfa' }}>{c.prefix} {c.number}</span>
                      {c.title && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{c.title}</span>}
                      {c.units && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{c.units}u</span>}
                      {c.expired && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4, fontWeight: 600 }}>⚠ May no longer be offered — verify with your counselor</div>}
                      {c.note && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>Note: {c.note}</div>}
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

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {loading && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="status"><div className="spinner" />Loading your courses...</div>
        </div>
      )}
      {!loading && step === 1 && renderStep1()}
      {!loading && step === 2 && overlapData && renderStep2()}
      {!loading && step === 3 && overlapData && renderStep3()}
      {!loading && step === 4 && overlapData && renderStep4()}
    </div>
  )
}

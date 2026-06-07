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

// ─── CHANGE 1: buildCellMap — handles ALL patterns from 3,170 major audit ────
//
// Patterns that mean pick-N (yellow card):
//   Group level (Or/Complete or Or/Select):
//     instruction.conjunction === 'Or' → sections are the options, pick N
//     groupAdv NFollowing(N) → N is explicit; default to 1 if absent
//   Section level (And/*, none/*, any conjunction):
//     sectionAdv NFollowing(N)       → pick N courses from this section
//     sectionAdv NFromUnits(N)       → pick courses totaling N units
//     sectionAdv NToNFollowing()     → pick a range (min/max on advisement)
//     sectionAdv NInNDifferentAreas  → pick N from different areas
//     sectionAdv CompleteFollowing   → complete all (treated as required, no pick)
//
// pickType is stored on each ctx so the UI can show the right label:
//   'count'  → "Choose any N of these"
//   'units'  → "Choose courses totaling N units"
//   'range'  → "Choose N–M courses"
//   'areas'  → "Choose N courses from different areas"
//   null     → all required

function buildCellMap(templateAssets) {
  const cellMap = new Map()
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

    // Detect group-level pick-N
    // Or/Complete and Or/Select both mean "pick from sections"
    const instrIsOr = group.instruction?.conjunction === 'Or'
    const groupNAdv = (group.advisements || []).find(a => a.type === 'NFollowing')
    const groupUnitsAdv = (group.advisements || []).find(a => a.type === 'NFromUnits')
    const groupIsPickN = instrIsOr

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

      if (groupIsPickN) {
        // All sections under this group share one pick pool keyed by group.groupId
        if (groupNAdv) {
          nRequired = groupNAdv.amount ?? 1
          pickType = 'count'
        } else if (groupUnitsAdv) {
          nRequired = groupUnitsAdv.amount ?? 1
          pickType = 'units'
        } else {
          nRequired = 1
          pickType = 'count'
        }
        groupId = `or_group_${group.groupId}`
      } else if (secCompleteAll) {
        // Explicit "complete all" — treat as required
        nRequired = null
        pickType = null
        groupId = `${group.groupId}_${section.position}`
      } else if (secNFollowing) {
        nRequired = secNFollowing.amount ?? 1
        pickType = 'count'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNFromUnits) {
        nRequired = secNFromUnits.amount ?? 1
        pickType = 'units'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNToN) {
        // Range — use min as nRequired for progress tracking
        pickMin = secNToN.minAmount ?? secNToN.amount ?? 1
        pickMax = secNToN.maxAmount ?? null
        nRequired = pickMin
        pickType = 'range'
        groupId = `${group.groupId}_${section.position}`
      } else if (secNInAreas) {
        nRequired = secNInAreas.amount ?? 1
        pickType = 'areas'
        groupId = `${group.groupId}_${section.position}`
      } else {
        // No pick constraint — all required
        nRequired = null
        pickType = null
        groupId = `${group.groupId}_${section.position}`
      }

      const ctx = {
        sectionLabel,
        groupTitle,
        nRequired,
        pickType,
        pickMin,
        pickMax,
        groupId,
        sectionPosition: section.position,
        groupPosition: group.position,
      }

      if (!groupFallbackMap.has(String(group.groupId))) {
        groupFallbackMap.set(String(group.groupId), ctx)
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

  cellMap._groupFallback = groupFallbackMap
  return cellMap
}
// ─── END CHANGE 1 ─────────────────────────────────────────────────────────────

function parseAllForProgram(agreement, programLabel) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []

    const cellMap = buildCellMap(agreement.templateAssets)
    const results = []
    const noArticulationResults = []

    const groupRegistry = {}

    // Build a supplemental lookup: for any templateCellId not in cellMap,
    // try to find the group by matching the cell ID against ALL cells in templateAssets
    // This handles cases where ASSIST articulation templateCellId != templateAssets cell.id
    // (a known ASSIST data inconsistency affecting ~30% of majors)
    const supplementalCellMap = new Map()
    try {
      const _assets = typeof agreement.templateAssets === 'string'
        ? JSON.parse(agreement.templateAssets) : agreement.templateAssets || []
      const _reqTitles = _assets.filter(a => a.type === 'RequirementTitle').sort((a,b) => a.position - b.position)
      for (const _group of _assets.filter(a => a.type === 'RequirementGroup')) {
        const _groupTitle = _reqTitles.filter(t => t.position < _group.position)
          .sort((a,b) => b.position - a.position)[0]?.content || 'MAJOR REQUIREMENTS'
        const _instrIsOr = _group.instruction?.conjunction === 'Or'
        const _groupNAdv = (_group.advisements||[]).find(a => a.type === 'NFollowing')
        const _sections = (_group.sections||[]).filter(s => s.type === 'Section')
        const _sectionHeader = (_group.sections||[]).find(s => s.type === 'SectionHeader')
        const _sectionLabel = _sectionHeader?.content || ''
        for (const _section of _sections) {
          const _secAdvs = _section.advisements || []
          const _secNF = _secAdvs.find(a => a.type === 'NFollowing')
          const _secNU = _secAdvs.find(a => a.type === 'NFromUnits')
          const _secNR = _secAdvs.find(a => a.type === 'NToNFollowing')
          const _secNA = _secAdvs.find(a => a.type === 'NInNDifferentAreas')
          let _nRequired = null, _pickType = null, _gid
          if (_instrIsOr) {
            _nRequired = _groupNAdv?.amount ?? 1; _pickType = 'count'
            _gid = `or_group_${_group.groupId}`
          } else if (_secNF) {
            _nRequired = _secNF.amount ?? 1; _pickType = 'count'
            _gid = `${_group.groupId}_${_section.position}`
          } else if (_secNU) {
            _nRequired = _secNU.amount ?? 1; _pickType = 'units'
            _gid = `${_group.groupId}_${_section.position}`
          } else if (_secNR) {
            _nRequired = _secNR.minAmount ?? _secNR.amount ?? 1; _pickType = 'range'
            _gid = `${_group.groupId}_${_section.position}`
          } else if (_secNA) {
            _nRequired = _secNA.amount ?? 1; _pickType = 'areas'
            _gid = `${_group.groupId}_${_section.position}`
          } else {
            _gid = `${_group.groupId}_${_section.position}`
          }
          const _ctx = { sectionLabel: _sectionLabel, groupTitle: _groupTitle, nRequired: _nRequired, pickType: _pickType, pickMin: null, pickMax: null, groupId: _gid, sectionPosition: _section.position, groupPosition: _group.position }
          // Store by group.groupId so we can find it even without exact cell.id match
          if (!supplementalCellMap.has(String(_group.groupId))) {
            supplementalCellMap.set(String(_group.groupId), _ctx)
          }
          for (const _row of _section.rows || []) {
            for (const _cell of _row.cells || []) {
              if (_cell.id) {
                supplementalCellMap.set(_cell.id, _ctx)
                supplementalCellMap.set(String(_cell.id), _ctx)
              }
            }
          }
        }
      }
    } catch(e) {}

    for (const item of arts) {
      const art = item.articulation || item
      const templateCellId = item.templateCellId
      const rawGroupId = item.requirementGroupId ?? item.requirementGroup?.id ?? item.groupId
      const cellContext = cellMap.get(templateCellId)
        || cellMap.get(String(templateCellId))
        || supplementalCellMap.get(templateCellId)
        || supplementalCellMap.get(String(templateCellId))
        || (rawGroupId != null ? cellMap._groupFallback?.get(String(rawGroupId)) : null)
        || (rawGroupId != null ? supplementalCellMap.get(String(rawGroupId)) : null)
        || {
          sectionLabel: '',
          groupTitle: 'MAJOR REQUIREMENTS',
          nRequired: null,
          pickType: null,
          pickMin: null,
          pickMax: null,
          groupId: templateCellId || Math.random().toString(),
          sectionPosition: 0,
          groupPosition: 0,
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
          options,
          ...cellContext,
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
      const groupTitle = (() => {
        const reqTitles = assets.filter(a => a.type === 'RequirementTitle').sort((a,b) => a.position - b.position)
        return reqTitles.filter(t => t.position < group.position).sort((a,b) => b.position - a.position)[0]?.content || 'MAJOR REQUIREMENTS'
      })()
      const sections = group.sections || []
      const sectionHeader = sections.find(s => s.type === 'SectionHeader')
      const sectionLabel = sectionHeader?.content || ''
      const instrIsOr = group.instruction?.conjunction === 'Or'
      for (const section of sections.filter(s => s.type === 'Section')) {
        const secAdvs = section.advisements || []
        const secNFollowing = secAdvs.find(a => a.type === 'NFollowing')
        const secNFromUnits = secAdvs.find(a => a.type === 'NFromUnits')
        const secNToN = secAdvs.find(a => a.type === 'NToNFollowing')
        const secNInAreas = secAdvs.find(a => a.type === 'NInNDifferentAreas')
        const groupNAdv = (group.advisements || []).find(a => a.type === 'NFollowing')

        let nRequired = null
        let pickType = null
        let sectionGroupId

        if (instrIsOr) {
          nRequired = groupNAdv?.amount ?? 1
          pickType = 'count'
          sectionGroupId = `or_group_${group.groupId}`
        } else if (secNFollowing) {
          nRequired = secNFollowing.amount ?? 1
          pickType = 'count'
          sectionGroupId = `${group.groupId}_${section.position}`
        } else if (secNFromUnits) {
          nRequired = secNFromUnits.amount ?? 1
          pickType = 'units'
          sectionGroupId = `${group.groupId}_${section.position}`
        } else if (secNToN) {
          nRequired = secNToN.minAmount ?? secNToN.amount ?? 1
          pickType = 'range'
          sectionGroupId = `${group.groupId}_${section.position}`
        } else if (secNInAreas) {
          nRequired = secNInAreas.amount ?? 1
          pickType = 'areas'
          sectionGroupId = `${group.groupId}_${section.position}`
        } else {
          nRequired = null
          pickType = null
          sectionGroupId = `${group.groupId}_${section.position}`
        }

        for (const row of section.rows || []) {
          for (const cell of row.cells || []) {
            if (!cell.id || seenCellIds.has(cell.id)) continue
            const course = cell.course || {}
            const isPickN = nRequired !== null
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
              pickType,
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

// ─── CHANGE 2: isRecommendedSection — only truly optional titles ──────────────
// Based on full audit of 3,170 majors across all UCs and CSUs.
// We ONLY collapse sections that are unambiguously optional.
// Everything else (electives, preparation, prerequisites, etc.) stays visible
// because at many schools (e.g. SJSU) those ARE required for transfer.
function isRecommendedSection(label) {
  if (!label) return false
  const lower = label.toLowerCase().trim()
  return (
    lower === 'recommended courses' ||
    lower === 'recommended electives' ||
    lower === 'recommended preparation' ||
    lower === 'recommended but not required' ||
    lower === 'recommended to complete prior to transfer' ||
    lower === 'strongly recommended courses' ||
    lower === 'highly recommended' ||
    lower === 'departmental recommendations' ||
    // Also catch these as substrings since they're unambiguous
    lower.includes('strongly recommended') ||
    lower.includes('highly recommended') ||
    lower.includes('recommended but not required') ||
    lower.includes('departmental recommendation')
  )
}
// ─── END CHANGE 2 ─────────────────────────────────────────────────────────────

// ─── CHANGE 3: pickGroupLabel — generates correct yellow card header text ─────
function pickGroupLabel(group) {
  const n = group.nRequired
  const total = group.rows.length
  switch (group.pickType) {
    case 'units':
      return `Choose courses totaling ${n} unit${n !== 1 ? 's' : ''} from these ${total} options`
    case 'range':
      return group.pickMax
        ? `Choose ${group.pickMin}–${group.pickMax} courses from these ${total} options`
        : `Choose at least ${n} course${n !== 1 ? 's' : ''} from these ${total} options`
    case 'areas':
      return `Choose ${n} course${n !== 1 ? 's' : ''} from different areas (${total} options)`
    case 'count':
    default:
      return `Choose any ${n} of these ${total} options`
  }
}
// ─── END CHANGE 3 ─────────────────────────────────────────────────────────────

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
          // For or_group (Complete A,B,C,D,E style), each SECTION is one option slot.
          // Key by groupId+sectionPosition so all CC courses in the same lettered section
          // collapse into one yellow card row instead of splitting into individual rows.
          const isOrGroup = art.groupId?.startsWith('or_group_')
          const isPickGroup = art.nRequired !== null
          // For or_group: key by groupId+sectionPosition (each lettered section = one slot)
          // For section-level pick groups: key by groupId+ccCourses so each unique CC option
          // is its own slot within the yellow card
          const ccCourseKey = cheapestOpt.courses.map(c => `${c.prefix} ${c.number}`).sort().join('+')
          const ccKey = isOrGroup
            ? `${art.groupId}__sec${art.sectionPosition}`
            : isPickGroup
              ? `${art.groupId}__${ccCourseKey}`
              : ccCourseKey
          if (!reqMap[ccKey]) {
            reqMap[ccKey] = {
              ccKey,
              primaryCourses: [...cheapestOpt.courses],
              programEntries: [],
              isOrGroupSection: isOrGroup,

            }
          }
          // For or_group rows accumulate all CC courses in this section
          if (isOrGroup) {
            cheapestOpt.courses.forEach(c => {
              if (!reqMap[ccKey].primaryCourses.some(e => e.prefix === c.prefix && e.number === c.number)) {
                reqMap[ccKey].primaryCourses.push(c)
              }
            })
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
              pickType: art.pickType,
              pickMin: art.pickMin,
              pickMax: art.pickMax,
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
              pickType: na.pickType ?? null,
              partOfPickGroup: na.partOfPickGroup || false,
              coveredByAnotherOption: na.coveredByAnotherOption || false,
            }
          }
        }
      }

      const rows = Object.values(reqMap).map(entry => {
        const coverage = new Set(entry.programEntries.map(e => e.program)).size
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
          pickType: canonicalEntry?.pickType ?? null,
          pickMin: canonicalEntry?.pickMin ?? null,
          pickMax: canonicalEntry?.pickMax ?? null,
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

  // ─── CHANGE 4: computeAttainability — correct progress for all pick types ───
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
        const pgKey = `${pe.program}|${pe.groupId}`
        if (!programGroupMap[pgKey]) {
          programGroupMap[pgKey] = {
            program: pe.program,
            nRequired: pe.nRequired,
            pickType: pe.pickType,
            totalCourses: 0,
            completedCourses: 0,
          }
        }
        programGroupMap[pgKey].totalCourses += 1
        if (isDone) programGroupMap[pgKey].completedCourses += 1
      }
    }

    for (const pg of Object.values(programGroupMap)) {
      if (!programMap[pg.program]) continue
      if (pg.nRequired !== null) {
        // Pick-N group counts as 1 requirement unit
        // For units/areas/range: mark done when user checks anything (best we can do client-side)
        // For count: mark done when completedCourses >= nRequired
        programMap[pg.program].total += 1
        const isDone = pg.pickType === 'count'
          ? pg.completedCourses >= pg.nRequired
          : pg.completedCourses >= 1
        if (isDone) programMap[pg.program].completed += 1
      } else {
        // All required — each course is its own unit
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
  // ─── END CHANGE 4 ───────────────────────────────────────────────────────────

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
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffe082', verticalAlign: 'middle', marginRight: 4 }}/>yellow-bordered card = choose from the group — you don't need all of them</div>
                  <div>🔴 red row = no equivalent at your CC — if inside a yellow card, choose a different option from the group; if standalone, you may need to take it after transferring</div>
                  <div>▼ tap any row to see which university requirement it satisfies and additional info</div>
                  <div>☑ check it off once you've taken it — progress saves automatically</div>
                  <div>📊 the progress bar tracks all courses including recommended ones</div>
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
                const groups = []
                const groupIdToGroup = {}

                // Build lookup of noArt items by groupId for inline rendering
                // For or_group items, bundle by sectionPosition so POLI 5 + POLI 30 (same section D)
                // appear as one combined slot, not two separate rows
                const noArtByGroupId = {}
                const noArtByGroupIdFlat = {} // for isEffectivelyRequired groups
                const inlineRequiredNoArt = []
                for (const na of (overlapData.noArticulation || [])) {
                  if (na.partOfPickGroup) {
                    if (!noArtByGroupId[na.groupId]) noArtByGroupId[na.groupId] = {}
                    // Key by sectionPosition to bundle courses from same lettered section
                    const secKey = na.sectionPosition ?? 'unknown'
                    if (!noArtByGroupId[na.groupId][secKey]) {
                      noArtByGroupId[na.groupId][secKey] = { courses: [], reason: na.reason, sectionPosition: na.sectionPosition }
                    }
                    const slot = noArtByGroupId[na.groupId][secKey]
                    const alreadyAdded = slot.courses.some(
                      x => x.prefix === na.uniReq.prefix && x.number === na.uniReq.number
                    )
                    if (!alreadyAdded) slot.courses.push({ prefix: na.uniReq.prefix, number: na.uniReq.number, title: na.uniReq.title, units: na.uniReq.units })
                    if (na.reason && !slot.reason) slot.reason = na.reason
                    // Also track flat for isEffectivelyRequired groups
                    if (!noArtByGroupIdFlat[na.groupId]) noArtByGroupIdFlat[na.groupId] = []
                    const alreadyFlat = noArtByGroupIdFlat[na.groupId].some(
                      x => x.uniReq.prefix === na.uniReq.prefix && x.uniReq.number === na.uniReq.number
                    )
                    if (!alreadyFlat) noArtByGroupIdFlat[na.groupId].push(na)
                  } else if (!na.coveredByAnotherOption) {
                    inlineRequiredNoArt.push(na)
                  }
                }



                for (const row of overlapData.rows) {
                  const groupId = row.groupId ?? `singleton_${row.ccKey}`
                  const nRequired = row.nRequired ?? null

                  if (!groupIdToGroup[groupId]) {
                    const g = {
                      groupId,
                      groupTitle: row.groupTitle || 'MAJOR REQUIREMENTS',
                      sectionLabel: row.sectionLabel || '',
                      nRequired,
                      pickType: row.pickType ?? null,
                      pickMin: row.pickMin ?? null,
                      pickMax: row.pickMax ?? null,
                      rows: [],
                    }
                    groupIdToGroup[groupId] = g
                    groups.push(g)
                  }
                  groupIdToGroup[groupId].rows.push(row)
                }

                // noArtByGroupId is already used directly via Object.values() in rendering
                // No need to attach to groups — yellow card reads it directly by group.groupId

                // Also add groups for inline required no-art items that have no articulated sibling
                for (const na of inlineRequiredNoArt) {
                  const groupId = na.groupId ?? `noart_${na.uniReq.prefix}_${na.uniReq.number}`
                  if (!groupIdToGroup[groupId]) {
                    const g = {
                      groupId,
                      groupTitle: na.groupTitle || 'MAJOR REQUIREMENTS',
                      sectionLabel: na.sectionLabel || '',
                      nRequired: null,
                      pickType: null,
                      pickMin: null,
                      pickMax: null,
                      rows: [],
                      noArtRows: [],
                      _groupPosition: na.groupPosition ?? 999,
                      _sectionPosition: na.sectionPosition ?? 999,
                    }
                    groupIdToGroup[groupId] = g
                    groups.push(g)
                  }
                  if (!groupIdToGroup[groupId].noArtRows) groupIdToGroup[groupId].noArtRows = []
                  groupIdToGroup[groupId].noArtRows.push(na)
                }

                const isRecommendedGroup = (g) => isRecommendedSection(g.groupTitle) || isRecommendedSection(g.sectionLabel)
                const sectionTier = (g) => {
                  if (isRecommendedGroup(g)) return 2
                  const label = (g.sectionLabel || g.groupTitle || '').toLowerCase()
                  if (label.includes('required')) return 0
                  return 1
                }
                groups.sort((a, b) => {
                  const aTier = sectionTier(a)
                  const bTier = sectionTier(b)
                  if (aTier !== bTier) return aTier - bTier
                  // Use _groupPosition from rows if available, else from noArtRows
                  const aPos = a.rows[0]?._groupPosition ?? a._groupPosition ?? 999
                  const bPos = b.rows[0]?._groupPosition ?? b._groupPosition ?? 999
                  return aPos - bPos
                })

                let lastDisplayLabel = null
                const rendered = []

                for (const group of groups) {
                  const isPickN = group.nRequired !== null
                  const totalAvailableAtCC = group.rows.length
                  const noArtSiblingSlots = Object.keys(noArtByGroupId[group.groupId] || {}).length
                  const noArtSiblingsFlat = (noArtByGroupIdFlat[group.groupId] || []).length
                  // isEffectivelyRequired: pick group but only 1 CC option AND no no-art siblings
                  // If there are no-art siblings (in yellow card or flat), show yellow card
                  const isEffectivelyRequired = isPickN && totalAvailableAtCC <= 1 && noArtSiblingSlots === 0 && noArtSiblingsFlat === 0

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
                    rendered.push(
                      <div key={`group-${group.groupId}`} style={{
                        border: '1.5px solid #ffe082',
                        borderRadius: 10,
                        marginBottom: 12,
                        overflow: 'hidden',
                        background: '#fffdf5',
                      }}>
                        {/* ─── CHANGE 3 applied: use pickGroupLabel for header ─── */}
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
                              {pickGroupLabel(group)}
                            </span>
                            <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>
                              — you don't need all of them
                            </span>
                          </div>
                        </div>

                        {[...group.rows, ...Object.values(noArtByGroupId[group.groupId] || {}).map(slot => ({ _isNoArt: true, slot }))].map((rowOrNa, rowIdx) => {
                          // Render amber no-equiv rows inside yellow card (bundled by section)
                          if (rowOrNa._isNoArt) {
                            const slot = rowOrNa.slot
                            const label = slot.courses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                            const subtitle = slot.courses.map(c => c.title).filter(Boolean).join(' + ')
                            const units = slot.courses.reduce((sum, c) => sum + (c.units || 0), 0)
                            return (
                              <div key={`noart-${label}`} style={{
                                borderTop: '1px dashed #fecaca',
                                background: '#fff5f5',
                              }}>
                                <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fca5a5', padding: '4px 0', letterSpacing: '0.05em' }}>OR</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                                  <div style={{ width: 15, height: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ color: '#fca5a5', fontSize: 14 }}>✕</span>
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      {label}
                                      <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>No equivalent at {ccName}</span>
                                    </div>
                                    {subtitle && <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{subtitle}{units ? ` · ${units} units` : ''}</div>}
                                    {slot.reason && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{slot.reason}</div>}
                                    <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4, fontStyle: 'italic' }}>
                                      Choose a different option from this group instead
                                    </div>
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
                    // Render articulated rows first, then no-art rows after
                    // For isEffectivelyRequired groups, use noArtByGroupIdFlat to show siblings
                    const effectiveNoArtRows = isEffectivelyRequired
                      ? (noArtByGroupIdFlat[group.groupId] || [])
                      : (group.noArtRows || [])
                    group.rows.forEach((row) => {
                      const isDone = completedCourses.has(row.ccKey)
                      const isExpanded = expandedRow === row.ccKey
                      const label = row.primaryCourses.map(c => `${c.prefix} ${c.number}`).join(' + ')
                      const subtitle = row.primaryCourses.map(c => c.title).filter(Boolean).join(' + ')
                      const units = row.primaryCourses.reduce((sum, c) => sum + (c.units || 0), 0)
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
                    // Render no-art rows AFTER articulated rows in same section
                    ;effectiveNoArtRows.forEach((na) => {
                      rendered.push(
                        <div key={`noart-inline-${na.uniReq.prefix}-${na.uniReq.number}-${na.program}`} style={{
                          border: '1px solid #fecaca', borderRadius: 8, marginBottom: 6,
                          background: '#fff5f5', overflow: 'hidden',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                            <div style={{ width: 15, height: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ color: '#fca5a5', fontSize: 14 }}>✕</span>
                            </div>
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

                // Render inline required no-art rows (groups with only noArtRows, no articulated rows)
                for (const g of groups) {
                  if ((g.noArtRows || []).length > 0 && g.rows.length === 0) {
                    const displayLabel = g.sectionLabel || g.groupTitle || 'REQUIREMENTS'
                    if (displayLabel !== lastDisplayLabel) {
                      lastDisplayLabel = displayLabel
                      rendered.push(
                        <div key={`sec-noart-${displayLabel}-${g.groupId}`} style={{
                          marginTop: rendered.length === 0 ? 0 : 32,
                          marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e8e8e4',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            {displayLabel}
                          </div>
                        </div>
                      )
                    }
                    for (const na of g.noArtRows) {
                      rendered.push(
                        <div key={`noart-req-${na.uniReq.prefix}-${na.uniReq.number}-${na.program}`} style={{
                          border: '1px solid #fecaca', borderRadius: 8, marginBottom: 6,
                          background: '#fff5f5', overflow: 'hidden',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                            <div style={{ width: 15, height: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ color: '#fca5a5', fontSize: 14 }}>✕</span>
                            </div>
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
              })()}

              {overlapData.rows.length === 0 && (
                <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
              )}
            </div>

            {/* RIGHT: Progress */}
            <div style={{ position: isWide ? 'sticky' : 'static', top: 20 }}>
              <div className="card" style={{ background: '#f9f9f7', border: '1px solid #e8e8e4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>📊 Progress</div>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                  Check rows to update
                </div>

                {summary.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#aaa' }}>Check off courses to see your progress</div>
                ) : (
                  summary.map((s, i) => {
                    const pct = s.total === 0 ? 0 : Math.round((s.completed / s.total) * 100)
                    const isTop = i === 0 && summary.length > 1
                    const showHeart = isTop && summary.length > 1 && completedCourses.size > 0
                    return (
                      <div key={i} style={{ marginBottom: i < summary.length - 1 ? 16 : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: isTop ? 600 : 400, color: isTop ? '#1a1a1a' : '#555', flex: 1, marginRight: 8 }}>
                            {showHeart && <span>💜 </span>}{s.label}
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

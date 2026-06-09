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

const GE_TOTAL_ESTIMATE = 35

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

// ─── Pacing helper ────────────────────────────────────────────────────────────

function computePacing(neededRows, startTerm, transferTerm, geCompleted, geRequired) {
  const startIdx = TERMS.indexOf(startTerm)
  const endIdx   = TERMS.indexOf(transferTerm)
  if (endIdx <= startIdx) return null

  const semesters = TERMS.slice(startIdx, endIdx).filter(t => !t.startsWith('Summer')).length
  const semestersWithSummer = TERMS.slice(startIdx, endIdx).length
  if (semesters === 0) return null

  const majorUnitsLeft = neededRows.reduce(
    (sum, r) => sum + r.primaryCourses.reduce((s, c) => s + (c.units || 3), 0), 0
  )
  const majorUnitsDone = programs.reduce((sum, p) => {
    const prog = overlapData?.rows.filter(r => r.programEntries.some(e => e.program === `${p.uniName} → ${p.majorLabel}`)) || []
    return sum + prog.filter(r => completedCourses.has(r.ccKey)).reduce((s, r) => s + r.primaryCourses.reduce((c2, c) => c2 + (c.units || 3), 0), 0)
  }, 0)

  const geLeft = Math.max(0, (geRequired || GE_TOTAL_ESTIMATE) - (geCompleted || 0))
  const totalDone = (geCompleted || 0) + majorUnitsDone
  const capLeft = Math.max(0, 70 - totalDone)
  const capPct = Math.min(100, Math.round((totalDone / 70) * 100))

  return {
    majorUnitsLeft, geLeft, semesters, semestersWithSummer,
    totalDone, capLeft, capPct,
    perSemester: Math.round((majorUnitsLeft + geLeft) / semesters),
    perSemesterWithSummer: Math.round((majorUnitsLeft + geLeft) / semestersWithSummer),
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

// ─── CC schedule URL lookup ───────────────────────────────────────────────────

const CC_SCHEDULE_URLS = {
  'Diablo Valley': 'https://webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx?search=dvc',
  'Los Medanos': 'https://webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx?search=lmc',
  'Contra Costa': 'https://webapps.4cd.edu/apps/courseschedulesearch/search-course.aspx',
  'De Anza': 'https://www.deanza.edu/schedule/',
  'Allan Hancock': 'https://www.hancockcollege.edu/apply/register.php',
  'American River': 'https://arc.losrios.edu/admissions/get-started-and-apply',
  'Antelope Valley': 'https://www.avc.edu/schedule',
  'Bakersfield': 'https://reg-prod.ec.kccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Porterville': 'https://reg-prod.ec.kccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Copper Mountain': 'https://reg-prod.ec.kccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Cerro Coso': 'https://reg-prod.ec.kccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Barstow': 'https://ssbprod2.barstow.edu:8443/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Butte': 'https://selfservice.butte.edu/Student/Courses',
  'Cabrillo': 'https://cabrillo-ss.colleague.elluciancloud.com/Student/Courses',
  'Canada College': 'https://phx-ban-apps.smccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Skyline': 'https://phx-ban-apps.smccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'College of San Mateo': 'https://phx-ban-apps.smccd.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Cerritos': 'https://secure.cerritos.edu/schedule/',
  'Las Positas': 'https://banssprod.clpccd.cc.ca.us/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Chabot': 'https://banssprod.clpccd.cc.ca.us/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Chaffey': 'https://colss-prod.ec.chaffey.edu/Student/Courses/Search',
  'Citrus': 'https://apps.citruscollege.edu/live-class-schedule',
  'City College of San Francisco': 'https://www.ccsf.edu/courses',
  'Clovis': 'https://selfservice.scccd.edu/Student/Courses/Search',
  'Fresno City': 'https://selfservice.scccd.edu/Student/Courses',
  'Reedley': 'https://selfservice.scccd.edu/Student/Courses',
  'Madera': 'https://selfservice.scccd.edu/Student/Courses',
  'Coalinga': 'https://coalingacollege.edu/schedule/',
  'Lemoore': 'https://lemoorecollege.edu/schedule/',
  'Golden West': 'https://ssb-prod.ec.cccd.edu/PROD/pw_pub_sched.p_search?Term=202650&college=GW',
  'Orange Coast': 'https://ssb-prod.ec.cccd.edu/PROD/pw_pub_sched.p_search?Term=202650&college=OC',
  'Coastline': 'https://ssb-prod.ec.cccd.edu/PROD/pw_pub_sched.p_search',
  'College of Alameda': 'https://alameda.edu/coa-online-schedule?campus=Alameda',
  'Merritt': 'https://merritt.edu/online-schedule?campus=Merritt',
  'Laney': 'https://laney.edu/class-scheduling?campus=Laney',
  'College of Marin': 'https://netapps.marin.edu/Apps/Directory/ScheduleSearch.aspx',
  'College of the Canyons': 'https://selfservice.canyons.edu/Student/Courses',
  'College of the Desert': 'https://ss.collegeofthedesert.edu/Student/Courses',
  'College of the Redwoods': 'https://webadvisor.redwoods.edu/WAPROD/WebAdvisor?TOKENIDX=574086532&SS=1&APP=ST&CONSTITUENCY=WBST',
  'College of the Sequoias': 'https://banweb.cos.edu/prod/hzsched.p_search',
  'College of the Siskiyous': 'https://reg-prod.cloud.siskiyous.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Columbia': 'https://myapps.yosemite.edu/ccclasssearch/',
  'Modesto': 'https://myapps.yosemite.edu/mjcclasssearch/',
  'Compton': 'https://cmptn-prod-pxes02.banner.elluciancloud.com:8090/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Cosumnes River': 'https://crc.losrios.edu/academics/search-class-schedules',
  'Crafton Hills': 'https://www.craftonhills.edu/eschedule/',
  'Cuesta': 'https://ssb2.cuesta.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Cuyamaca': 'https://selfservice.gcccd.edu/Student/Courses',
  'Grossmont': 'https://selfservice.gcccd.edu/Student/Courses',
  'Cypress': 'https://schedule.nocccd.edu/?college=1',
  'Fullerton College': 'https://schedule.nocccd.edu/?college=2',
  'East Los Angeles': 'https://www.elac.edu/academics/calendar-schedules/schedules',
  'El Camino': 'https://selfservice.elcamino.edu/student/courses/',
  'Evergreen Valley': 'https://colss-prod.ec.sjeccd.edu/Student/Courses',
  'San Jose City': 'https://colss-prod.ec.sjeccd.edu/Student/Courses',
  'Folsom Lake': 'https://flc.losrios.edu/academics/search-class-schedules',
  'Foothill': 'https://foothill.edu/schedule/index.html',
  'Gavilan': 'https://reg-prod.ec.gavilan.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Glendale': 'https://psprd.glendale.edu/psc/guest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Hartnell': 'https://stuserv.hartnell.edu/Student/Courses/',
  'Imperial Valley': 'https://imperial.courses.civitaslearning.com/',
  'Irvine Valley': 'https://classes.socccd.edu/smartscheduleweb/index/1/I/202670/MarketingCode',
  'Saddleback': 'https://classes.socccd.edu/smartscheduleweb/index/1/S/202670/MarketingCode',
  'Lake Tahoe': 'https://ss.ltcc.edu:8183/Student/Courses/Search',
  'Lassen': 'https://webadvisor.lassencollege.edu:8171/student/courses',
  'Long Beach City': 'https://www.cs.lbcc.edu/psc/guest/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL',
  'Mendocino': 'https://service.mendocino.edu/Student/Courses',
  'Merced College': 'https://ss-prod.mccd.edu/Student/Courses',
  'MiraCosta': 'https://surf.miracosta.edu/psc/ps/EMPLOYEE/SA/c/MCC_CUSTOM_FL.MZ_CLASS_LIST_FL.GBL',
  'Mission College': 'https://schedule.wvm.edu/?college=mc',
  'West Valley': 'https://schedule.wvm.edu/?college=wv',
  'Monterey Peninsula': 'https://reg-prod.mpc.elluciancloud.com:8103/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Moorpark': 'https://schedule.vcccd.edu/',
  'Ventura College': 'https://schedule.vcccd.edu/',
  'Oxnard': 'https://schedule.vcccd.edu/',
  'Moreno Valley': 'https://www.mvc.edu/class-finder/index.php',
  'Mount San Antonio': 'https://prodrg.mtsac.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Mt. San Jacinto': 'https://selfservice.msjc.edu/css/courses',
  'Napa Valley': 'https://colss-prod.ec.napavalley.edu/Student/Courses',
  'Norco': 'https://norcocollege.edu/scheduleapp/index.html',
  'Ohlone': 'https://selfservice.ohlone.edu:8443/Student/Courses',
  'Palo Verde': 'https://prod-selfserv.paloverde.edu/Student/Courses/Search',
  'Palomar': 'https://my.palomar.edu/psp/palc9prd_1/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main',
  'Pasadena': 'https://findclasses.pasadena.edu/',
  'Santiago Canyon': 'https://colss-prod.cloud.rsccd.edu/Student/Courses/Search',
  'Santa Ana': 'https://colss-prod.cloud.rsccd.edu/Student/Courses/Search',
  'Rio Hondo': 'https://ssb.riohondo.edu:8443/prodssb/pw_pub_sched.p_search',
  'Riverside City': 'https://rcc.edu/academics/class-finder.html',
  'Sacramento City': 'https://scc.losrios.edu/academics/search-class-schedules',
  'San Bernardino Valley': 'https://www.valleycollege.edu/eschedule/',
  'San Diego City': 'https://www.sdccd.edu/students/class-search/search.html',
  'San Diego Mesa': 'https://www.sdccd.edu/students/class-search/search.html',
  'San Diego Miramar': 'https://www.sdccd.edu/students/class-search/search.html',
  'San Joaquin Delta': 'https://deltacollege.search.collegescheduler.com/search?term=2265',
  'Santa Barbara City': 'https://banner.sbcc.edu/ords/ssb/pw_pub_sched.p_search?term=202710',
  'Santa Monica': 'https://smccis.smc.edu/smcweb/f?p=373:1::::::',
  'Santa Rosa': 'https://reg-prod.santarosajc.elluciancloud.com:8103/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Shasta': 'https://mysc.shastacollege.edu/Student/Courses',
  'Sierra College': 'https://ss.oci.sierracollege.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Solano': 'https://ssb.solano.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Southwestern': 'https://collselfserv.swccd.edu/Student/Courses',
  'Taft': 'https://ct-prod-bsr.taftcollege.edu:8443/StudentRegistrationSsb/ssb/term/termSelection?mode=search',
  'Victor Valley': 'https://vvc-ss.colleague.elluciancloud.com/Student/Courses',
  'Woodland': 'https://wcc-self-service.yccd.edu/Student/Courses/Search',
  'Yuba': 'https://yc.yccd.edu/admissions/courses/',
  'Feather River': 'https://www.frc.edu/admissions/registration',
  'Los Angeles City': 'https://www.lacitycollege.edu/Academics/class-schedule',
  'Los Angeles Valley': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Los Angeles Pierce': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Los Angeles Harbor': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Los Angeles Mission': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Los Angeles Trade': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Los Angeles Southwest': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'West Los Angeles': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  'Kings River': 'https://selfservice.scccd.edu/Student/Courses',
}

function getCCScheduleUrl(ccName) {
  if (!ccName) return null
  const key = Object.keys(CC_SCHEDULE_URLS).find(k => ccName.includes(k))
  return key ? CC_SCHEDULE_URLS[key] : null
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
  const saveTimeoutRef = useRef(null)
  const [geCompleted, setGeCompleted] = useState(0)
const [geRequired, setGeRequired] = useState(GE_TOTAL_ESTIMATE)
const [includeSummer, setIncludeSummer] = useState(false)

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
        if (b.coverage !== a.coverage) return b.coverage - a.coverage
        if (a._groupPosition !== b._groupPosition) return a._groupPosition - b._groupPosition
        if (a._sectionPosition !== b._sectionPosition) return a._sectionPosition - b._sectionPosition
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
    const programGroupMap = {}
    for (const row of overlapData.rows) {
      const isDone = completedCourses.has(row.ccKey)
      for (const pe of row.programEntries) {
        if (!programMap[pe.program]) continue
        const pgKey = `${pe.program}|${pe.groupId}`
        if (!programGroupMap[pgKey]) {
          programGroupMap[pgKey] = { program: pe.program, nRequired: pe.nRequired, pickType: pe.pickType, totalCourses: 0, completedCourses: 0 }
        }
        programGroupMap[pgKey].totalCourses += 1
        if (isDone) programGroupMap[pgKey].completedCourses += 1
      }
    }
    for (const pg of Object.values(programGroupMap)) {
      if (!programMap[pg.program]) continue
      if (pg.nRequired !== null) {
        programMap[pg.program].total += 1
        const isDone = pg.pickType === 'count' ? pg.completedCourses >= pg.nRequired : pg.completedCourses >= 1
        if (isDone) programMap[pg.program].completed += 1
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

  // ─── Sidebar ──────────────────────────────────────────────────────────────

  function renderSidebar() {
  const scheduleUrl = getCCScheduleUrl(ccName)

  const groupStateForPacing = {}
  for (const row of overlapData.rows) {
    const gid = row.groupId
    if (!gid || row.nRequired === null) continue
    if (!groupStateForPacing[gid]) groupStateForPacing[gid] = { nRequired: row.nRequired, pickType: row.pickType, completedCount: 0, completedUnits: 0 }
    if (completedCourses.has(row.ccKey)) {
      groupStateForPacing[gid].completedCount += 1
      groupStateForPacing[gid].completedUnits += row.primaryCourses.reduce((s, c) => s + (c.units || 3), 0)
    }
  }
  const groupSlotsForPacing = {}
  for (const [gid, gs] of Object.entries(groupStateForPacing)) {
    groupSlotsForPacing[gid] = gs.pickType === 'units'
      ? { unitsNeeded: Math.max(0, gs.nRequired - gs.completedUnits), unitsAdded: 0 }
      : { slotsLeft: Math.max(0, gs.nRequired - gs.completedCount) }
  }
  const neededRows = []
  for (const row of overlapData.rows) {
    if (completedCourses.has(row.ccKey)) continue
    const gid = row.groupId
    const gd  = gid ? groupSlotsForPacing[gid] : null
    if (gd) {
      if (gd.unitsNeeded !== undefined) {
        const u = row.primaryCourses.reduce((s, c) => s + (c.units || 3), 0)
        if (gd.unitsNeeded - gd.unitsAdded <= 0) continue
        gd.unitsAdded += u
      } else {
        if (gd.slotsLeft <= 0) continue
        gd.slotsLeft -= 1
      }
    }
    neededRows.push(row)
  }

  const pacing = computePacing(neededRows, plannerStart, plannerEnd, geCompleted, geRequired)
  const termWord = includeSummer ? 'term' : 'semester'
  const perSem = includeSummer ? pacing?.perSemesterWithSummer : pacing?.perSemester

  const pacingStatus = !perSem ? null
    : perSem <= 15 ? { label: 'On track', color: '#3B6D11', bg: '#EAF3DE' }
    : perSem <= 18 ? { label: 'Tight',    color: '#854F0B', bg: '#FAEEDA' }
    :                { label: 'Heavy load',color: '#A32D2D', bg: '#FCEBEB' }

  const pacingHeadline = !pacing ? 'Set your terms to see your status'
    : perSem <= 15 ? "You're on track"
    : perSem <= 18 ? "It'll be tight"
    : "You're behind pace"

  const pacingAdvice = !pacing ? ''
    : perSem <= 15 ? `A comfortable pace — you have room to breathe at ~${perSem}u/${termWord}.`
    : perSem <= 18 ? `You'll need to stay consistent every ${termWord} — no light terms.`
    : `~${perSem}u/${termWord} is a heavy load. Consider pushing your transfer goal one ${termWord} later.`

  const capColor = (pacing?.capPct || 0) >= 100 ? '#A32D2D'
    : (pacing?.capPct || 0) >= 80 ? '#BA7517'
    : '#639922'

  return (
    <>
      {/* ── Progress bars ── */}
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>📊 Progress</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Check rows to update</div>
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
                  {isTop && completedCourses.size > 0 && <span>💜 </span>}{s.label}
                </div>
                <div style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{s.completed}/{s.total}</div>
              </div>
              <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ background: pct === 100 ? '#4caf50' : '#6C5CE7', height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          )
        })
      )}

      {/* ── Transfer pacing ── */}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #e8e8e4' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>🗓 Transfer pacing</div>

        {/* Term selectors */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>Starting</div>
            <select value={plannerStart} onChange={e => setPlannerStart(e.target.value)} style={{ fontSize: 12, width: '100%' }}>
              {TERMS.slice(0, -1).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ color: '#ccc', marginTop: 14, fontSize: 12 }}>→</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>Transfer goal</div>
            <select value={plannerEnd} onChange={e => setPlannerEnd(e.target.value)} style={{ fontSize: 12, width: '100%' }}>
              {TERMS.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Summer toggle */}
        <div
          onClick={() => setIncludeSummer(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', userSelect: 'none' }}
        >
          <div style={{
            width: 28, height: 16, borderRadius: 8, position: 'relative', transition: 'background 0.2s',
            background: includeSummer ? '#3B6D11' : '#ccc', flexShrink: 0,
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, transition: 'left 0.2s',
              left: includeSummer ? 14 : 2,
            }} />
          </div>
          <span style={{ fontSize: 12, color: '#555' }}>Include summer terms</span>
        </div>

        {/* GE inputs */}
        <div style={{ background: '#f5f5f3', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>
            GE progress
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 6 }}>counts once for all schools</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>Units completed</div>
              <input
                type="number" min={0} max={50} step={1}
                value={geCompleted}
                onChange={e => setGeCompleted(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ width: 70, fontSize: 13 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>Units required</div>
              <input
                type="number" min={1} max={50} step={1}
                value={geRequired}
                onChange={e => setGeRequired(Math.max(1, parseInt(e.target.value) || 35))}
                style={{ width: 70, fontSize: 13 }}
              />
            </div>
          </div>
          <div style={{ marginTop: 8, background: '#e0e0e0', borderRadius: 3, height: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: '#639922',
              width: `${Math.min(100, Math.round((geCompleted / geRequired) * 100))}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#bbb', marginTop: 3 }}>
            <span>{geCompleted} of {geRequired} units done</span>
            <span>{Math.max(0, geRequired - geCompleted)}u left</span>
          </div>
        </div>

        {/* Headline verdict */}
        {!pacing ? (
          <div style={{ fontSize: 12, color: '#aaa' }}>Set a valid start and transfer term above.</div>
        ) : (
          <>
            <div style={{ background: '#f9f9f7', border: '1px solid #e8e8e4', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{pacingHeadline}</div>
                {pacingStatus && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: pacingStatus.bg, color: pacingStatus.color }}>
                    {pacingStatus.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>{pacingAdvice}</div>

              {/* Cap bar */}
              <div style={{ fontSize: 11, color: '#888', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Transferable unit cap</span>
                <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{pacing.totalDone} of 70 used</span>
              </div>
              <div style={{ background: '#e0e0e0', borderRadius: 3, height: 5, overflow: 'hidden', marginBottom: 3 }}>
                <div style={{ height: '100%', borderRadius: 3, background: capColor, width: `${pacing.capPct}%`, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: 10, color: '#bbb' }}>{pacing.capLeft} units remaining before cap</div>

              {pacing.capPct >= 100 && (
                <div style={{ marginTop: 8, background: '#FCEBEB', color: '#A32D2D', borderRadius: 6, padding: '6px 10px', fontSize: 11, lineHeight: 1.5 }}>
                  You've hit the 70-unit cap. Only take what your schools require.
                </div>
              )}
              {pacing.capPct >= 80 && pacing.capPct < 100 && (
                <div style={{ marginTop: 8, background: '#FAEEDA', color: '#854F0B', borderRadius: 6, padding: '6px 10px', fontSize: 11, lineHeight: 1.5 }}>
                  Getting close to the cap — be selective about what you take next.
                </div>
              )}
            </div>

            {/* Per-school cards */}
            {programs.map((prog, i) => {
              const progLabel = `${prog.uniName} → ${prog.majorLabel}`
              const progRows = overlapData.rows.filter(r => r.programEntries.some(e => e.program === progLabel))
              const progNeeded = progRows.filter(r => !completedCourses.has(r.ccKey))
              const progMajorLeft = progNeeded.reduce((s, r) => s + r.primaryCourses.reduce((s2, c) => s2 + (c.units || 3), 0), 0)
              const progMajorTotal = progRows.reduce((s, r) => s + r.primaryCourses.reduce((s2, c) => s2 + (c.units || 3), 0), 0)
              const progMajorDone = progMajorTotal - progMajorLeft
              const progTotal = progMajorLeft + Math.max(0, geRequired - geCompleted)
              const terms = includeSummer
                ? TERMS.slice(TERMS.indexOf(plannerStart), TERMS.indexOf(plannerEnd)).length
                : TERMS.slice(TERMS.indexOf(plannerStart), TERMS.indexOf(plannerEnd)).filter(t => !t.startsWith('Summer')).length
              const perSemProg = terms > 0 ? Math.round(progTotal / terms) : 0
              const st = !perSemProg ? { label: '—', color: '#888', bg: '#f0f0f0' }
                : perSemProg <= 15 ? { label: 'On track', color: '#3B6D11', bg: '#EAF3DE' }
                : perSemProg <= 18 ? { label: 'Tight',    color: '#854F0B', bg: '#FAEEDA' }
                :                    { label: 'Heavy load',color: '#A32D2D', bg: '#FCEBEB' }
              const majorComplete = progMajorLeft === 0

              return (
                <div key={i} style={{ background: '#fff', border: '1px solid #efefed', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{prog.uniName}</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{prog.majorLabel}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, background: '#f5f5f3', borderRadius: 8, padding: '8px 10px' }}>
                      {majorComplete ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#3B6D11' }}>✓ Done</div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>major prep</div>
                          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>all {progMajorTotal}u complete</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>{progMajorLeft}u</div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>major prep left</div>
                          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{progMajorDone}u of {progMajorTotal}u done</div>
                        </>
                      )}
                    </div>
                    <div style={{ flex: 1, background: '#f5f5f3', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: perSemProg > 0 ? st.color : '#1a1a1a' }}>~{perSemProg}u</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>per {termWord}</div>
                      <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>major + GE combined</div>
                    </div>
                  </div>

                  <div style={{ background: '#e0e0e0', borderRadius: 3, height: 4, overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ height: '100%', borderRadius: 3, background: st.color, width: `${Math.min(100, Math.round((perSemProg / 20) * 100))}%`, transition: 'width 0.3s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#ccc', marginBottom: 8 }}>
                    <span>light</span><span>comfortable up to 15u</span><span>heavy</span>
                  </div>

                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                    {perSemProg === 0 ? 'Set valid terms above.' :
                     perSemProg <= 15 ? `On track — ~${perSemProg}u/${termWord} is a comfortable pace.` :
                     perSemProg <= 18 ? `Tight — you'll need ~${perSemProg}u every ${termWord} without a break.` :
                     `Behind pace — ~${perSemProg}u/${termWord} is a heavy load. Consider a later transfer date.`}
                  </div>
                </div>
              )
            })}

            {scheduleUrl && (
              <a href={scheduleUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 12, color: '#6C5CE7', textDecoration: 'none' }}>
                ↗ {ccName} schedule
              </a>
            )}

            <div style={{ fontSize: 10, color: '#ccc', marginTop: 12, lineHeight: 1.6 }}>
              GE is shared across all schools (IGETC). Summer terms {includeSummer ? 'included' : 'excluded'}. Talk to your counselor about sequencing.
            </div>
          </>
        )}
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
                        {coverageMost && <span style={{ fontSize: 10, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                        {isSchoolSpecific && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 600, background: '#f5f4f0', color: '#999' }}>SCHOOL-SPECIFIC</span>}
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
                    {coverageMost && <span style={{ fontSize: 10, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>MULTIPLE</span>}
                    {isSchoolSpecific && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 600, background: '#f5f4f0', color: '#999' }}>SCHOOL-SPECIFIC</span>}
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

        effectiveNoArtRows.forEach(na => {
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

    for (const g of groups) {
      if ((g.noArtRows || []).length > 0 && g.rows.length === 0) {
        const displayLabel = g.sectionLabel || g.groupTitle || 'REQUIREMENTS'
        if (displayLabel !== lastDisplayLabel) {
          lastDisplayLabel = displayLabel
          rendered.push(
            <div key={`sec-noart-${displayLabel}-${g.groupId}`} style={{ marginTop: rendered.length === 0 ? 0 : 32, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e8e8e4' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{displayLabel}</div>
            </div>
          )
        }
        for (const na of g.noArtRows) {
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
            <div style={{ background: '#f0edff', border: '1px solid #d4ccff', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, fontSize: 12, color: '#444' }}>
                <strong style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#1a1a1a' }}>How to read this</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><span style={{ color: '#6C5CE7', fontWeight: 700 }}>●</span> purple = that program requires this course &nbsp;·&nbsp; <span style={{ color: '#ccc', fontWeight: 700 }}>●</span> grey = not required</div>
                  <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffe082', verticalAlign: 'middle', marginRight: 4 }} />yellow-bordered card = choose from the group — you don't need all of them</div>
                  <div>🔴 red row = no equivalent at your CC</div>
                  <div>▼ tap any row to see which university requirement it satisfies</div>
                  <div>☑ check it off once you've taken it — progress saves automatically</div>
                  <div>⚠️ for unit-based groups, unit counts refer to <strong>university course units</strong></div>
                </div>
                {overlapData.totalPrograms > 1 && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #d4ccff' }}>
                    <strong style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#1a1a1a' }}>📋 Your transfer strategy</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div>Transfer students can bring a maximum of <strong>70 units</strong> — so it matters which courses you take first.</div>
                      <div><span style={{ fontSize: 10, background: '#ede9ff', color: '#6C5CE7', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>ALL PROGRAMS</span> &nbsp;Take these first — one course satisfies every school at once.</div>
                      <div><span style={{ fontSize: 10, background: '#fff3e0', color: '#f57f17', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>MULTIPLE</span> &nbsp;Take these next — good overlap across several schools.</div>
                      <div><span style={{ fontSize: 10, background: '#f5f4f0', color: '#999', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>SCHOOL-SPECIFIC</span> &nbsp;Take these last — use remaining units on your top choice school.</div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => { setShowBanner(false); localStorage.setItem('tab2_banner_dismissed', '1') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0, marginTop: 2 }} aria-label="Dismiss">×</button>
            </div>
          )}

          <div style={{ display: isWide ? 'grid' : 'block', gridTemplateColumns: isWide ? '1fr 300px' : undefined, gap: isWide ? 24 : 0, alignItems: 'start' }}>
            <div>
              {renderCourseList()}
              {overlapData.rows.length === 0 && (
                <div className="key-note">No articulated courses found. Try different programs or check ASSIST.org directly.</div>
              )}
            </div>

            <div style={{ position: isWide ? 'sticky' : 'static', top: 20 }}>
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

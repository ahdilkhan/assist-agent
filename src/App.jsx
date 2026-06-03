import { supabase } from "./lib/supabase"
import { useState, useEffect } from 'react'
import './App.css'
import Tab2 from './Tab2'

const ASSIST_BASE = import.meta.env.VITE_ASSIST_BASE
const YEAR_ID = 75

const REGIONS = {
  'Bay Area': ['De Anza', 'Foothill', 'Diablo Valley', 'Laney', 'Merritt', 'College of Alameda', 'Chabot', 'Las Positas', 'Ohlone', 'Mission College', 'San Jose City', 'Evergreen Valley', 'Canada College', 'Skyline', 'College of San Mateo', 'College of Marin', 'City College of San Francisco', 'Contra Costa', 'Los Medanos', 'Gavilan', 'Cabrillo'],
  'LA Area': ['Santa Monica', 'Los Angeles City', 'Los Angeles Valley', 'Los Angeles Pierce', 'Los Angeles Harbor', 'Los Angeles Mission', 'Los Angeles Trade', 'Los Angeles Southwest', 'East Los Angeles', 'West Los Angeles', 'Glendale', 'Pasadena', 'Citrus', 'Mount San Antonio', 'Rio Hondo', 'Cerritos', 'Long Beach City', 'El Camino', 'Compton', 'Antelope Valley', 'College of the Canyons'],
  'San Diego': ['San Diego City', 'San Diego Mesa', 'San Diego Miramar', 'Grossmont', 'Cuyamaca', 'Palomar', 'MiraCosta', 'Southwestern', 'Imperial Valley'],
  'Central Valley': ['Fresno City', 'Kings River', 'Reedley', 'Merced College', 'Modesto', 'Columbia', 'San Joaquin Delta', 'Madera', 'Clovis', 'Bakersfield', 'Porterville', 'Taft', 'College of the Sequoias', 'Lemoore', 'Coalinga'],
  'Inland Empire': ['Chaffey', 'San Bernardino Valley', 'Crafton Hills', 'Victor Valley', 'Riverside City', 'Mt. San Jacinto', 'Norco', 'Moreno Valley', 'Copper Mountain', 'Palo Verde', 'Barstow', 'Cerro Coso'],
  'Central Coast': ['Santa Barbara City', 'Ventura College', 'Oxnard', 'Moorpark', 'Cuesta', 'Allan Hancock', 'Monterey Peninsula', 'Hartnell'],
  'North': ['Shasta', 'Butte', 'Feather River', 'Lassen', 'Yuba', 'Woodland', 'Folsom Lake', 'Sierra College', 'Sacramento City', 'American River', 'Cosumnes River', 'Mendocino', 'College of the Redwoods', 'College of the Siskiyous', 'Lake Tahoe', 'Napa Valley', 'Solano', 'Santa Rosa'],
  'Orange County': ['Orange Coast', 'Golden West', 'Coastline', 'Fullerton College', 'Cypress', 'Irvine Valley', 'Saddleback', 'Santiago Canyon', 'Santa Ana', 'College of the Desert'],
}

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
  'Clovis': 'https://selfservice.scccd.edu/Student/Courses/Search?SearchResultsView=1&locations=CCC&locations=CWEB&locations=CHYB&locations=COFF&locations=CHC&OpenAndWaitlistedSections=true',
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
  'Cosumnes River': 'https://crc.losrios.edu/academics/search-class-schedules?crcFilter=true&openFilter=true&waitlistFilter=true',
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
  'Folsom Lake': 'https://flc.losrios.edu/academics/search-class-schedules?flcFilter=true&openFilter=true&waitlistFilter=true',
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
  'Sacramento City': 'https://scc.losrios.edu/academics/search-class-schedules?sccFilter=true&openFilter=true&waitlistFilter=true',
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
  'Woodland': 'https://wcc-self-service.yccd.edu/Student/Courses/Search?locations=Z5&locations=Z8',
  'Yuba': 'https://yc.yccd.edu/admissions/courses/',
  'Feather River': 'https://www.frc.edu/admissions/registration',
  'Los Angeles City': 'https://www.lacitycollege.edu/Academics/class-schedule',
  'Los Angeles Valley': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Los Angeles Pierce': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Los Angeles Harbor': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Los Angeles Mission': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Los Angeles Trade': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Los Angeles Southwest': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'West Los Angeles': 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Campus=LAVC&strm=2264',
  'Kings River': 'https://selfservice.scccd.edu/Student/Courses',
}

function getScheduleUrl(ccName) {
  for (const [key, url] of Object.entries(CC_SCHEDULE_URLS)) {
    if (ccName.toLowerCase().includes(key.toLowerCase())) return url
  }
  return `https://www.google.com/search?q=${encodeURIComponent(ccName + ' class schedule')}`
}

function ccMatchesRegion(ccName, region) {
  return REGIONS[region].some(keyword => ccName.toLowerCase().includes(keyword.toLowerCase()))
}

async function assistGet(path) {
  const res = await fetch(`${ASSIST_BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ASSIST ${res.status}: ${path}`)
  const data = await res.json()
  if (!data.isSuccessful) throw new Error(data.validationFailure || 'ASSIST error')
  return data.result
}

async function getAgreementInstitutions(uniId) {
  return assistGet(`/articulation/api/Agreements/Published/from/${uniId}`)
}

async function getAgreement(key) {
  return assistGet(`/articulation/api/Agreements?Key=${encodeURIComponent(key)}`)
}

async function getAllMajorsKey(uniId, ccId) {
  const result = await assistGet(`/articulation/api/Agreements/Published/for/${uniId}/to/${ccId}/in/${YEAR_ID}?types=Major`)
  return result.allReports?.find(r => r.type === 'AllMajors')?.key || null
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

function parseArticulations(agreement, targetPrefix, targetNumber) {
  try {
    const arts = typeof agreement.articulations === 'string'
      ? JSON.parse(agreement.articulations) : agreement.articulations || []
    const sending = typeof agreement.sendingInstitution === 'string'
      ? JSON.parse(agreement.sendingInstitution) : agreement.sendingInstitution
    const ccName = sending?.names?.[0]?.name || sending?.code || 'Unknown CC'
    const ccId = sending?.id
    const matches = []
    for (const item of arts) {
      const art = item.articulation || item
      const receiving = art.course || art.receivingCourse
      if (!receiving) continue
      const rPrefix = (receiving.prefix || '').trim().toUpperCase()
      const rNum = (receiving.courseNumber || receiving.number || '').trim().toUpperCase()
      if (rPrefix === targetPrefix.toUpperCase() && rNum === targetNumber.toUpperCase()) {
        const sendingArt = art.sendingArticulation
        if (sendingArt?.noArticulationReason) continue
        const options = parseSendingOptions(sendingArt?.items || [])
        if (options.length > 0) {
          matches.push({ ccName, ccId, receivingCourse: `${rPrefix} ${rNum}`, receivingTitle: receiving.courseTitle || '', options })
        }
      }
    }
    return matches
  } catch (e) { console.warn('parse error:', e); return [] }
}

export const KNOWN_UNIVERSITIES = [
  { group: 'UC', options: [
    { id: 79, name: 'UC Berkeley' }, { id: 89, name: 'UC Davis' }, { id: 120, name: 'UC Irvine' },
    { id: 117, name: 'UCLA' }, { id: 144, name: 'UC Merced' }, { id: 46, name: 'UC Riverside' },
    { id: 7, name: 'UC San Diego' }, { id: 128, name: 'UC Santa Barbara' }, { id: 132, name: 'UC Santa Cruz' },
  ]},
  { group: 'CSU', options: [
    { id: 98, name: 'CSU Bakersfield' }, { id: 143, name: 'CSU Channel Islands' }, { id: 141, name: 'CSU Chico' },
    { id: 50, name: 'CSU Dominguez Hills' }, { id: 21, name: 'CSU East Bay' }, { id: 29, name: 'CSU Fresno' },
    { id: 129, name: 'CSU Fullerton' }, { id: 81, name: 'CSU Long Beach' }, { id: 76, name: 'CSU Los Angeles' },
    { id: 1, name: 'CSU Maritime Academy' }, { id: 12, name: 'CSU Monterey Bay' }, { id: 42, name: 'CSU Northridge' },
    { id: 115, name: 'Cal Poly Humboldt' }, { id: 75, name: 'Cal Poly Pomona' }, { id: 11, name: 'Cal Poly SLO' },
    { id: 60, name: 'CSU Sacramento' }, { id: 85, name: 'CSU San Bernardino' }, { id: 23, name: 'CSU San Marcos' },
    { id: 26, name: 'San Diego State' }, { id: 116, name: 'SF State' }, { id: 39, name: 'San Jose State' },
    { id: 88, name: 'Sonoma State' }, { id: 24, name: 'CSU Stanislaus' },
  ]},
  { group: 'Independent', options: [
    { id: 230, name: 'Azusa Pacific University' }, { id: 205, name: 'California Baptist University' },
    { id: 201, name: 'California Lutheran University' }, { id: 204, name: 'Charles R. Drew University' },
    { id: 207, name: 'Concordia University Irvine' }, { id: 211, name: 'Dominican University of California' },
    { id: 206, name: 'Fresno Pacific University' }, { id: 209, name: 'Loyola Marymount University' },
    { id: 216, name: 'Menlo College' }, { id: 212, name: "Mount Saint Mary's University LA" },
    { id: 213, name: 'National University' }, { id: 222, name: 'Palo Alto University' },
    { id: 214, name: 'Pepperdine University' }, { id: 227, name: 'Santa Clara University' },
    { id: 228, name: 'Simpson University' }, { id: 215, name: 'Touro University Worldwide' },
    { id: 234, name: 'University of San Diego' }, { id: 235, name: 'University of San Francisco' },
    { id: 217, name: 'University of the Pacific' }, { id: 220, name: 'University of Redlands' },
    { id: 224, name: 'Whittier College' },
  ]},
]

export const KNOWN_CCS = [
  { id: 110, name: 'Allan Hancock College' }, { id: 27, name: 'American River College' },
  { id: 121, name: 'Antelope Valley College' }, { id: 84, name: 'Bakersfield College' },
  { id: 9, name: 'Barstow Community College' }, { id: 111, name: 'College of Alameda' },
  { id: 8, name: 'Butte College' }, { id: 41, name: 'Cabrillo College' },
  { id: 68, name: 'Canada College' }, { id: 104, name: 'Cerritos College' },
  { id: 14, name: 'Cerro Coso Community College' }, { id: 96, name: 'Chabot College' },
  { id: 69, name: 'Chaffey College' }, { id: 97, name: 'Citrus College' },
  { id: 33, name: 'City College of San Francisco' }, { id: 150, name: 'Clovis Community College' },
  { id: 6, name: 'Columbia College' }, { id: 140, name: 'College of the Canyons' },
  { id: 15, name: 'College of the Desert' }, { id: 4, name: 'College of Marin' },
  { id: 83, name: 'College of the Redwoods' }, { id: 5, name: 'College of San Mateo' },
  { id: 34, name: 'College of the Sequoias' }, { id: 102, name: 'College of the Siskiyous' },
  { id: 153, name: 'Compton College' }, { id: 28, name: 'Contra Costa College' },
  { id: 112, name: 'Copper Mountain College' }, { id: 142, name: 'Cosumnes River College' },
  { id: 70, name: 'Crafton Hills College' }, { id: 16, name: 'Cuesta College' },
  { id: 99, name: 'Cuyamaca College' }, { id: 71, name: 'Cypress College' },
  { id: 113, name: 'De Anza College' }, { id: 114, name: 'Diablo Valley College' },
  { id: 118, name: 'East Los Angeles College' }, { id: 103, name: 'El Camino College' },
  { id: 2, name: 'Evergreen Valley College' }, { id: 122, name: 'Feather River College' },
  { id: 145, name: 'Folsom Lake College' }, { id: 51, name: 'Foothill College' },
  { id: 35, name: 'Fresno City College' }, { id: 134, name: 'Fullerton College' },
  { id: 72, name: 'Gavilan College' }, { id: 43, name: 'Glendale Community College' },
  { id: 55, name: 'Golden West College' }, { id: 106, name: 'Grossmont College' },
  { id: 123, name: 'Hartnell College' }, { id: 20, name: 'Imperial Valley College' },
  { id: 124, name: 'Irvine Valley College' }, { id: 36, name: 'Kings River College' },
  { id: 40, name: 'Lake Tahoe Community College' }, { id: 77, name: 'Laney College' },
  { id: 18, name: 'Las Positas College' }, { id: 82, name: 'Lassen Community College' },
  { id: 146, name: 'Lemoore College' }, { id: 135, name: 'Long Beach City College' },
  { id: 3, name: 'Los Angeles City College' }, { id: 31, name: 'Los Angeles Harbor College' },
  { id: 47, name: 'Los Angeles Mission College' }, { id: 86, name: 'Los Angeles Pierce College' },
  { id: 130, name: 'Los Angeles Southwest College' }, { id: 25, name: 'Los Angeles Trade Technical College' },
  { id: 44, name: 'Los Angeles Valley College' }, { id: 61, name: 'Los Medanos College' },
  { id: 200, name: 'Madera Community College' }, { id: 100, name: 'Mendocino College' },
  { id: 17, name: 'Merced College' }, { id: 13, name: 'Merritt College' },
  { id: 108, name: 'MiraCosta College' }, { id: 32, name: 'Mission College' },
  { id: 52, name: 'Modesto Junior College' }, { id: 139, name: 'Moorpark College' },
  { id: 149, name: 'Moreno Valley College' }, { id: 62, name: 'Mount San Antonio College' },
  { id: 53, name: 'Mt. San Jacinto College' }, { id: 73, name: 'Napa Valley College' },
  { id: 148, name: 'Norco College' }, { id: 48, name: 'Ohlone College' },
  { id: 74, name: 'Orange Coast College' }, { id: 87, name: 'Oxnard College' },
  { id: 63, name: 'Palo Verde College' }, { id: 56, name: 'Palomar College' },
  { id: 49, name: 'Pasadena City College' }, { id: 125, name: 'Porterville College' },
  { id: 107, name: 'Reedley College' }, { id: 64, name: 'Rio Hondo College' },
  { id: 78, name: 'Riverside City College' }, { id: 126, name: 'Sacramento City College' },
  { id: 65, name: 'Saddleback College' }, { id: 131, name: 'San Bernardino Valley College' },
  { id: 54, name: 'San Diego City College' }, { id: 101, name: 'San Diego Mesa College' },
  { id: 45, name: 'San Diego Miramar College' }, { id: 109, name: 'San Joaquin Delta College' },
  { id: 10, name: 'San Jose City College' }, { id: 136, name: 'Santa Ana College' },
  { id: 92, name: 'Santa Barbara City College' }, { id: 137, name: 'Santa Monica College' },
  { id: 57, name: 'Santa Rosa Junior College' }, { id: 66, name: 'Santiago Canyon College' },
  { id: 38, name: 'Shasta College' }, { id: 93, name: 'Sierra College' },
  { id: 127, name: 'Skyline College' }, { id: 94, name: 'Solano Community College' },
  { id: 138, name: 'Southwestern College' }, { id: 119, name: 'Taft College' },
  { id: 95, name: 'Ventura College' }, { id: 19, name: 'Victor Valley College' },
  { id: 91, name: 'West Los Angeles College' }, { id: 67, name: 'West Valley College' },
  { id: 147, name: 'Woodland Community College' }, { id: 90, name: 'Yuba College' },
].sort((a, b) => a.name.localeCompare(b.name))

const BATCH_SIZE = 15

export default function App() {
  const [activeTab, setActiveTab] = useState('tab1')
  const [step, setStep] = useState(1)
  const [uniId, setUniId] = useState('')
  const [uniName, setUniName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [courseNum, setCourseNum] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState('')
  const [equivalents, setEquivalents] = useState([])
  const [openBlocks, setOpenBlocks] = useState({})
  const [selectedRegions, setSelectedRegions] = useState([])
  const [selectedCC, setSelectedCC] = useState(null)
  const [savedCCs, setSavedCCs] = useState(new Set())
  const [showSaved, setShowSaved] = useState(false)
  const [user, setUser] = useState(null)

  useEffect(() => {
  // 1. Get current user on page load
  supabase.auth.getUser().then(({ data }) => {
    setUser(data.user)
  })

  // 2. Listen for login/logout changes
  const { data: listener } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setUser(session?.user ?? null)
    }
  )

  // 3. Cleanup listener
  return () => {
    listener.subscription.unsubscribe()
  }
}, [])

 async function signInWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  })
}

  function toggleBlock(key) { setOpenBlocks(prev => ({ ...prev, [key]: !prev[key] })) }
  function toggleRegion(region) {
    setSelectedRegions(prev => prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region])
  }
  function toggleSave(ccName, e) {
    e?.stopPropagation()
    setSavedCCs(prev => { const next = new Set(prev); next.has(ccName) ? next.delete(ccName) : next.add(ccName); return next })
  }

  const filteredEquivalents = selectedRegions.length > 0
    ? equivalents.filter(eq => selectedRegions.some(r => ccMatchesRegion(eq.ccName, r))) : equivalents
  const savedEquivalents = equivalents.filter(eq => savedCCs.has(eq.ccName))

  async function handleSearch() {
    if (!uniId || !prefix || !courseNum) { setError('Please fill in all fields.'); return }
    setError(''); setLoading(true); setLoadingProgress(0)
    setEquivalents([]); setSelectedRegions([]); setSelectedCC(null)
    setSavedCCs(new Set()); setShowSaved(false); setOpenBlocks({})
    try {
      setLoadingMsg('Fetching community colleges...')
      const institutions = await getAgreementInstitutions(uniId)
      const ccInstitutions = institutions.filter(i => i.receivingInstitution?.isCommunityCollege && i.sendingYearIds?.length > 0)
      const total = ccInstitutions.length
      setLoadingMsg(`Searching ${total} community colleges...`)
      const results = []
      let checked = 0
      for (let i = 0; i < ccInstitutions.length; i += BATCH_SIZE) {
        const batch = ccInstitutions.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(batch.map(async cc => {
          const ccId = cc.receivingInstitution.id
          try {
            const key = await getAllMajorsKey(uniId, ccId)
            if (!key) return []
            const agreement = await getAgreement(key)
            return parseArticulations(agreement, prefix, courseNum)
          } catch { return [] }
        }))
        batchResults.forEach(r => results.push(...r))
        checked += batch.length
        setLoadingProgress(Math.round((checked / total) * 100))
        setLoadingMsg(`Searching... ${checked}/${total} colleges checked`)
      }
      const seen = new Set()
      const deduped = results.filter(r => { if (seen.has(r.ccName)) return false; seen.add(r.ccName); return true })
      setEquivalents(deduped); setStep(2)
    } catch (e) { setError(`Error: ${e.message}`) }
    finally { setLoading(false); setLoadingMsg(''); setLoadingProgress(0) }
  }




  

  function getCourseCountLabel(eq) {
    const min = Math.min(...eq.options.map(o => o.courses.length))
    const max = Math.max(...eq.options.map(o => o.courses.length))
    if (min === max) return `${min} course${min > 1 ? 's' : ''} required`
    return `${min}–${max} courses required`
  }

  function renderCCList(list) {
    return list.map((eq, i) => (
      <div className="result-block" key={i}>
        <div className="result-header" onClick={() => toggleBlock(eq.ccName)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <span onClick={e => toggleSave(eq.ccName, e)} style={{ fontSize: 16, cursor: 'pointer', flexShrink: 0, opacity: savedCCs.has(eq.ccName) ? 1 : 0.3 }}>⭐</span>
            <div>
              <h3 style={{ margin: 0 }}>{eq.ccName}</h3>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {getCourseCountLabel(eq)}
                {eq.options?.[0]?.courses?.[0] ? ` · ${eq.options[0].courses[0].prefix} ${eq.options[0].courses[0].number}${eq.options[0].courses.length > 1 ? ' +' : ''}` : ''}
              </div>
            </div>
          </div>
          <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>{openBlocks[eq.ccName] ? '▲' : '▼'}</span>
        </div>
        {openBlocks[eq.ccName] && (
          <div className="result-body">
            {eq.options?.map((opt, j) => (
              <div key={j}>
                {j > 0 && <div style={{ textAlign: 'center', fontSize: 12, color: '#888', padding: '6px 0', fontWeight: 600 }}>— OR —</div>}
                {opt.courses.length > 1 && <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Take all together</div>}
                {opt.groupNote && <div style={{ fontSize: 12, color: '#f57f17', marginBottom: 6 }}>⚠️ {opt.groupNote}</div>}
                {opt.courses.map((c, k) => (
                  <div className="eq-row" key={k}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{c.prefix} {c.number} — {c.title}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{c.units ? `${c.units} units` : ''}</div>
                      {c.note && <div style={{ fontSize: 12, color: '#f57f17', marginTop: 2 }}>⚠️ {c.note}</div>}
                    </div>
                    <span className="badge badge-green">Articulated</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn-primary" style={{ width: 'auto', padding: '7px 14px', fontSize: 13 }} onClick={() => { setSelectedCC(eq); setStep(3) }}>Check schedule →</button>
              <a className="avail-link" href={`https://assist.org/transfer/results?year=${YEAR_ID}&institution=${eq.ccId}&agreement=${uniId}&agreementType=to&view=agreement&viewBy=major`} target="_blank" rel="noreferrer">View on ASSIST.org ↗</a>
            </div>
          </div>
        )}
      </div>
    ))
  }

  return (
    <div className="app">
      <div className="header">
  <h1>Transfer course finder</h1>

  <p>
    Find equivalent community college courses and compare transfer requirements
    across multiple UC and CSU campuses.
  </p>

  {user && (
    <div style={{ fontSize: 12, marginTop: 8, color: "#555" }}>
      Logged in as: {user.email}
    </div>
  )}

  
</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['tab1','🎯 Find CC equivalents for a university course'],['tab2','🗺️ Plan overlap across multiple programs'],].map(([id, label]) => (
          <div key={id} className={`pref-chip${activeTab === id ? ' selected' : ''}`} style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => setActiveTab(id)}>{label}</div>
        ))}
      </div>
      
      
      {!user ? (
  <div className="card">
    <h3>Please sign in to use the app</h3>
    <button onClick={signInWithGoogle}>
      Sign in with Google
    </button>
  </div>
) : (
  <>
  <button
  onClick={async () => {
    await supabase.auth.signOut()
  }}
>
  Log out
</button>
    {activeTab === 'tab2' && <Tab2 />}

    {activeTab === 'tab1' && (
        <>
          <div className="step-bar">
            <div className={`step-pill ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}>1 · Search</div>
            <div className={`step-pill ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}>2 · Equivalents</div>
            <div className={`step-pill ${step === 3 ? 'active' : ''}`}>3 · Schedule</div>
          </div>
          {error && <div className="error-box">{error}</div>}
          {step === 1 && (
            <div className="card">
              <div className="field">
                <label> University (UC or CSU)</label>
                <select value={uniId} onChange={e => { setUniId(e.target.value); setUniName(e.target.selectedOptions[0]?.text || '') }}>
                  <option value="">Select a university...</option>
                  {KNOWN_UNIVERSITIES.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <div className="field"><label>Course prefix</label><input type="text" placeholder="e.g. COMPSCI" value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} /></div>
                <div className="field"><label>Course number</label><input type="text" placeholder="e.g. 61A" value={courseNum} onChange={e => setCourseNum(e.target.value.toUpperCase())} /></div>
              </div>
              {loading ? (
                <div>
                  <div className="status"><div className="spinner" />{loadingMsg}</div>
                  <div style={{ background: '#eee', borderRadius: 4, height: 6, marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ background: '#1a1a1a', height: '100%', width: `${loadingProgress}%`, transition: 'width 0.3s ease', borderRadius: 4 }} />
                  </div>
                </div>
              ) : <button className="btn-primary" onClick={handleSearch}>Find equivalent courses →</button>}
            </div>
          )}
          {step === 2 && (
            <>
              <div className="top-row">
                <div className="top-row-info">
                  <h2>{prefix} {courseNum} → {uniName}</h2>
                  <p>{showSaved ? `${savedEquivalents.length} saved college${savedEquivalents.length !== 1 ? 's' : ''}` : `${filteredEquivalents.length} of ${equivalents.length} colleges shown${selectedRegions.length > 0 ? ` · ${selectedRegions.join(', ')}` : ''}`}</p>
                </div>
                <button className="btn-secondary" onClick={() => { setStep(1); setEquivalents([]) }}>← New search</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div className={`pref-chip${!showSaved ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setShowSaved(false)}>All colleges ({equivalents.length})</div>
                <div className={`pref-chip${showSaved ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setShowSaved(true)}>⭐ Saved ({savedCCs.size})</div>
              </div>
              {!showSaved && (
                <div style={{ marginBottom: 12 }}>
                  <div className="section-label" style={{ marginBottom: 8 }}>Filter by region</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <div className={`pref-chip${selectedRegions.length === 0 ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSelectedRegions([])}>All regions</div>
                    {Object.keys(REGIONS).map(region => {
                      const count = equivalents.filter(eq => ccMatchesRegion(eq.ccName, region)).length
                      if (count === 0) return null
                      return <div key={region} className={`pref-chip${selectedRegions.includes(region) ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => toggleRegion(region)}>{region} ({count})</div>
                    })}
                  </div>
                </div>
              )}
              {showSaved && savedEquivalents.length === 0 && <div className="key-note">No saved colleges yet. Click ⭐ on any college to save it.</div>}
              {showSaved ? renderCCList(savedEquivalents) : renderCCList(filteredEquivalents)}
            </>
          )}
          {step === 3 && selectedCC && (
            <>
              <div className="top-row">
                <div className="top-row-info"><h2>{selectedCC.ccName}</h2><p>Equivalent for {prefix} {courseNum} at {uniName}</p></div>
                <button className="btn-secondary" onClick={() => setStep(2)}>← Back</button>
              </div>
              {selectedCC.options.map((opt, i) => (
                <div key={i}>
                  {i > 0 && <div style={{ textAlign: 'center', fontSize: 12, color: '#888', padding: '8px 0', fontWeight: 600 }}>— OR —</div>}
                  <div className="avail-card">
                    {opt.courses.length > 1 && <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Take all of these together</div>}
                    {opt.groupNote && <div style={{ fontSize: 12, color: '#f57f17', marginBottom: 8 }}>⚠️ {opt.groupNote}</div>}
                    {opt.courses.map((c, j) => (
                      <div key={j} style={{ marginBottom: j < opt.courses.length - 1 ? 10 : 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <h4>{c.prefix} {c.number} — {c.title}</h4>
                          <span className="badge badge-green">Articulated</span>
                        </div>
                        {c.units && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{c.units} units</div>}
                        {c.note && <div style={{ fontSize: 12, color: '#f57f17', marginTop: 4 }}>⚠️ {c.note}</div>}
                      </div>
                    ))}
                    <div style={{ background: '#f5f4f0', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>💡 When you get to the schedule:</div>
                      {opt.courses.length === 1
                        ? <div style={{ fontSize: 13 }}>Search for <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{opt.courses[0].prefix} {opt.courses[0].number}</span></div>
                        : <ol style={{ paddingLeft: 18, margin: 0 }}>{opt.courses.map((c, k) => <li key={k} style={{ fontSize: 13, marginBottom: 4 }}>Search for <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.prefix} {c.number}</span><span style={{ color: '#888', fontSize: 12 }}> — {c.title}</span></li>)}</ol>
                      }
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <a className="avail-link" href={getScheduleUrl(selectedCC.ccName)} target="_blank" rel="noreferrer" style={{ fontWeight: 500, fontSize: 14 }}>🔍 Search schedule at {selectedCC.ccName} ↗</a>
                      <a className="avail-link" href="https://www.cccapply.org/" target="_blank" rel="noreferrer" style={{ color: '#888' }}>📋 Apply / Enroll via CCCApply ↗</a>
                      <a className="avail-link" href={`https://assist.org/transfer/results?year=${YEAR_ID}&institution=${selectedCC.ccId}&agreement=${uniId}&agreementType=to&view=agreement&viewBy=major`} target="_blank" rel="noreferrer" style={{ color: '#888' }}>📄 View full agreement on ASSIST.org ↗</a>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
       </>
)}

      {activeTab === 'tab3' && (
        <>
          {t3Error && <div className="error-box">{t3Error}</div>}
          {t3Courses.length === 0 && !t3Loading && (
            <div className="card">
              <div style={{ marginBottom: 14, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                See every course at your CC that counts toward <strong>Cal-GETC</strong>, <strong>IGETC</strong>, or <strong>CSU GE-Breadth</strong> certification, organized by area. Completing a full pattern satisfies lower-division GE at UC or CSU before you transfer.
              </div>
              <div className="field">
                <label>My community college</label>
                <select value={t3CcId} onChange={e => { setT3CcId(e.target.value); setT3CcName(e.target.selectedOptions[0]?.text || '') }}>
                  <option value="">Select your CC...</option>
                  {KNOWN_CCS.map(cc => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Certification type</label>
                <select value={t3ListType} onChange={e => setT3ListType(e.target.value)}>
                  <option value="CALGETC">Cal-GETC — for UC and CSU (newest)</option>
                  <option value="IGETC">IGETC — for UC and CSU</option>
                  <option value="CSUGE">CSU GE-Breadth</option>
                </select>
              </div>
              <button className="btn-primary" onClick={handleT3Search} disabled={!t3CcId || t3Loading}>See GE courses →</button>
            </div>
          )}
          {t3Loading && <div className="status"><div className="spinner" />Loading courses...</div>}
          {t3Courses.length > 0 && (
            <>
              <div className="top-row">
                <div className="top-row-info">
                  <h2>{t3ListType === 'CALGETC' ? 'Cal-GETC' : t3ListType === 'IGETC' ? 'IGETC' : 'CSU GE-Breadth'}</h2>
                  <p>{t3CcName} · {t3Filtered.length} of {t3Courses.length} courses shown</p>
                </div>
                <button className="btn-secondary" onClick={() => { setT3Courses([]); setT3Error(''); setT3Search(''); setT3AreaFilter('ALL') }}>← New search</button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div className="section-label" style={{ marginBottom: 8 }}>Filter by area</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <div className={`pref-chip${t3AreaFilter === 'ALL' ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setT3AreaFilter('ALL')}>All areas ({t3Courses.length})</div>
                  {t3AllAreas.map(([code, desc]) => {
                    const count = t3Courses.filter(c => c.transferAreas?.some(ta => ta.code === code)).length
                    return <div key={code} className={`pref-chip${t3AreaFilter === code ? ' selected' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setT3AreaFilter(code)}>{code} — {desc} ({count})</div>
                  })}
                </div>
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <input type="text" placeholder="🔍 Filter by course number, title, or prefix..." value={t3Search} onChange={e => setT3Search(e.target.value)} />
              </div>
              {t3Filtered.length === 0 && <div className="key-note">No courses match your filter.</div>}
              {t3Filtered.map((course, i) => (
                <div className="result-block" key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'default' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{course.identifier} — {course.courseTitle}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{course.minUnits === course.maxUnits ? `${course.minUnits} units` : `${course.minUnits}–${course.maxUnits} units`}</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end', maxWidth: 220, flexShrink: 0 }}>
                    {course.transferAreas?.map((ta, j) => (
                      <span key={j} className="badge badge-green" style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => setT3AreaFilter(ta.code)}>Area {ta.code}</span>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: '12px 16px', background: '#f5f4f0', borderRadius: 10, fontSize: 13, color: '#666' }}>
                💡 Completing all required areas earns the full {t3ListType === 'CALGETC' ? 'Cal-GETC' : t3ListType === 'IGETC' ? 'IGETC' : 'CSU GE-Breadth'} certification. Talk to a counselor to confirm your plan covers all required areas.{' '}
                <a className="avail-link" href="https://assist.org" target="_blank" rel="noreferrer">More info at ASSIST.org ↗</a>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

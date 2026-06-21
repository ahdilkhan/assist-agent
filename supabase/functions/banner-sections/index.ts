import "@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── BANNER SSB ───────────────────────────────────────────────

async function getSession(base: string) {
  const sessionRes = await fetch(`${base}/StudentRegistrationSsb/ssb/term/termSelection?mode=search`, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const cookieJar: Record<string, string> = {};
  sessionRes.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const [pair] = val.split(";");
      const [k, v] = pair.split("=");
      if (k && v) cookieJar[k.trim()] = v.trim();
    }
  });
  if (!cookieJar["JSESSIONID"]) throw new Error("No JSESSIONID");
  return cookieJar;
}

function buildCookieHeader(jar: Record<string, string>) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function setTerm(base: string, cookieJar: Record<string, string>, term: string) {
  const res = await fetch(`${base}/StudentRegistrationSsb/ssb/term/search?mode=search`, {
    method: "POST",
    headers: {
      "cookie": buildCookieHeader(cookieJar),
      "content-type": "application/x-www-form-urlencoded",
      "x-requested-with": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0",
    },
    body: `term=${term}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  res.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const [pair] = val.split(";");
      const [k, v] = pair.split("=");
      if (k && v) cookieJar[k.trim()] = v.trim();
    }
  });
}

async function fetchBannerSections(base: string, cookieJar: Record<string, string>, subject: string, courseNumber: string, term: string) {
  const params = new URLSearchParams({
    txt_subject: subject,
    txt_courseNumber: courseNumber,
    txt_term: term,
    pageOffset: "0",
    pageMaxSize: "500",
    sortColumn: "subjectDescription",
    sortDirection: "asc",
  });
  const res = await fetch(
    `${base}/StudentRegistrationSsb/ssb/searchResults/searchResults?${params}`,
    {
      headers: {
        "cookie": buildCookieHeader(cookieJar),
        "x-requested-with": "XMLHttpRequest",
        "accept": "application/json, text/javascript, */*; q=0.01",
        "referer": `${base}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
        "User-Agent": "Mozilla/5.0",
      },
    }
  );
  return await res.json();
}

async function getBannerTerms(base: string, cookieJar: Record<string, string>) {
  const res = await fetch(
    `${base}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=20`,
    {
      headers: {
        "cookie": buildCookieHeader(cookieJar),
        "x-requested-with": "XMLHttpRequest",
        "accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    }
  );
  return await res.json();
}

async function getBannerSections(baseUrl: string, subject: string, courseNumber: string) {
  const base = baseUrl.replace(/\/$/, "");
  const cookieJar = await getSession(base);
  const terms = await getBannerTerms(base, cookieJar);
  if (!terms || terms.length === 0) throw new Error("No terms found");

  const results = [];
  for (const term of terms) {
    try {
      const jar = await getSession(base);
      await setTerm(base, jar, term.code);
      const data = await fetchBannerSections(base, jar, subject, courseNumber, term.code);
      results.push({
        termCode: term.code,
        termDesc: term.description,
        totalCount: data.totalCount || 0,
        sections: (data.data || []).map((s: any) => ({
          crn: s.courseReferenceNumber,
          section: s.sequenceNumber,
          campus: s.campusDescription,
          title: s.courseTitle,
          units: s.creditHourLow,
          scheduleType: (() => {
            const t = (s.scheduleTypeDescription || '').toLowerCase()
            if (!t.includes('dist ed') && !t.includes('internet') && !t.includes('distance')) {
              if (t.includes('lecture') || t.includes('discussion')) return 'In-Person'
              if (t.includes('hybrid')) return 'Hybrid'
              if (t.includes('lab')) return 'Lab'
              return s.scheduleTypeDescription || null
            }
            // For distance ed, check meetings to distinguish online vs hybrid
            const meetings = s.meetingsFaculty || []
            const hasInPerson = meetings.some((m: any) => {
              const bldg = (m.meetingTime?.building || '').toUpperCase()
              const days = m.meetingTime?.meetingDaysList
              return days && days.length > 0 && bldg && !bldg.includes('WEB') && !bldg.includes('ONLINE') && !bldg.includes('OL') && !bldg.includes('TBA')
            })
            return hasInPerson ? 'Hybrid' : 'Online'
          })(),
          enrollment: s.enrollment,
          maxEnrollment: s.maximumEnrollment,
          seatsAvailable: s.seatsAvailable,
          waitCount: s.waitCount,
          waitAvailable: s.waitAvailable,
          openSection: s.openSection,
          instructor: s.faculty?.[0]?.displayName || null,
          meetings: s.meetingsFaculty?.map((m: any) => ({
            days: m.meetingTime?.meetingDaysList?.join("") || null,
            startTime: m.meetingTime?.beginTime || null,
            endTime: m.meetingTime?.endTime || null,
            building: m.meetingTime?.building || null,
            room: m.meetingTime?.room || null,
            startDate: m.meetingTime?.startDate || null,
            endDate: m.meetingTime?.endDate || null,
          })) || [],
        })),
      });
    } catch (e) {
      console.warn(`Failed term ${term.code}:`, e.message);
    }
  }
  return results;
}

// ─── COLLEAGUE SELF-SERVICE ───────────────────────────────────

async function getColleagueTokenAndCookie(base: string) {
  const res = await fetch(`${base}/Student/Courses`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  const html = await res.text();

  // Extract antiforgery token
  const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ||
                     html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
  const token = tokenMatch?.[1];
  if (!token) throw new Error("No antiforgery token found");

  // Extract cookie
  const cookieJar: Record<string, string> = {};
  res.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const [pair] = val.split(";");
      const [k, v] = pair.split("=");
      if (k && v) cookieJar[k.trim()] = v.trim();
    }
  });

  return { token, cookieJar };
}

async function getColleagueTerms(base: string, token: string, cookieJar: Record<string, string>) {
  const res = await fetch(`${base}/Student/Courses/GetCatalogAdvancedSearch`, {
    headers: {
      "cookie": buildCookieHeader(cookieJar),
      "__requestverificationtoken": token,
      "accept": "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const data = await res.json();
  return data?.Terms || [];
  // Terms format: [{ Item1: "2026FA", Item2: "Fall 2026" }, ...]
}

async function searchColleagueSections(base: string, token: string, cookieJar: Record<string, string>, termCode: string, subject: string, courseNumber: string) {
  const body = {
    keyword: null,
    terms: [termCode],
    keywordComponents: [{ subject, courseNumber, section: "", synonym: "" }],
    pageNumber: 1,
    quantityPerPage: 500,
    sortDirection: "Ascending",
    sortOn: "SectionName",
    openSections: null,
    openAndWaitlistedSections: null,
    locations: [], days: [], faculty: [], subjects: [],
    courseTypes: [], courseLevels: [], academicLevels: [],
    topicCodes: [], synonyms: [], sectionIds: null,
    courseIds: null, requirement: null, subrequirement: null,
    onlineCategories: null, startDate: null, endDate: null,
    startTime: null, endTime: null, startsAtTime: null, endsByTime: null,
    searchResultsView: "SectionListing", group: null,
  };

  const res = await fetch(`${base}/Student/Courses/PostSearchCriteria`, {
    method: "POST",
    headers: {
      "cookie": buildCookieHeader(cookieJar),
      "__RequestVerificationToken": token,
      "Content-Type": "application/json",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "__isguestuser": "true",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
      "Referer": `${base}/Student/Courses/SearchResult`,
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function getColleagueSections(baseUrl: string, subject: string, courseNumber: string) {
  const base = baseUrl.replace(/\/$/, "");
  const { token, cookieJar } = await getColleagueTokenAndCookie(base);
  const terms = await getColleagueTerms(base, token, cookieJar);
  if (!terms || terms.length === 0) throw new Error("No Colleague terms found");

 const results = [];
  for (const term of terms) {
    try {
      const { token: t, cookieJar: jar } = await getColleagueTokenAndCookie(base);
      const data = await searchColleagueSections(base, t, jar, term.Item1, subject, courseNumber);
      console.log(`[Colleague] term=${term.Code} response:`, JSON.stringify(data).slice(0, 300));
      const sections = data.Sections || [];
      results.push({
        termCode: term.Item1,
        termDesc: term.Item2,
        totalCount: sections.length,
        sections: sections.map((s: any) => {
          const dayMap: Record<number, string> = {1:'M',2:'T',3:'W',4:'Th',5:'F',6:'Sa',7:'Su'}
          return {
            crn: s.Id,
            section: s.SectionNameDisplay || s.Number,
            campus: s.Location?.Description || null,
            title: s.Course?.Title || s.Title || null,
            units: s.MinimumCredits || s.Credits || null,
            scheduleType: (() => {
              const methods: string[] = s.InstructionalMethodsDisplay || []
              const hasOnline = methods.some((m: string) => m.toLowerCase().includes('online') || m.toLowerCase().includes('async'))
              const hasInPerson = methods.some((m: string) => m.toLowerCase().includes('campus') || m.toLowerCase().includes('lec') && !m.toLowerCase().includes('online'))
              if (hasOnline && hasInPerson) return 'Hybrid'
              if (hasOnline) return 'Online'
              if (hasInPerson) return 'In-Person'
              return methods[0] || null
            })(),
            enrollment: s.Enrolled || 0,
            maxEnrollment: s.Capacity || 0,
            seatsAvailable: s.Available ?? 0,
            waitCount: s.Waitlisted || 0,
            waitAvailable: s.WaitlistAvailable ? 1 : 0,
            openSection: s.Available > 0,
            instructor: Array.isArray(s.FacultyDisplay) ? s.FacultyDisplay[0] : (s.FacultyDisplay || null),
            meetings: [{
              days: s.MobileMeetingsDisplay?.[0] || null,
              startTime: null,
              endTime: null,
              building: null,
              room: null,
              startDate: s.MobileMeetingsDisplay?.[1] || null,
              endDate: null,
            }],
          }
        }),
      });
    } catch (e) {
      console.warn(`Colleague term ${term.Code} failed:`, e.message);
    }
  }
  return results;
}

async function getSdccdSections(campus: string, subject: string, courseNumber: string) {
  // Try recent and upcoming term codes
  const termCodesToTry = ["2265", "2267", "2272", "2263"]
  
  const termMap: Record<string, string> = {
    "2253": "Spring 2025",
    "2255": "Summer 2025", 
    "2257": "Fall 2025",
    "2261": "Winter 2026",
    "2263": "Spring 2026",
    "2265": "Summer 2026",
    "2267": "Fall 2026",
    "2272": "Spring 2027",
  }

  const results = []
  
  for (const termCode of termCodesToTry) {
    try {
      const res = await fetch(`https://mws-api.sdccd.edu/?term=${termCode}&career=ugrd`, {
        headers: { "User-Agent": "Mozilla/5.0" }
      })
      const data = await res.json()
      const rows = data?.data?.query?.rows || []

      const filtered = rows.filter((r: any) => {
        const subj = (r.SUBJECT || '').trim().toUpperCase()
        const num = (r.CATALOG_NBR || '').trim().toUpperCase()
        const campusMatch = !campus || r.CAMPUS === campus
        return subj === subject.toUpperCase() && num === courseNumber.toUpperCase() && campusMatch
      })

      if (filtered.length === 0) continue

      const sections = filtered.map((r: any) => {
        const meetParts = (r.MEETINGINFO || '').split('|').map((p: string) => p.trim())
        const days = meetParts[2] || null
        const startTime = meetParts[3] || null
        const endTime = meetParts[4] || null
        const building = meetParts[1] || null
        const instructor = meetParts[6] || null
        const locationMap: Record<string, string> = {
        'ONCAMPUS': 'In-Person',
        'ONLINE': 'Online (Async)',
        'ONLINESYNC': 'Online (Sync)',
        'PT-ONLINE': 'Partially Online',
        'HYFLEX': 'HyFlex',
        'OFF': 'Off Campus',
      }
      const scheduleType = locationMap[r.LOCATION] || r.LOCATION || null

        const isOpen = r.ENRL_STAT === 'O'
        const hasWaitlist = r.ENRL_STAT === 'C' && (r.WAIT_CAP - r.WAIT_TOT) > 0

        return {
          crn: String(r.CLASS_NBR),
          section: String(r.CLASS_NBR),
          campus: r.CAMPUS || null,
          title: r.CRSE_NAME || null,
          units: r.UNITS || null,
          scheduleType,
          enrollment: r.ENRL_TOT || 0,
          maxEnrollment: r.ENRL_CAP || 0,
          seatsAvailable: isOpen ? (r.ENRL_CAP - r.ENRL_TOT) : 0,
          waitCount: r.WAIT_TOT || 0,
          waitAvailable: hasWaitlist ? (r.WAIT_CAP - r.WAIT_TOT) : 0,
          openSection: isOpen,
          instructor,
          meetings: days ? [{
            days,
            startTime,
            endTime,
            building,
            room: null,
            startDate: r.START_DT || null,
            endDate: r.END_DT || null,
          }] : [],
        }
      })

      results.push({
        termCode,
        termDesc: termMap[termCode] || `Term ${termCode}`,
        totalCount: sections.length,
        sections,
      })
    } catch (e) {
      console.warn(`SDCCD term ${termCode} failed:`, e.message)
    }
  }
  return results
}


async function getVcccdSections(campus: string, subject: string, courseNumber: string) {
  // Get CSRF token first
  const pageRes = await fetch('https://schedule.vcccd.edu/', {
    headers: { "User-Agent": "Mozilla/5.0" }
  })
  const html = await pageRes.text()
  const csrfMatch = html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)
  const csrf = csrfMatch?.[1]
  if (!csrf) throw new Error('No CSRF token found')

  const cookies = pageRes.headers.get('set-cookie') || ''
  const csrfCookie = cookies.match(/csrftoken=([^;]+)/)?.[1]
  const cookieHeader = csrfCookie ? `csrftoken=${csrfCookie}` : ''

  // Generate recent/upcoming term codes
  const now = new Date()
  const year = now.getFullYear()
  const termCodes = [
    `${year}05`, `${year}07`, `${year+1}01`, `${year}01`, `${year-1}07`
  ]

  const results = []
  const termNames: Record<string, string> = {}
  termCodes.forEach(code => {
    const y = code.slice(0, 4)
    const s = code.slice(4)
    if (s === '01') termNames[code] = `Spring ${y}`
    else if (s === '05') termNames[code] = `Summer ${y}`
    else if (s === '07') termNames[code] = `Fall ${y}`
  })

  for (const termCode of termCodes) {
    try {
      const body = new URLSearchParams({
        csrfmiddlewaretoken: csrf,
        subject: subject.toUpperCase(),
        crse: courseNumber,
        term: termCode,
        subjCombobox: '', locCombobox: '', ctitle: '', crn: '',
        start_hh: '05', start_mm: '00', start_ap: 'a',
        end_hh: '11', end_mm: '00', end_ap: 'p',
        newc: '0', noncrc: '0', offc: '0', pace: '0',
        ztc: '0', ge: '%', csupport: '0', mdCombobox: '', geCombobox: '',
      })

      const res = await fetch('https://schedule.vcccd.edu/filter/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieHeader,
          'Referer': 'https://schedule.vcccd.edu/',
          'User-Agent': 'Mozilla/5.0',
          'X-CSRFToken': csrf,
        },
        body: body.toString(),
      })

      const data = await res.json()
      const allRows = (data.detail_info || []).filter((r: any) => {
        const campusMatch = !campus || (r.CAMPUS_DESC || '').toLowerCase().includes(campus.toLowerCase())
        return campusMatch
      })
      // Deduplicate by CRN keeping first occurrence
      const seenCrns = new Set()
      const sections = allRows.filter((r: any) => {
        if (seenCrns.has(r.COURSE_CRN)) return false
        seenCrns.add(r.COURSE_CRN)
        return true
      })

      if (sections.length === 0) continue

      const mappedSections = sections.map((r: any) => {
        const statusHtml = r.STATUS || ''
        const isOpen = statusHtml.includes('OPEN')
        const isWaitlist = statusHtml.includes('WAITLISTED')

        const timeParts = (r.MEET_TIME || '').split(' - ')
        const startTime = timeParts[0] || null
        const endTime = timeParts[1] || null

        return {
          crn: r.COURSE_CRN || null,
          section: r.COURSE_CRN || null,
          campus: r.CAMPUS_DESC || null,
          title: r.COURSE_TITLE || null,
          units: parseFloat((r.CREDITS || '0').trim()) || null,
          scheduleType: (() => {
            const codeMap: Record<string, string> = {
              'TRADN': 'In-Person',
              'ONLIN': 'Online',
              'HBRDO': 'Partially Online',
              'HBRDG': 'Hybrid',
              'HYFLEX': 'HyFlex',
            }
            return codeMap[r.SECTION_INTEGRATION_CODE] || r.SECTION_INTEGRATION_CODE || 'TBA'
          })(),
          enrollment: r.CRSE_ENRL || 0,
          maxEnrollment: r.CRSE_MAX_ENRL || 0,
          seatsAvailable: r.CRSE_SEATS_AVAIL || 0,
          waitCount: 0,
          waitAvailable: isWaitlist ? 1 : 0,
          openSection: isOpen,
          instructor: r.INSTRUCTOR_NAME || null,
          meetings: r.DAYS ? [{
            days: r.DAYS || null,
            startTime,
            endTime,
            building: r.MEET_BLDG_DESC || null,
            room: r.MEET_ROOM_CODE || null,
            startDate: r.PTRM_START_DATE || null,
            endDate: r.PTRM_END_DATE || null,
          }] : [],
        }
      })

      results.push({
        termCode,
        termDesc: termNames[termCode] || termCode,
        totalCount: mappedSections.length,
        sections: mappedSections,
      })
    } catch (e) {
      console.warn(`VCCCD term ${termCode} failed:`, e.message)
    }
  }
  return results
}

// ─── LACCD PEOPLESOFT ───────────────────────────────────────────

const LACCD_BASE = 'https://mycollege-guest.laccd.edu/psc/classsearchguest/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'

async function getLaccdSession() {
  const res1 = await fetch(LACCD_BASE, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } })
  const cookieJar: Record<string, string> = {}
  res1.headers.forEach((val, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const [pair] = val.split(';')
      const [k, v] = pair.split('=')
      if (k && v) cookieJar[k.trim()] = v.trim()
    }
  })
  const location = res1.headers.get('location') || LACCD_BASE
  const res2 = await fetch(location, {
    headers: { cookie: buildCookieHeader(cookieJar), 'User-Agent': 'Mozilla/5.0' },
  })
  const html = await res2.text()

  const icsid = html.match(/name='ICSID' id='ICSID' value='([^']+)'/)?.[1]
  const icStateNum = html.match(/name='ICStateNum' id='ICStateNum' value='(\d+)'/)?.[1] || '8'
  if (!icsid) throw new Error('No LACCD ICSID found')

  // Scrape available terms directly from the term <select> so we never have to guess term codes
  return { cookieJar, icsid, icStateNum }
}

async function searchLaccd(cookieJar: Record<string, string>, icsid: string, icStateNum: string, subject: string, courseNumber: string, termCode: string) {
  const body = new URLSearchParams({
    ICAJAX: '1', ICNAVTYPEDROPDOWN: '0', ICType: 'Panel', ICElementNum: '0',
    ICStateNum: icStateNum, ICAction: 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH', ICModelCancel: '0',
    ICXPos: '0', ICYPos: '0', ResponsetoDiffFrame: '-1', TargetFrameName: 'None', FacetPath: 'None',
    TA_BuildChoices: '1', SP_FldName: '', SP_FldValues: '', PrmtTbl: '', PrmtTbl_fn: '', PrmtTbl_fv: '',
    TA_SkipFldNms: '', ICFocus: '', ICSaveWarningFilter: '0', ICChanged: '-1', ICSkipPending: '0',
    ICAutoSave: '0', ICResubmit: '0', ICSID: icsid, ICActionPrompt: 'false', ICTypeAheadID: '',
    EnableSmartPrompt: '1', SpValidate: '1', SpThreshold: '1000', SpMfuFirst: '1', SpMfuMax: '3', SpMruMax: '3',
    EnableSmartSelect: '1', SsMin: '6', SsThreshold: '1000', SsMfuFirst: '1', SsMfuMax: '3', SsMruMax: '3',
    ICBcDomData: 'UnknownValue', ICPanelHelpUrl: '', ICPanelName: '', ICFind: '', ICAddCount: '', ICAppClsData: '',
    'CLASS_SRCH_WRK2_INSTITUTION$31$': 'LACCD',
    'CLASS_SRCH_WRK2_STRM$35$': termCode,
    'SSR_CLSRCH_WRK_SUBJECT$0': subject.toUpperCase(),
    'SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1': 'C',
    'SSR_CLSRCH_WRK_CATALOG_NBR$1': courseNumber,
    'SSR_CLSRCH_WRK_ACAD_CAREER$2': '', 'SSR_CLSRCH_WRK_CAMPUS$3': '', 'ATTR_VAL$4': '',
    'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$5': 'N',
    'SSR_CLSRCH_WRK_SSR_START_TIME_OPR$6': 'GE', 'SSR_CLSRCH_WRK_MEETING_TIME_START$6': '',
    'SSR_CLSRCH_WRK_SSR_END_TIME_OPR$6': 'LE', 'SSR_CLSRCH_WRK_MEETING_TIME_END$6': '',
    'SSR_CLSRCH_WRK_INCLUDE_CLASS_DAYS$7': 'I',
    'SSR_CLSRCH_WRK_MON$chk$7': '', 'SSR_CLSRCH_WRK_TUES$chk$7': '', 'SSR_CLSRCH_WRK_WED$chk$7': '',
    'SSR_CLSRCH_WRK_THURS$chk$7': '', 'SSR_CLSRCH_WRK_FRI$chk$7': '', 'SSR_CLSRCH_WRK_SAT$chk$7': '',
    'SSR_CLSRCH_WRK_SUN$chk$7': '',
    'SSR_CLSRCH_WRK_SSR_EXACT_MATCH2$8': 'B', 'SSR_CLSRCH_WRK_LAST_NAME$8': '',
    'SSR_CLSRCH_WRK_CLASS_NBR$9': '', 'SSR_CLSRCH_WRK_DESCR$10': '',
    'SSR_CLSRCH_WRK_SSR_COMPONENT$11': '', 'SSR_CLSRCH_WRK_SESSION_CODE$12': '',
  })

  const res = await fetch(LACCD_BASE, {
    method: 'POST',
    headers: {
      cookie: buildCookieHeader(cookieJar),
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      'Referer': LACCD_BASE,
    },
    body: body.toString(),
  })
  return await res.text()
}

function laccdCampusFromRoom(room: string) {
  // Room field looks like "Harbor-Online", "Southwest-Online", "Valley-MATH 101"
  const map: Record<string, string> = {
    harbor: 'Los Angeles Harbor College', city: 'Los Angeles City College',
    valley: 'Los Angeles Valley College', pierce: 'Los Angeles Pierce College',
    mission: 'Los Angeles Mission College', trade: 'Los Angeles Trade Technical College',
    southwest: 'Los Angeles Southwest College', west: 'West Los Angeles College',
    eastla: 'East Los Angeles College', 'east la': 'East Los Angeles College',
  }
  const lower = (room || '').toLowerCase()
  for (const [key, name] of Object.entries(map)) {
    if (lower.includes(key)) return name
  }
  return null
}

function parseLaccdResults(html: string) {
  const out: any[] = []
  const groupRegex = /title='Collapse section ([A-Z]+) ([A-Z0-9]+) - ([^']+)'([\s\S]*?)(?=title='Collapse section|<SYSVAR)/g
  let gm
  while ((gm = groupRegex.exec(html)) !== null) {
    const [, prefix, number, title, block] = gm
    const rowRegex = /MTG_CLASS_NBR\$(\d+)'[\s\S]*?>([^<]+)<\/a>[\s\S]*?MTG_CLASSNAME\$\1'[\s\S]*?>([^<]+)<br \/>\s*([^<]*)<\/a>[\s\S]*?MTG_DAYTIME\$\1'[^>]*>([^<]*)<[\s\S]*?MTG_ROOM\$\1'[^>]*>([^<]*)<[\s\S]*?MTG_INSTR\$\1'[^>]*>([^<]*)<[\s\S]*?MTG_TOPIC\$\1'[^>]*>([^<]*)<[\s\S]*?alt="([^"]+)"/g
    let rm
    while ((rm = rowRegex.exec(block)) !== null) {
      const room = rm[6].trim()
      out.push({
        crn: rm[2].trim(),
        section: rm[3].trim(),
        campus: laccdCampusFromRoom(room),
        title: `${prefix} ${number} — ${title.trim()}`,
        units: null,
        scheduleType: room.toLowerCase().includes('online') ? 'Online' : 'In-Person',
        enrollment: null, maxEnrollment: null,
        seatsAvailable: rm[9].toLowerCase().includes('open') ? 1 : 0,
        waitCount: 0,
        waitAvailable: rm[9].toLowerCase().includes('wait') ? 1 : 0,
        openSection: rm[9].toLowerCase().includes('open'),
        instructor: rm[7].trim() || null,
        meetings: [{
          days: rm[5].trim() || null, startTime: null, endTime: null,
          building: room, room: null,
          startDate: rm[8].trim() || null, endDate: null,
        }],
      })
    }
  }
  return out
}

async function getLaccdSections(subject: string, courseNumber: string) {
  const { cookieJar, icsid, icStateNum } = await getLaccdSession()
  // Confirmed: 2266 = 2026 Summer, 2268 = 2026 Fall (increments of 2 per term)
  const termsToTry = [
    { code: '2268', label: '2026 Fall' },
    { code: '2270', label: '2027 Spring' },   // unconfirmed guess
    { code: '2272', label: '2027 Summer' },   // unconfirmed guess
    { code: '2274', label: '2027 Fall' },     // unconfirmed guess
  ]
  const results = []
  for (const term of termsToTry) {
    try {
      const html = await searchLaccd(cookieJar, icsid, icStateNum, subject, courseNumber, term.code)
      const sections = parseLaccdResults(html)
      results.push({ termCode: term.code, termDesc: term.label, totalCount: sections.length, sections, _debugHtmlSnippet: html.slice(0, 1500) })
    } catch (e) {
      console.warn(`LACCD term ${term.code} failed:`, e.message)
    }
  }
  return results
}

// ─── MAIN HANDLER ─────────────────────────────────────────────

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    try {
      const { baseUrl, subject, courseNumber, system, campus } = await req.json();
      if (!baseUrl || !subject || !courseNumber) {
        return Response.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
      }

      let data;
      if (system === "colleague") {
        data = await getColleagueSections(baseUrl, subject, courseNumber);
      } else if (system === "sdccd") {
        data = await getSdccdSections(campus || "", subject, courseNumber);
      } else if (system === "vcccd") {
        data = await getVcccdSections(campus || "", subject, courseNumber);
      } else if (system === "laccd") {              // ← ADD THIS
        data = await getLaccdSections(subject, courseNumber);   // ← ADD THIS
      } else {
        data = await getBannerSections(baseUrl, subject, courseNumber);
      }

      return Response.json({ success: true, terms: data }, { headers: CORS });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: CORS });
    }
  },
};
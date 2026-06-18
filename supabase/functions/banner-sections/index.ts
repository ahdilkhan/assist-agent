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
          scheduleType: s.scheduleTypeDescription,
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
  const res = await fetch(`https://mws-api.sdccd.edu/?terms=all&career=ugrd`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  })
  const data = await res.json()
  const rows = data?.data?.query?.rows || []

  // Filter by subject and course number and campus
  const filtered = rows.filter((r: any) => {
    const subj = (r.SUBJECT || '').trim().toUpperCase()
    const num = (r.CATALOG_NBR || '').trim().toUpperCase()
    const campusMatch = !campus || r.CAMPUS === campus
    return subj === subject.toUpperCase() && num === courseNumber.toUpperCase() && campusMatch
  })

  if (filtered.length === 0) return []

  // Group by STRM
  const byTerm: Record<string, any[]> = {}
  for (const r of filtered) {
    if (!byTerm[r.STRM]) byTerm[r.STRM] = []
    byTerm[r.STRM].push(r)
  }

  // Build term description from START_DT
  function getTermDesc(strm: string, rows: any[]) {
    const startDt = rows[0]?.START_DT || ''
    if (!startDt) return `Term ${strm}`
    const d = new Date(startDt)
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    if (month >= 1 && month <= 5) return `Spring ${year}`
    if (month >= 6 && month <= 7) return `Summer ${year}`
    return `Fall ${year}`
  }

  // Sort terms newest first
  const sortedTerms = Object.keys(byTerm).sort((a, b) => Number(b) - Number(a))

  return sortedTerms.map(strm => {
    const termRows = byTerm[strm]
    const sections = termRows.map((r: any) => {
      const meetParts = (r.MEETINGINFO || '').split('|').map((p: string) => p.trim())
      const days = meetParts[2] || null
      const startTime = meetParts[3] || null
      const endTime = meetParts[4] || null
      const building = meetParts[1] || null
      const instructor = meetParts[6] || null
      const scheduleType = (meetParts[11] || '').replace(/<[^>]*>/g, '').trim() || null

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

    return {
      termCode: strm,
      termDesc: getTermDesc(strm, termRows),
      totalCount: sections.length,
      sections,
    }
  })
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
      } else {
        data = await getBannerSections(baseUrl, subject, courseNumber);
      }

      return Response.json({ success: true, terms: data }, { headers: CORS });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: CORS });
    }
  },
};
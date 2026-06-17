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
      const data = await searchColleagueSections(base, t, jar, term.Code, subject, courseNumber);
      console.log(`[Colleague] term=${term.Code} response:`, JSON.stringify(data).slice(0, 300));
      const sections = data.Sections || [];
      results.push({
        termCode: term.Code,
        termDesc: term.Description,
        totalCount: sections.length,
        sections: sections.map((s: any) => ({
          crn: s.Id,
          section: s.SectionNameDisplay || s.Number,
          campus: s.Location?.Description || null,
          title: s.Course?.Title || s.Title || null,
          units: s.Credits || null,
          scheduleType: s.InstructionalMethod?.Description || s.CourseType?.Description || null,
          enrollment: s.Enrolled || 0,
          maxEnrollment: s.Capacity || 0,
          seatsAvailable: s.AvailableSeats ?? (s.Capacity - s.Enrolled) ?? 0,
          waitCount: s.WaitlistCount || 0,
          waitAvailable: s.WaitlistCapacity ? (s.WaitlistCapacity - (s.WaitlistCount || 0)) : 0,
          openSection: (s.AvailableSeats ?? 0) > 0,
          instructor: s.Faculty?.[0]?.Name || null,
          meetings: s.Meetings?.map((m: any) => ({
            days: m.Days || null,
            startTime: m.StartTime || null,
            endTime: m.EndTime || null,
            building: m.Building?.Description || null,
            room: m.Room || null,
            startDate: m.StartDate || null,
            endDate: m.EndDate || null,
          })) || [],
        })),
      });
    } catch (e) {
      console.warn(`Colleague term ${term.Code} failed:`, e.message);
    }
  }
  return results;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    try {
      const { baseUrl, subject, courseNumber, system } = await req.json();
      if (!baseUrl || !subject || !courseNumber) {
        return Response.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
      }

      let data;
      if (system === "colleague") {
        data = await getColleagueSections(baseUrl, subject, courseNumber);
      } else {
        data = await getBannerSections(baseUrl, subject, courseNumber);
      }

      return Response.json({ success: true, terms: data }, { headers: CORS });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: CORS });
    }
  },
};
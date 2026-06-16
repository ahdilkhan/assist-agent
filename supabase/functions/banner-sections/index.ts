import "@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getSession(base: string) {
  const sessionRes = await fetch(`${base}/StudentRegistrationSsb/ssb/term/termSelection?mode=search`, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
    }
  });

  const cookieJar: Record<string, string> = {};
  sessionRes.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const [pair] = val.split(";");
      const [k, v] = pair.split("=");
      if (k && v) cookieJar[k.trim()] = v.trim();
    }
  });

  if (!cookieJar["JSESSIONID"]) throw new Error("No JSESSIONID — session failed");
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

async function fetchSections(base: string, cookieJar: Record<string, string>, subject: string, courseNumber: string, term: string) {
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

async function getTerms(base: string, cookieJar: Record<string, string>) {
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
  return await res.json(); // [{ code: "202601", description: "Summer 2026" }, ...]
}

async function getBannerSections(baseUrl: string, subject: string, courseNumber: string) {
  const base = baseUrl.replace(/\/$/, "");

  // Step 1: Get session
  const cookieJar = await getSession(base);

  // Step 2: Fetch all available terms
  const terms = await getTerms(base, cookieJar);
  if (!terms || terms.length === 0) throw new Error("No terms found");

  // Step 3: For each term, set term + fetch sections
  const results = [];
  for (const term of terms) {
    try {
      // Need fresh session per term search
      const jar = await getSession(base);
      await setTerm(base, jar, term.code);
      const data = await fetchSections(base, jar, subject, courseNumber, term.code);
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

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    try {
      const { baseUrl, subject, courseNumber } = await req.json();
      if (!baseUrl || !subject || !courseNumber) {
        return Response.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
      }

      const data = await getBannerSections(baseUrl, subject, courseNumber);
      return Response.json({ success: true, terms: data }, { headers: CORS });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: CORS });
    }
  },
};
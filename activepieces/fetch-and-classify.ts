// Activepieces "Code" step: Fetch + normalize + classify SA eTenders
// Inputs (set in the step's Inputs panel):
//   days_back  (number, default 2)  how many days of newly published tenders to fetch
//   page_size  (number, default 50)
//   max_pages  (number, default 20)
//   client_industries  (text, comma-separated, e.g. "ICT & Software, Consulting & Advisory")
//   client_provinces   (text, comma-separated, e.g. "Gauteng, Western Cape")
//   client_cidb_grade  (number 0-9, 0 = no CIDB grading)
//   shortlist_size     (number, default 15)
// Output: { run_date, fetched, open_count, shortlist_count, skipped_pages, client_profile, stats, shortlist: [...] }

// The eTenders API is flaky (random HTTP 500s, even on page 1), so every page is retried with back-off,
// a bad page is skipped instead of failing the whole run, and skipped pages are reported in the output.
const FETCH_ERRORS: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (attempt === 4) FETCH_ERRORS.push(`HTTP ${res.status}: ${url}`);
    } catch (e: any) {
      if (attempt === 4) FETCH_ERRORS.push(`${e.message}: ${url}`);
    }
    await sleep(1500 * attempt);
  }
  return null;
}

async function fetchReleases(inputs: any): Promise<any[]> {
  const daysBack = Number(inputs.days_back ?? 2);
  const pageSize = Number(inputs.page_size ?? 50);
  const maxPages = Number(inputs.max_pages ?? 20);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const all: any[] = [];
  // Query one day at a time: smaller requests fail less often on this API
  for (let d = daysBack; d >= 0; d--) {
    const day = fmt(new Date(Date.now() - d * 86400000));
    let failures = 0;
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://ocds-api.etenders.gov.za/api/OCDSReleases?PageNumber=${page}&PageSize=${pageSize}&dateFrom=${day}&dateTo=${day}`;
      const body = await getJSON(url);
      if (!body) { if (++failures >= 2) break; else continue; }
      failures = 0;
      const batch = Array.isArray(body) ? body : (body.releases || body.data || []);
      all.push(...batch);
      if (batch.length < pageSize || !(body.links && body.links.next)) break; // last page
    }
  }
  return all;
}

export const code = async (inputs: any) => {
  // ---------- Taxonomy (mirrors tender-radar/taxonomy.json) ----------
  const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
    'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
  const PROVINCE_ALIASES: Record<string, string> = { 'kzn': 'KwaZulu-Natal', 'kwazulu natal': 'KwaZulu-Natal', 'gp': 'Gauteng',
    'wc': 'Western Cape', 'ec': 'Eastern Cape', 'nw': 'North West', 'nc': 'Northern Cape', 'fs': 'Free State',
    // cities, metros & towns -> province (procuring entity names often only mention a place)
    'johannesburg': 'Gauteng', 'pretoria': 'Gauteng', 'tshwane': 'Gauteng', 'ekurhuleni': 'Gauteng', 'soweto': 'Gauteng', 'midrand': 'Gauteng', 'sedibeng': 'Gauteng', 'west rand': 'Gauteng', 'vaal': 'Gauteng',
    'cape town': 'Western Cape', 'stellenbosch': 'Western Cape', 'george': 'Western Cape', 'drakenstein': 'Western Cape', 'boland': 'Western Cape', 'overberg': 'Western Cape', 'west coast': 'Western Cape', 'cape winelands': 'Western Cape',
    'port elizabeth': 'Eastern Cape', 'gqeberha': 'Eastern Cape', 'nelson mandela bay': 'Eastern Cape', 'east london': 'Eastern Cape', 'buffalo city': 'Eastern Cape', 'mthatha': 'Eastern Cape', 'makhanda': 'Eastern Cape', 'walter sisulu': 'Eastern Cape', 'king sabata': 'Eastern Cape',
    'durban': 'KwaZulu-Natal', 'ethekwini': 'KwaZulu-Natal', 'pietermaritzburg': 'KwaZulu-Natal', 'msunduzi': 'KwaZulu-Natal', 'richards bay': 'KwaZulu-Natal', 'umhlathuze': 'KwaZulu-Natal', 'newcastle': 'KwaZulu-Natal', 'zululand': 'KwaZulu-Natal', 'mangosuthu': 'KwaZulu-Natal',
    'bloemfontein': 'Free State', 'mangaung': 'Free State', 'welkom': 'Free State', 'matjhabeng': 'Free State',
    'polokwane': 'Limpopo', 'thohoyandou': 'Limpopo', 'vhembe': 'Limpopo', 'capricorn': 'Limpopo', 'mopani': 'Limpopo', 'sekhukhune': 'Limpopo', 'waterberg': 'Limpopo',
    'mbombela': 'Mpumalanga', 'nelspruit': 'Mpumalanga', 'emalahleni': 'Mpumalanga', 'witbank': 'Mpumalanga', 'secunda': 'Mpumalanga', 'ehlanzeni': 'Mpumalanga', 'nkangala': 'Mpumalanga', 'gert sibande': 'Mpumalanga',
    'kimberley': 'Northern Cape', 'upington': 'Northern Cape', 'sol plaatje': 'Northern Cape', 'namakwa': 'Northern Cape',
    'mahikeng': 'North West', 'mafikeng': 'North West', 'rustenburg': 'North West', 'potchefstroom': 'North West', 'klerksdorp': 'North West', 'bojanala': 'North West', 'orbit tvet': 'North West' };

  const BUYER_TYPES: Record<string, string[]> = {
    'State-owned company': ['eskom', 'transnet', 'sanral', 'prasa', 'denel', 'saa', 'acsa', 'rand water', 'telkom', 'sabc', 'post office'],
    'Municipality / Metro': ['municipality', 'metropolitan', 'city of', 'district municipality', 'local municipality'],
    'University / TVET': ['university', 'tvet', 'college'],
    'Health facility': ['hospital', 'clinic'],
    'Provincial department': ['provincial', 'gauteng department', 'western cape government', 'kzn department', 'eastern cape department'],
    'National department': ['department of', 'national treasury', 'sars', 'statistics south africa'],
    'Public entity / Agency': ['agency', 'authority', 'board', 'council', 'fund', 'institute', 'commission', 'seta'],
  };

  const INDUSTRIES: Record<string, string[]> = {
    'Construction & Civil Works': ['construction', 'civil', 'road', 'building', 'renovation', 'paving', 'bridge', 'pipeline', 'sanitation', 'reservoir'],
    'ICT & Software': ['ict', 'software', 'network', 'server', 'licen', 'data centre', 'it services', 'cyber', 'laptop', 'computer', 'website', 'digital'],
    'Security Services': ['security services', 'guarding', 'cctv', 'access control', 'armed response'],
    'Cleaning & Facilities Management': ['cleaning', 'hygiene', 'pest control', 'facilities management', 'garden', 'waste removal'],
    'Medical & Pharmaceutical': ['medical', 'pharmaceutical', 'medicine', 'surgical', 'laboratory', 'dental', 'ppe'],
    'Consulting & Advisory': ['consult', 'advisory', 'feasibility', 'strategy', 'audit', 'valuation', 'research', 'evaluation study'],
    'Engineering & Electrical': ['electrical', 'mechanical', 'engineering', 'substation', 'transformer', 'hvac', 'generator', 'solar'],
    'Transport & Fleet': ['vehicle', 'fleet', 'transport', 'bus ', 'logistics', 'courier', 'tyre'],
    'Catering & Events': ['catering', 'food', 'events', 'venue', 'accommodation', 'conference'],
    'Training & Education': ['training', 'skills development', 'learnership', 'workshop', 'capacity building'],
    'Printing, Stationery & Office': ['printing', 'stationery', 'office furniture', 'toner', 'branding'],
    'Legal Services': ['legal', 'attorney', 'litigation', 'panel of attorneys'],
    'Financial Services': ['financial', 'insurance', 'banking', 'debt collection', 'actuarial', 'accounting'],
    'Energy & Water': ['energy', 'water', 'electricity', 'borehole', 'fuel', 'diesel'],
  };

  const FLAGS: [string, RegExp][] = [
    ['B-BBEE level required', /b-?bbee|bee level|broad[- ]based/i],
    ['Local content / production requirement', /local content|local production/i],
    ['CSD registration required', /\bcsd\b|central supplier database/i],
    ['Tax compliance (SARS PIN) required', /tax compliance|sars pin|tcs pin/i],
    ['CIDB grading required', /\bcidb\b/i],
    ['Professional registration (e.g. ECSA, SACPCMP)', /\becsa\b|sacpcmp|sacap|sacnasp|professional registration/i],
    ['Security clearance / PSIRA', /psira|security clearance/i],
    ['Site visit required', /site (visit|inspection)/i],
  ];

  // ---------- Helpers ----------
  const lc = (s: any): string => (s || '').toString().toLowerCase();
  // short keywords (<= 4 letters) must match a whole word, so 'ict' doesn't fire inside 'district'
  const has = (text: string, w: string) => (w.trim().length <= 4 ? new RegExp(`\\b${w.trim()}\\b`).test(text) : text.includes(w));
  const firstMatch = (text: string, dict: Record<string, string[]>, fallback: string) => {
    for (const [label, words] of Object.entries(dict)) {
      if (words.some((w) => has(text, w))) return label;
    }
    return fallback;
  };
  const allMatches = (text: string, dict: Record<string, string[]>) =>
    Object.entries(dict).filter(([, words]) => words.some((w) => has(text, w))).map(([label]) => label);

  function findProvince(...candidates: any[]) {
    const text = lc(candidates.filter(Boolean).join(' '));
    for (const p of PROVINCES) if (text.includes(lc(p))) return p;
    for (const [alias, p] of Object.entries(PROVINCE_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`).test(text)) return p;
    }
    return 'National / Unspecified';
  }

  function valueBand(amount: number | null) {
    if (amount == null || isNaN(amount) || amount <= 0) return 'Unknown';
    if (amount < 500000) return '< R500k';
    if (amount < 5000000) return 'R500k – R5m';
    if (amount < 50000000) return 'R5m – R50m';
    return '> R50m';
  }

  function urgency(days: number | null) {
    if (days == null) return 'Unknown closing date';
    if (days < 0) return 'Closed';
    if (days <= 3) return 'Closing within 3 days';
    if (days <= 7) return 'Closing within 7 days';
    if (days <= 14) return 'Closing within 14 days';
    return 'More than 14 days';
  }

  function procurementCategory(t: any, text: string, cats: string) {
    const c = lc(t.mainProcurementCategory || t.category || cats);
    if (c.includes('works')) return 'Works (construction)';
    if (/consult|professional/.test(text)) return 'Consultancy / Professional services';
    if (c.includes('goods')) return 'Goods';
    if (c.includes('services')) return 'Services';
    if (/disposal|lease|rental of/.test(text)) return 'Disposal / Lease';
    return t.category || t.mainProcurementCategory || 'Unspecified';
  }

  // ---------- Flatten input into a list of OCDS releases ----------
  const releases = await fetchReleases(inputs);

  // ---------- Map each release to a row ----------
  const today = new Date();
  const seen = new Set<string>();
  const rows: any[] = [];

  for (const r of releases) {
    const t = r.tender || {};
    const key = r.ocid || t.id;
    if (!key || seen.has(key)) continue; // de-duplicate
    seen.add(key);

    const description = t.description || '';
    // eTenders titles are often just a reference number (e.g. "RFQ 19-11-2026"); the description is the real title
    const reference = t.title || '';
    const title = description ? (description.length > 160 ? description.slice(0, 157) + '...' : description) : (reference || '(no title)');
    const buyer = (r.buyer && r.buyer.name) || (t.procuringEntity && t.procuringEntity.name) || '';
    const cats = Array.isArray(t.additionalProcurementCategories) ? t.additionalProcurementCategories.join(' ') : '';
    const text = lc(`${reference} ${description} ${t.category || ''} ${t.eligibilityCriteria || ''} ${t.specialConditions || ''}`);

    const closing = (t.tenderPeriod && t.tenderPeriod.endDate) || t.closingDate || null;
    const daysLeft = closing ? Math.ceil((new Date(closing).getTime() - today.getTime()) / 86400000) : null;

    const briefing = t.briefingSession || {};
    const briefingCompulsory = briefing.compulsory === true || /compulsory briefing/i.test(text);

    const cidbMatch = `${reference} ${description}`.match(/\b([1-9])\s*(CE|GB|EE|EB|ME|SB)\b/i);
    const amount = t.value && t.value.amount != null ? Number(t.value.amount) : null;

    const industries = allMatches(text, INDUSTRIES);
    const flags = FLAGS.filter(([, re]) => re.test(text)).map(([label]) => label);
    if (briefingCompulsory && !flags.includes('Compulsory briefing session')) flags.push('Compulsory briefing session');
    if (cidbMatch && !flags.includes('CIDB grading required')) flags.push('CIDB grading required');

    const docs = Array.isArray(t.documents) ? t.documents : [];

    rows.push({
        tender_id: t.id || '',
        reference,
        ocid: r.ocid || '',
        title,
        buyer,
        buyer_type: firstMatch(lc(buyer), BUYER_TYPES, 'Other public body'),
        province: findProvince(t.province, t.deliveryLocation, buyer, description),
        delivery_location: t.deliveryLocation || '',
        procurement_category: procurementCategory(t, text, cats),
        procurement_method: t.procurementMethodDetails || t.procurementMethod || '',
        industry_primary: industries[0] || 'Other',
        industries_all: industries.join('; '),
        cidb_grade: cidbMatch ? `${cidbMatch[1]}${cidbMatch[2].toUpperCase()}` : '',
        value_zar: amount,
        value_band: valueBand(amount),
        published: r.date || (t.tenderPeriod && t.tenderPeriod.startDate) || '',
        closing_date: closing || '',
        days_left: daysLeft,
        urgency: urgency(daysLeft),
        briefing_compulsory: briefingCompulsory ? 'Yes' : 'No',
        briefing_date: briefing.date || '',
        briefing_venue: briefing.venue || '',
        requirement_flags: flags.join('; '),
        status: t.status || '',
        document_count: docs.length,
        first_document_url: docs[0] ? docs[0].url || '' : '',
        contact: (t.contactPerson && (t.contactPerson.email || t.contactPerson.name)) || '',
        source_url: r.ocid ? `https://ocds-api.etenders.gov.za/api/OCDSReleases/release/${r.ocid}` : '',
        description: description.slice(0, 1500),
    });
  }

  // Open tenders first, soonest closing at the top
  rows.sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999));
  const open = rows.filter((r) => r.days_left === null || r.days_left >= 0);

  // ---------- Client-fit scoring (rule-based, transparent) ----------
  const list = (v: any) => (v ? String(v).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
  const profile = {
    industries: list(inputs.client_industries ?? 'ICT & Software, Consulting & Advisory'),
    provinces: list(inputs.client_provinces ?? 'Gauteng, Western Cape'),
    cidb: Number(inputs.client_cidb_grade ?? 0),
  };
  for (const r of open) {
    let score = 0;
    const why: string[] = [];
    const inds = lc(r.industries_all).split('; ').filter(Boolean);
    if (profile.industries.includes(lc(r.industry_primary))) { score += 40; why.push('core industry match'); }
    else if (inds.some((i: string) => profile.industries.includes(i))) { score += 25; why.push('secondary industry match'); }
    if (profile.provinces.includes(lc(r.province))) { score += 25; why.push(`in ${r.province}`); }
    else if (r.province === 'National / Unspecified') { score += 10; why.push('national/unspecified location'); }
    if (r.cidb_grade) {
      const g = Number(r.cidb_grade[0]);
      if (profile.cidb >= g) { score += 15; why.push(`CIDB ${r.cidb_grade} within grade`); }
      else { score -= 50; why.push(`needs CIDB ${r.cidb_grade} (client grade ${profile.cidb || 'none'})`); }
    }
    if (r.days_left !== null && r.days_left < 3) { score -= 15; why.push('closes in under 3 days'); }
    else if (r.days_left !== null && r.days_left >= 7) { score += 10; why.push('enough time to prepare'); }
    if (r.briefing_compulsory === 'Yes') why.push('compulsory briefing: check date');
    r.fit_score = score;
    r.fit_reasons = why.join('; ');
  }
  const size = Number(inputs.shortlist_size ?? 15);
  const shortlist = open.filter((r) => r.fit_score >= 40).sort((a, b) => b.fit_score - a.fit_score).slice(0, size)
    .map((r) => ({ title: r.title, buyer: r.buyer, buyer_type: r.buyer_type, province: r.province, industry: r.industry_primary,
      cidb_grade: r.cidb_grade, value_band: r.value_band, closing_date: r.closing_date, days_left: r.days_left,
      briefing_compulsory: r.briefing_compulsory, briefing_date: r.briefing_date, requirement_flags: r.requirement_flags,
      fit_score: r.fit_score, fit_reasons: r.fit_reasons, tender_id: r.tender_id, reference: r.reference, link: r.first_document_url || r.source_url,
      description: (r.description || '').slice(0, 300) }));

  // Keep the step output small: Activepieces drops step outputs that exceed its size limit,
  // so we return counts, summary stats and the shortlist, not all ~500 tenders.
  const countBy = (k: string) => Object.entries(open.reduce((a: any, t: any) => ((a[t[k]] = (a[t[k]] || 0) + 1), a), {}))
    .sort((a: any, b: any) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  const stats = {
    by_province: countBy('province'),
    by_industry: countBy('industry_primary'),
    by_buyer_type: countBy('buyer_type'),
    closing_within_7_days: open.filter((t) => t.days_left !== null && t.days_left <= 7).length,
  };
  return { run_date: today.toISOString().slice(0, 10), fetched: releases.length, open_count: open.length,
    shortlist_count: shortlist.length, skipped_pages: FETCH_ERRORS.length, fetch_errors: FETCH_ERRORS.slice(0, 5),
    client_profile: { industries: profile.industries.join(', '), provinces: profile.provinces.join(', '), cidb: profile.cidb },
    stats, shortlist };

};

// n8n Code node: "Normalize & classify tenders"
// Mode: Run Once for All Items
// Input: items from the eTenders OCDS API (either one item per page with a `releases` array,
//        or one item per release). Output: one clean row per tender, classified with the taxonomy.

// ---------- Taxonomy (mirrors tender-radar/taxonomy.json) ----------
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const PROVINCE_ALIASES = { 'kzn': 'KwaZulu-Natal', 'kwazulu natal': 'KwaZulu-Natal', 'gp': 'Gauteng',
  'wc': 'Western Cape', 'ec': 'Eastern Cape', 'nw': 'North West', 'nc': 'Northern Cape', 'fs': 'Free State' };

const BUYER_TYPES = {
  'State-owned company': ['eskom', 'transnet', 'sanral', 'prasa', 'denel', 'saa', 'acsa', 'rand water', 'telkom', 'sabc', 'post office'],
  'Municipality / Metro': ['municipality', 'metropolitan', 'city of', 'district municipality', 'local municipality'],
  'University / TVET': ['university', 'tvet', 'college'],
  'Health facility': ['hospital', 'clinic'],
  'Provincial department': ['provincial', 'gauteng department', 'western cape government', 'kzn department', 'eastern cape department'],
  'National department': ['department of', 'national treasury', 'sars', 'statistics south africa'],
  'Public entity / Agency': ['agency', 'authority', 'board', 'council', 'fund', 'institute', 'commission', 'seta'],
};

const INDUSTRIES = {
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

const FLAGS = [
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
const lc = (s) => (s || '').toString().toLowerCase();
const firstMatch = (text, dict, fallback) => {
  for (const [label, words] of Object.entries(dict)) {
    if (words.some((w) => text.includes(w))) return label;
  }
  return fallback;
};
const allMatches = (text, dict) =>
  Object.entries(dict).filter(([, words]) => words.some((w) => text.includes(w))).map(([label]) => label);

function findProvince(...candidates) {
  const text = lc(candidates.filter(Boolean).join(' '));
  for (const p of PROVINCES) if (text.includes(lc(p))) return p;
  for (const [alias, p] of Object.entries(PROVINCE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(text)) return p;
  }
  return 'National / Unspecified';
}

function valueBand(amount) {
  if (amount == null || isNaN(amount) || amount <= 0) return 'Unknown';
  if (amount < 500000) return '< R500k';
  if (amount < 5000000) return 'R500k – R5m';
  if (amount < 50000000) return 'R5m – R50m';
  return '> R50m';
}

function urgency(days) {
  if (days == null) return 'Unknown closing date';
  if (days < 0) return 'Closed';
  if (days <= 3) return 'Closing within 3 days';
  if (days <= 7) return 'Closing within 7 days';
  if (days <= 14) return 'Closing within 14 days';
  return 'More than 14 days';
}

function procurementCategory(t, text) {
  const c = lc(t.mainProcurementCategory || t.category);
  if (c.includes('works')) return 'Works (construction)';
  if (/consult|professional/.test(text)) return 'Consultancy / Professional services';
  if (c.includes('goods')) return 'Goods';
  if (c.includes('services')) return 'Services';
  if (/disposal|lease|rental of/.test(text)) return 'Disposal / Lease';
  return t.category || t.mainProcurementCategory || 'Unspecified';
}

// ---------- Flatten input into a list of OCDS releases ----------
const releases = [];
for (const item of $input.all()) {
  const j = item.json;
  if (Array.isArray(j.releases)) releases.push(...j.releases);
  else if (Array.isArray(j.data)) releases.push(...j.data);
  else if (j.ocid) releases.push(j);
}

// ---------- Map each release to a row ----------
const today = new Date();
const seen = new Set();
const rows = [];

for (const r of releases) {
  const t = r.tender || {};
  const key = r.ocid || t.id;
  if (!key || seen.has(key)) continue; // de-duplicate
  seen.add(key);

  const title = t.title || t.description || '(no title)';
  const description = t.description || '';
  const buyer = (r.buyer && r.buyer.name) || (t.procuringEntity && t.procuringEntity.name) || '';
  const text = lc(`${title} ${description} ${t.category || ''} ${t.eligibilityCriteria || ''} ${t.specialConditions || ''}`);

  const closing = (t.tenderPeriod && t.tenderPeriod.endDate) || t.closingDate || null;
  const daysLeft = closing ? Math.ceil((new Date(closing) - today) / 86400000) : null;

  const briefing = t.briefingSession || {};
  const briefingCompulsory = briefing.compulsory === true || /compulsory briefing/i.test(text);

  const cidbMatch = `${title} ${description}`.match(/\b([1-9])\s*(CE|GB|EE|EB|ME|SB)\b/i);
  const amount = t.value && t.value.amount != null ? Number(t.value.amount) : null;

  const industries = allMatches(text, INDUSTRIES);
  const flags = FLAGS.filter(([, re]) => re.test(text)).map(([label]) => label);
  if (briefingCompulsory && !flags.includes('Compulsory briefing session')) flags.push('Compulsory briefing session');
  if (cidbMatch && !flags.includes('CIDB grading required')) flags.push('CIDB grading required');

  const docs = Array.isArray(t.documents) ? t.documents : [];

  rows.push({
    json: {
      tender_id: t.id || '',
      ocid: r.ocid || '',
      title,
      buyer,
      buyer_type: firstMatch(lc(buyer), BUYER_TYPES, 'Other public body'),
      province: findProvince(t.province, t.deliveryLocation, buyer, title),
      delivery_location: t.deliveryLocation || '',
      procurement_category: procurementCategory(t, text),
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
    },
  });
}

// Open tenders first, soonest closing at the top
rows.sort((a, b) => (a.json.days_left ?? 9999) - (b.json.days_left ?? 9999));
return rows;

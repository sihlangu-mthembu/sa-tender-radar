// Activepieces "Code" step: Build the digest email from the shortlist + AI decisions
// Inputs:
//   data  -> {{step_1}}   (output of "Fetch, classify & score tenders")
//   ai    -> {{step_2}}   (AI answer: JSON with decisions)
// Output: { subject, html, text, go, maybe, no_go, ai_used }
//
// Design: the AI only returns small JSON decisions; this step renders the email.
// If the AI output is missing or not valid JSON, it falls back to the rule-based
// fit score (>=65 GO, 40-64 MAYBE), so a digest is always produced.

export const code = async (inputs: any) => {
  const parse = (v: any) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    const s = String(v).replace(/```(?:json)?/gi, '').trim();
    const start = s.search(/[\[{]/);
    if (start < 0) return null;
    try { return JSON.parse(s.slice(start)); } catch { return null; }
  };

  // Activepieces wraps each step's result as { output: ... }, so unwrap it if present
  const unwrap = (v: any) => {
    let x = parse(v);
    while (x && typeof x === 'object' && !Array.isArray(x) && 'output' in x && Object.keys(x).length <= 2) x = parse(x.output);
    return x;
  };
  const data = unwrap(inputs.data) || {};
  const shortlist: any[] = Array.isArray(data.shortlist) ? data.shortlist : [];
  const ai = unwrap(inputs.ai);
  const aiDecisions: any[] = ai ? (Array.isArray(ai) ? ai : ai.decisions || []) : [];
  const watchOut: string[] = ai && Array.isArray(ai.watch_out) ? ai.watch_out.slice(0, 3) : [];
  const byId = new Map(aiDecisions.map((d: any) => [String(d.tender_id), d]));
  const aiUsed = aiDecisions.length > 0;

  const rows = shortlist.map((t) => {
    const d: any = byId.get(String(t.tender_id));
    const fallback = t.fit_score >= 65 ? 'GO' : 'MAYBE';
    const decision = String((d && d.decision) || fallback).toUpperCase().replace('NO GO', 'NO-GO');
    const why = (d && d.why) || t.fit_reasons || '';
    return { ...t, decision, why };
  });
  const rank: Record<string, number> = { GO: 0, MAYBE: 1, 'NO-GO': 2 };
  rows.sort((a, b) => (rank[a.decision] ?? 3) - (rank[b.decision] ?? 3) || (a.days_left ?? 99) - (b.days_left ?? 99));

  const go = rows.filter((r) => r.decision === 'GO').length;
  const maybe = rows.filter((r) => r.decision === 'MAYBE').length;
  const noGo = rows.filter((r) => r.decision === 'NO-GO').length;
  const shown = rows.filter((r) => r.decision !== 'NO-GO');

  if (!watchOut.length) {
    const briefings = shown.filter((r) => r.briefing_compulsory === 'Yes').length;
    const urgent = shown.filter((r) => r.days_left !== null && r.days_left <= 5).length;
    if (urgent) watchOut.push(`${urgent} shortlisted tender(s) close within 5 days.`);
    if (briefings) watchOut.push(`${briefings} tender(s) have a compulsory briefing session; check the dates.`);
    watchOut.push('Most tenders publish no budget; check the documents before committing bid effort.');
  }

  const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '?');
  const colour: Record<string, string> = { GO: '#15803d', MAYBE: '#b45309' };
  const td = 'padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px;';

  const summary = `${go} GO, ${maybe} MAYBE, ${noGo} NO-GO from ${data.open_count ?? '?'} open tenders`;
  const tableRows = shown.map((r) => `
    <tr>
      <td style="${td}"><b style="color:${colour[r.decision] || '#374151'}">${r.decision}</b></td>
      <td style="${td}">${esc(r.title)}<br><span style="color:#6b7280;font-size:12px">${esc(r.reference)} · ${esc(r.industry)}</span></td>
      <td style="${td}">${esc(r.buyer)}</td>
      <td style="${td}">${esc(r.province)}</td>
      <td style="${td}">${fmtDate(r.closing_date)}<br><span style="color:#6b7280;font-size:12px">${r.days_left ?? '?'} days</span></td>
      <td style="${td}">${esc(r.why)}</td>
      <td style="${td}"><a href="${esc(r.link)}">View documents</a></td>
    </tr>`).join('');

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:900px">
  <h2 style="margin:0 0 4px">SA Tender Radar: ${esc(data.run_date || '')}</h2>
  <p style="margin:0 0 4px;font-size:15px"><b>${summary}</b></p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:12px">Client profile: ${esc(data.client_profile?.industries)} | ${esc(data.client_profile?.provinces)} | CIDB ${esc(data.client_profile?.cidb)}. Scanned ${data.fetched ?? '?'} tenders${data.skipped_pages ? `; ${data.skipped_pages} source page(s) skipped after retries` : ''}. Decisions by ${aiUsed ? 'AI bid manager' : 'rules engine (AI unavailable)'}.</p>
  ${shown.length ? `<table style="border-collapse:collapse;width:100%">
    <tr style="background:#f3f4f6;text-align:left;font-size:12px">
      <th style="padding:8px">Decision</th><th style="padding:8px">Tender</th><th style="padding:8px">Buyer</th><th style="padding:8px">Province</th><th style="padding:8px">Closes</th><th style="padding:8px">Why</th><th style="padding:8px">Link</th>
    </tr>${tableRows}</table>` : '<p>No tenders matched the client profile today. Consider widening the industries or provinces.</p>'}
  <h3 style="margin:20px 0 6px;font-size:15px">Watch out</h3>
  <ul style="margin:0;padding-left:18px;font-size:13px">${watchOut.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
  <p style="margin-top:20px;color:#9ca3af;font-size:11px">Source: National Treasury eTenders OCDS API. Automated by SA Tender Radar.</p>
</div>`;

  const text = [`SA Tender Radar: ${data.run_date || ''}`, summary, '',
    ...shown.map((r) => `${r.decision} | ${r.title} | ${r.buyer} | ${r.province} | closes ${fmtDate(r.closing_date)} (${r.days_left ?? '?'}d)\n  ${r.why}\n  ${r.link}`),
    '', 'Watch out:', ...watchOut.map((w) => `- ${w}`)].join('\n');

  return { subject: `SA Tender Radar: ${summary}`, html, text, go, maybe, no_go: noGo, ai_used: aiUsed };
};

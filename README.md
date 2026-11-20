# SA Tender Radar 🇿🇦
**An automated workflow that scans every new South African government tender each morning, classifies it, scores it against a client's profile, and emails an AI-written GO / MAYBE / NO-GO digest.**

Built on **Activepieces Cloud** (runs 24/7, no server) · TypeScript code step · built-in AI step · Gmail

---

## The problem
SMEs and consultancies that bid for public-sector work have to check eTenders, municipal portals and SOE sites by hand. Hundreds of tenders are published every week, titles are often just reference numbers ("RFQ 19-11-2026"), and the useful details (province, industry, CIDB grade, compulsory briefings) are buried in free text. Good opportunities get missed and staff waste hours a week reading irrelevant ones.

## What it does
```
Every weekday 07:00 (SAST)
   │
   ▼
1. Fetch, classify & score (TypeScript)
   • Pulls all new tenders from the National Treasury eTenders OCDS API (day by day, paginated)
   • Retries flaky API pages with back-off and reports skipped pages instead of crashing
   • Normalises each tender and tags it with a taxonomy:
       province (incl. 80+ city/municipality → province mappings), buyer type
       (municipality, SOE, national dept, TVET…), 14 industries, procurement category,
       CIDB grade, value band, closing-date urgency, requirement flags
       (B-BBEE, CSD, tax compliance, CIDB, PSIRA, compulsory briefing, site visit…)
   • Scores each open tender 0–100 against a client profile (industries, provinces, CIDB grade)
     with human-readable reasons, and keeps a shortlist
   │
   ▼
2. AI bid manager (Activepieces AI step)
   • Decides GO / MAYBE / NO-GO per shortlisted tender, with a one-line reason
   • Returns compact JSON only (plus up to 3 "watch out" risks)
   │
   ▼
3. Build digest email (TypeScript)
   • Merges AI decisions with the tender data and renders a styled HTML email
   • Falls back to the rule-based scores if the AI returns nothing, so a digest always goes out
   │
   ▼
4. Gmail → digest lands in the inbox
```

## Real results (live run, 19 Nov 2026)
| Metric | Value |
|---|---|
| Tenders fetched (≈4 days) | **464** |
| Still open | **461** |
| Shortlisted for sample client (ICT + Consulting, Gauteng + Western Cape) | **15** |
| API pages that failed after retries (skipped, reported) | 2 |

End-to-end test run (19 Nov 2026, 22:41): **462 open tenders → 15 shortlisted → AI: 2 GO, 6 MAYBE, 7 NO-GO → digest emailed** (≈1.5 minutes total).

Top matches included a Microsoft Dynamics licence renewal (National Youth Development Agency), 100 laptops (NRCS) and VAT/payroll consulting (Cape Winelands District Municipality).

## Design decisions (why it's built this way)
- **Rules first, AI second.** Deterministic code scores all ~460 tenders for free and explains *why*. The AI only reviews the top 15, so one AI call per day keeps it inside a free plan and makes decisions auditable.
- **Defensive data handling.** The government API returns random HTTP 500s, so the workflow fetches day by day in small pages, retries with back-off, and never fails the whole run because of one bad page.
- **Real-world data quirks handled.** eTenders titles are usually reference numbers, so the description is used as the title. Province is rarely supplied, so it's inferred from buyer names and towns. Short keywords use whole-word matching ("ict" no longer matches "district").
- **AI decides, code renders.** Asking the model to write a long HTML email was unreliable (it stopped after a few characters). The AI now returns small JSON decisions and a code step builds the email, which is cheaper, consistent and testable.
- **Payload limits respected.** Activepieces drops step outputs that are too large, so the fetch step passes on counts, summary stats and the shortlist rather than all ~460 tenders (≈15 KB instead of ≈700 KB).
- **Configurable per client.** Industries, provinces, CIDB grade and shortlist size are step inputs, so a new client takes about a minute.

## Files
| File | What it is |
|---|---|
| `activepieces/fetch-and-classify.ts` | The code step (fetch, taxonomy, scoring) |
| `activepieces/ai-prompt.txt` | The AI bid-manager prompt (returns JSON) |
| `activepieces/build-digest.ts` | Code step that renders the HTML/text digest, with rules-based fallback |
| `taxonomy.json` | The classification taxonomy (provinces, buyer types, industries, CIDB, flags) |
| `code/normalize-and-classify.js` | Platform-neutral version of the classifier (e.g. for an n8n Code node) |
| `LOOM-SCRIPT.md` | 2–3 minute demo video script |

## Ideas for v2
- Store every tender in a table/sheet to build a searchable history and spot buyer trends
- Use AI to classify tenders the keyword rules label "Other" (~40%)
- Read the tender PDF to extract CIDB/B-BBEE requirements and compulsory-briefing dates
- Telegram/WhatsApp alerts for GO tenders closing within 7 days

*Data source: National Treasury eTenders OCDS API (Open Data Commons PDDL). Note: the eTenders feed is not a complete record of all SA procurement; some entities publish elsewhere.*

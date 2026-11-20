# Loom script: SA Tender Radar (target 2½ minutes)

**Before recording:** open (1) the Activepieces flow, (2) the latest run's output, (3) the digest email in Gmail. Close other tabs.

---

**0:00–0:20 The problem** *(show the eTenders website)*
"Hi, I'm Sihlangu. Companies that bid for South African government work have to dig through hundreds of tenders a week, most titled with just a reference number. Good opportunities get missed, and people waste hours reading irrelevant ones. So I automated it."

**0:20–0:55 The workflow** *(show the Activepieces canvas, hover each step)*
"This runs every weekday at 7am in the cloud. Step one pulls every new tender from National Treasury's eTenders API. The API is unreliable, so I built in retries and it skips bad pages instead of crashing. It then classifies each tender: province, buyer type, industry, CIDB grade, and flags like B-BBEE, CSD or compulsory briefings. Then it scores every tender from 0 to 100 against the client's profile."

**0:55–1:25 Show the data** *(open step 1's output)*
"On a live run it scanned 464 tenders, 461 still open, and shortlisted 15 for an ICT and consulting client in Gauteng and the Western Cape. Each one has a score and the reasons, so it's transparent, not a black box."

**1:25–1:55 The AI step** *(open step 2)*
"Only the top 15 go to the AI, which acts as a bid manager. It decides GO, MAYBE or NO-GO and writes the email. Doing the rules first means one AI call a day instead of hundreds, so it's cheap and auditable."

**1:55–2:20 The result** *(show the Gmail digest)*
"And this is what lands in the inbox every morning: a summary, a decision table with closing dates and links to the documents, and a short list of risks."

**2:20–2:35 Close**
"Changing the client takes a minute: just edit the industries, provinces and CIDB grade. I can build the same kind of monitoring for jobs, regulations, competitor news or anything with a data feed. Thanks for watching."

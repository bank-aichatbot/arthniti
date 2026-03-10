# ArthNiti — GenAI + RAG Engine for Banking Policies

**Live URL:** https://bank-aichatbot.github.io/arthniti/  
**Cloudflare Worker:** https://arthniti.animesh-him.workers.dev/

> AI-powered RAG chatbot for RBI regulations and Indian banking compliance.

---

## Setup (once)

### 1. GitHub Repo
- Repo name: `arthniti` under account `bank-aichatbot`
- Enable GitHub Pages → Source: `main` branch → `/ (root)`

### 2. Cloudflare Worker
- Deploy `cloudflare-worker.js` to your Worker at `arthniti.animesh-him.workers.dev`
- In Cloudflare Dashboard → Worker → Settings → Variables → Add Secret:
  - Name: `GEMINI_KEY`
  - Value: your Gemini API key (get from https://aistudio.google.com/app/apikey)

### 3. First Scrape
- GitHub → Actions tab → "ArthNiti - Scrape RBI Documents" → Run workflow
- This builds the knowledge base in `data/docs/` (takes 15-30 minutes)
- After it completes, the chatbot is fully functional

---

## File Structure

```
arthniti/
├── index.html              ← Chatbot page (also landing page)
├── changes.html            ← Regulation changes tracker
├── scrape.js               ← Node.js scraper (runs via GitHub Actions)
├── cloudflare-worker.js    ← Deploy separately to Cloudflare
├── package.json
├── .github/workflows/
│   └── scrape.yml          ← Monthly + manual trigger
├── data/
│   ├── index.json          ← Master metadata (auto-generated)
│   ├── changelog.json      ← Change log (auto-generated)
│   └── docs/
│       ├── kyc.json        ← Chunked KYC direction text
│       ├── iracp.json      ← IRACP norms
│       └── ...             ← one file per document
└── snapshots/
    └── YYYY-MM/
        └── [id].json       ← Monthly snapshots (max 6 per doc)
```

---

## How It Works

1. **Scraper** fetches RBI listing pages, finds documents by keyword matching
2. Extracts text from HTML or PDF (quality-validated — no garbage data)
3. Computes SHA-256 hash — **only writes if content changed**
4. Saves chunked JSON per document + monthly snapshot
5. Prunes to max 6 snapshots per document (oldest deleted)
6. Changelog keeps max 6 entries per document

**Chatbot:**
- Loads `data/index.json` (metadata only) on launch
- For each query: scores all 35 docs → fetches top 5 → scores chunks → feeds to Gemini
- Always shows source: document name, section, page, RBI update date
- Bilingual: EN / हिंदी (Hindi)

---

## Covered Documents (35 RBI Master Directions)

| Category | Count |
|---|---|
| Customer & Account Operations | 5 |
| Credit & NPA Management | 7 |
| Compliance & AML | 4 |
| Digital & Payments | 4 |
| Treasury & Investments | 4 |
| Capital & Regulatory Reporting | 3 |
| Customer Service & Grievance | 3 |
| Foreign Exchange (FEMA) | 3 |
| **Total** | **35** |

---

*Created by Animesh*

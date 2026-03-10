/**
 * ArthNiti — RBI Document Scraper
 * Runs via GitHub Actions monthly + on-demand
 * Only writes data when content has changed (hash-based)
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const DELAY_MS          = 3000;
const MAX_SNAPSHOTS     = 6;       // per document
const MAX_CHANGELOG     = 6;       // per document
const MIN_QUALITY_CHARS = 500;     // below this = garbage / skip
const MAX_GARBAGE_RATIO = 0.18;    // garbled chars / total chars
const CHUNK_SIZE        = 900;     // chars per RAG chunk
const MAX_CONTENT_CHARS = 80000;   // per document (prevent giant files)
const FORCE_REFRESH     = process.env.FORCE_REFRESH === 'true';

const DATA_DIR      = path.join(__dirname, 'data');
const DOCS_DIR      = path.join(__dirname, 'data', 'docs');
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const INDEX_FILE    = path.join(DATA_DIR, 'index.json');
const CHANGELOG_FILE= path.join(DATA_DIR, 'changelog.json');

const RBI_BASE   = 'https://rbi.org.in/scripts';
const RBIDOCS    = 'https://rbidocs.rbi.org.in';

// ─── 35 Target Documents ─────────────────────────────────────────────────────
const TARGET_DOCS = [
  // Category A: Customer & Account Operations
  { id:'kyc',               title:'RBI (Commercial Banks) Know Your Customer (KYC) Directions',           category:'Customer & Account Operations',   keywords:['know your customer','kyc'],                                     listing:'did=403' },
  { id:'loans-statutory',   title:'Master Direction – Loans and Advances – Statutory and Other Restrictions', category:'Customer & Account Operations',keywords:['loans and advances','statutory restrictions'],                 listing:'did=403' },
  { id:'interest-advances', title:'Master Direction – Interest Rate on Advances',                          category:'Customer & Account Operations',   keywords:['interest rate on advances','mclr','external benchmark'],        listing:'did=403' },
  { id:'non-fund-based',    title:'RBI (Non-Fund Based Credit Facilities) Directions, 2025',              category:'Customer & Account Operations',   keywords:['non-fund based','bank guarantee','letter of credit'],           listing:'did=403' },
  { id:'wilful-defaulters', title:'Master Direction – Wilful Defaulters and Large Defaulters',            category:'Customer & Account Operations',   keywords:['wilful defaulter','large defaulter'],                          listing:'did=403' },

  // Category B: Credit & NPA Management
  { id:'iracp',             title:'Master Circular – Prudential Norms on Income Recognition, Asset Classification and Provisioning (IRACP)', category:'Credit & NPA Management', keywords:['income recognition','asset classification','provisioning','iracp','npa'], listing:'did=403' },
  { id:'stressed-assets',   title:'Master Direction – Prudential Framework for Resolution of Stressed Assets', category:'Credit & NPA Management',  keywords:['stressed assets','resolution framework','ica'],                listing:'did=403' },
  { id:'agriculture-gcc',   title:'Master Direction – Credit Flow to Agriculture and General Credit Card Scheme', category:'Credit & NPA Management',keywords:['agriculture','general credit card','gcc','kcc'],               listing:'did=343' },
  { id:'priority-sector',   title:'Master Direction – Priority Sector Lending Targets and Classification', category:'Credit & NPA Management',       keywords:['priority sector','psl','anbc','weaker section'],               listing:'did=403' },
  { id:'msme',              title:'Master Direction – Lending to Micro, Small and Medium Enterprises',    category:'Credit & NPA Management',        keywords:['micro small medium','msme'],                                    listing:'did=403' },
  { id:'microfinance',      title:'Master Direction – Microfinance Loans',                                category:'Credit & NPA Management',        keywords:['microfinance','shg','jlg','self help group'],                  listing:'did=403' },
  { id:'housing-finance',   title:'Master Direction – Housing Finance',                                   category:'Credit & NPA Management',        keywords:['housing','home loan','ltv ratio','real estate'],               listing:'did=403' },
  { id:'securitisation',    title:'RBI (Securitisation of Standard Assets) Directions, 2021',             category:'Credit & NPA Management',        keywords:['securitisation','mrr','pass through','ptc'],                   listing:'did=403' },
  { id:'large-exposures',   title:'Master Direction – Large Exposures Framework',                         category:'Credit & NPA Management',        keywords:['large exposure','single borrower','group borrower'],           listing:'did=403' },

  // Category C: Compliance & AML
  { id:'aml-cft',           title:'Master Direction – Anti-Money Laundering and Combating Financing of Terrorism (AML/CFT)', category:'Compliance & AML', keywords:['anti-money laundering','aml','cft','fiu','str','ctr'],    listing:'did=403' },
  { id:'fraud-reporting',   title:'Master Direction – Frauds – Classification and Reporting by Commercial Banks', category:'Compliance & AML',        keywords:['fraud','classification','reporting'],                          listing:'did=415' },
  { id:'corp-governance',   title:'Master Direction – Corporate Governance in Banks',                     category:'Compliance & AML',               keywords:['corporate governance','board of directors','independent director'], listing:'did=403' },
  { id:'compensation',      title:'Master Direction – Compensation of Whole Time Directors / CEOs / Material Risk Takers', category:'Compliance & AML', keywords:['compensation','variable pay','malus','clawback','whole time director'], listing:'did=403' },

  // Category D: Digital & Payments
  { id:'digital-pay-sec',   title:'Master Direction – Digital Payment Security Controls',                 category:'Digital & Payments',             keywords:['digital payment security','mobile banking','authentication'],  listing:'did=344' },
  { id:'digital-lending',   title:'Master Direction – Digital Lending',                                  category:'Digital & Payments',             keywords:['digital lending','lsp','kfs','apr','lending service provider'], listing:'did=403' },
  { id:'ppi',               title:'Master Direction – Prepaid Payment Instruments',                       category:'Digital & Payments',             keywords:['prepaid payment','ppi','wallet','prepaid card'],               listing:'did=344' },
  { id:'payment-auth',      title:'Master Direction – Authorisation of Payment Systems',                  category:'Digital & Payments',             keywords:['authorisation','payment system','certificate of authorisation'],listing:'did=344' },

  // Category E: Treasury & Investments
  { id:'investment-port',   title:'Master Direction – Classification, Valuation and Operation of Investment Portfolio', category:'Treasury & Investments', keywords:['investment portfolio','htm','afs','hft','fair value','mtm'], listing:'did=403' },
  { id:'liquidity-lcr',     title:'Master Direction – Liquidity Risk Management Framework and Liquidity Coverage Ratio', category:'Treasury & Investments', keywords:['liquidity','lcr','hqla','liquidity coverage ratio'],       listing:'did=403' },
  { id:'irrbb',             title:'Master Direction – Interest Rate Risk in Banking Book (IRRBB)',         category:'Treasury & Investments',         keywords:['interest rate risk','irrbb','eve','nii','duration gap'],       listing:'did=403' },
  { id:'primary-dealers',   title:'Master Direction – Operational Guidelines for Primary Dealers',         category:'Treasury & Investments',         keywords:['primary dealer','government securities','g-sec'],             listing:'did=334' },

  // Category F: Capital & Regulatory Reporting
  { id:'basel3',            title:'Master Circular – Basel III Capital Regulations',                      category:'Capital & Regulatory Reporting',  keywords:['basel','cet1','tier 1','capital adequacy','crar'],             listing:'did=403' },
  { id:'op-risk',           title:'Master Direction – Minimum Capital Requirements for Operational Risk', category:'Capital & Regulatory Reporting',  keywords:['operational risk','basic indicator','bia','sma'],             listing:'did=403' },
  { id:'reg-reporting',     title:'Master Direction – Regulatory Reporting by Commercial Banks',           category:'Capital & Regulatory Reporting',  keywords:['regulatory reporting','returns','xbrl','osmos'],              listing:'did=403' },

  // Category G: Customer Service & Grievance
  { id:'customer-service',  title:'Master Direction – Customer Service in Banks',                         category:'Customer Service & Grievance',   keywords:['customer service','nomination','locker','deceased account'],   listing:'did=338' },
  { id:'ombudsman-2023',    title:'RBI (Internal Ombudsman for Regulated Entities) Directions, 2023',     category:'Customer Service & Grievance',   keywords:['internal ombudsman','regulated entities','2023'],             listing:'did=338' },
  { id:'ombudsman-2026',    title:'RBI (Commercial Banks Internal Ombudsman) Directions, 2026',           category:'Customer Service & Grievance',   keywords:['internal ombudsman','commercial banks','2026'],               listing:'did=338' },

  // Category H: Foreign Exchange (FEMA)
  { id:'fema-export',       title:'Master Direction – Export of Goods and Services (FEMA)',               category:'Foreign Exchange (FEMA)',        keywords:['export','edpms','realisation','goods and services'],           listing:'did=335' },
  { id:'fema-import',       title:'Master Direction – Import of Goods and Services (FEMA)',               category:'Foreign Exchange (FEMA)',        keywords:['import','idpms','advance remittance','suppliers credit'],      listing:'did=335' },
  { id:'fema-remittance',   title:'Master Direction – Remittance of Assets (FEMA)',                       category:'Foreign Exchange (FEMA)',        keywords:['remittance','lrs','liberalised remittance','outward remittance','nri'], listing:'did=335' },
];

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getCurrentYearMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── Quality Validator ────────────────────────────────────────────────────────
function isGoodQuality(text) {
  if (!text || text.length < MIN_QUALITY_CHARS) return false;
  const printable = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  const garbageRatio = 1 - (printable.length / text.length);
  if (garbageRatio > MAX_GARBAGE_RATIO) return false;
  // Must have real words (at least 50 alphabet sequences of length 3+)
  const wordMatches = text.match(/[a-zA-Z]{3,}/g);
  if (!wordMatches || wordMatches.length < 50) return false;
  return true;
}

// ─── Text Chunker ─────────────────────────────────────────────────────────────
function chunkText(rawText, docTitle) {
  // Clean up
  let text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_CONTENT_CHARS);

  const chunks = [];
  // Split by section headings: lines that start with number patterns or CHAPTER/PART
  const sectionPattern = /^(?:\d+\.[\d\.]*\s+[A-Z]|Chapter\s+\w+|CHAPTER\s+\w+|Part\s+\w+|PART\s+\w+|Section\s+\d|SECTION\s+\d|Annex|ANNEX|Schedule|SCHEDULE)/im;

  const paragraphs = text.split(/\n\n+/);
  let currentSection = 'Introduction';
  let currentText = '';
  let pageEstimate = 1;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Detect page markers like "Page 5 of 120" or "- 5 -"
    const pageMatch = trimmed.match(/[Pp]age\s+(\d+)\s+of\s+\d+/) || trimmed.match(/^-\s*(\d+)\s*-$/);
    if (pageMatch) {
      pageEstimate = parseInt(pageMatch[1]) || pageEstimate;
      continue;
    }

    // Detect section heading
    if (sectionPattern.test(trimmed) && trimmed.length < 120) {
      // Save current chunk if substantial
      if (currentText.length >= 100) {
        chunks.push({ section: currentSection, page: pageEstimate, text: currentText.trim() });
      }
      currentSection = trimmed.slice(0, 100);
      currentText = '';
      continue;
    }

    currentText += (currentText ? '\n' : '') + trimmed;

    // If chunk is large enough, save and start new
    if (currentText.length >= CHUNK_SIZE) {
      chunks.push({ section: currentSection, page: pageEstimate, text: currentText.trim() });
      currentText = '';
      pageEstimate++;
    }
  }

  if (currentText.length >= 100) {
    chunks.push({ section: currentSection, page: pageEstimate, text: currentText.trim() });
  }

  return chunks;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────
async function fetchWithRetry(url, options = {}, retries = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; ArthNitiBot/1.0; +https://bank-aichatbot.github.io/arthniti)',
    'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
    ...options.headers
  };
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, headers, timeout: 30000 });
      if (res.ok) return res;
      if (res.status === 429 || res.status === 503) {
        log(`  Rate limited (${res.status}), waiting 10s...`);
        await sleep(10000);
      } else {
        log(`  HTTP ${res.status} for ${url}`);
        return null;
      }
    } catch (err) {
      log(`  Fetch error (attempt ${i+1}): ${err.message}`);
      if (i < retries - 1) await sleep(5000);
    }
  }
  return null;
}

async function fetchHTML(url) {
  const res = await fetchWithRetry(url);
  if (!res) return null;
  const html = await res.text();
  return cheerio.load(html);
}

async function fetchAndExtractPDF(url) {
  log(`    Downloading PDF: ${url}`);
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/pdf' } });
  if (!res) return null;
  try {
    const buffer = await res.buffer();
    const data = await pdfParse(buffer, { max: 0 }); // max:0 = all pages
    return data.text || null;
  } catch (err) {
    log(`    PDF parse error: ${err.message}`);
    return null;
  }
}

// ─── RBI Listing Parser ────────────────────────────────────────────────────────
async function fetchListingLinks(listingParam) {
  const url = `${RBI_BASE}/BS_ViewMasterDirections.aspx?${listingParam}`;
  log(`  Fetching listing: ${url}`);
  const $ = await fetchHTML(url);
  if (!$) return [];

  const links = [];
  $('a[href*="BS_ViewMasDirections.aspx"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    const idMatch = href.match(/[?&]id=(\d+)/i);
    if (idMatch && title.length > 5) {
      links.push({
        rbiId: idMatch[1],
        title,
        url: `${RBI_BASE}/${href.replace(/^\.\.\/scripts\//, '').replace(/^scripts\//, '').replace(/^\/scripts\//, '')}`
      });
    }
  });

  // Also find PDF links nearby
  $('a[href*=".PDF"], a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('rbidocs')) links.push({ pdfUrl: href, title: $(el).closest('tr').find('a[href*="ViewMas"]').first().text().trim() });
  });

  log(`    Found ${links.length} links`);
  return links;
}

// ─── Document Content Extractor ───────────────────────────────────────────────
async function extractDocumentContent(docPageUrl) {
  const $ = await fetchHTML(docPageUrl);
  if (!$) return { text: null, pdfUrl: null, rbiLastUpdated: null };

  // Try to find PDF link
  let pdfUrl = null;
  $('a[href*=".PDF"], a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('rbidocs') || href.includes('notification')) {
      pdfUrl = href.startsWith('http') ? href : `https://rbi.org.in${href}`;
    }
  });

  // Extract date if present
  let rbiLastUpdated = null;
  const datePattern = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i;
  const bodyText = $('body').text();
  const dateMatch = bodyText.match(datePattern);
  if (dateMatch) rbiLastUpdated = dateMatch[1];

  // Extract HTML text from main content
  let htmlText = null;
  const contentSelectors = ['#mainsection', '.content', '#content', 'table.tablebg', 'td.tabledata'];
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 200) {
      htmlText = el.text().replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return { text: htmlText, pdfUrl, rbiLastUpdated };
}

// ─── Find Best Match ──────────────────────────────────────────────────────────
function findBestMatch(target, listingLinks) {
  let bestScore = 0;
  let bestLink = null;

  for (const link of listingLinks) {
    const linkTitleLower = (link.title || '').toLowerCase();
    let score = 0;
    for (const kw of target.keywords) {
      if (linkTitleLower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLink = link;
    }
  }

  // Require at least 1 keyword match
  return bestScore >= 1 ? bestLink : null;
}

// ─── Snapshot Management ──────────────────────────────────────────────────────
function pruneSnapshots(docId) {
  const docSnaps = [];
  if (!fs.existsSync(SNAPSHOTS_DIR)) return;

  for (const month of fs.readdirSync(SNAPSHOTS_DIR).sort()) {
    const file = path.join(SNAPSHOTS_DIR, month, `${docId}.json`);
    if (fs.existsSync(file)) docSnaps.push({ month, file });
  }

  // Keep only MAX_SNAPSHOTS newest, delete rest
  while (docSnaps.length > MAX_SNAPSHOTS) {
    const oldest = docSnaps.shift();
    fs.unlinkSync(oldest.file);
    log(`    Pruned old snapshot: ${oldest.month}/${docId}.json`);
    // Remove dir if empty
    const dir = path.join(SNAPSHOTS_DIR, oldest.month);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function getSnapshotDates(docId) {
  const dates = [];
  if (!fs.existsSync(SNAPSHOTS_DIR)) return dates;
  for (const month of fs.readdirSync(SNAPSHOTS_DIR).sort()) {
    if (fs.existsSync(path.join(SNAPSHOTS_DIR, month, `${docId}.json`))) {
      dates.push(month);
    }
  }
  return dates;
}

// ─── Changelog Management ─────────────────────────────────────────────────────
function addChangelogEntry(changelog, entry) {
  changelog.push(entry);

  // Keep max MAX_CHANGELOG entries per docId
  const byDoc = {};
  for (const e of changelog) {
    if (!byDoc[e.docId]) byDoc[e.docId] = [];
    byDoc[e.docId].push(e);
  }

  const pruned = [];
  for (const docId of Object.keys(byDoc)) {
    const entries = byDoc[docId].sort((a, b) => new Date(b.changeDate) - new Date(a.changeDate));
    pruned.push(...entries.slice(0, MAX_CHANGELOG));
  }

  return pruned.sort((a, b) => new Date(b.changeDate) - new Date(a.changeDate));
}

// ─── Process One Document ─────────────────────────────────────────────────────
async function processDocument(target, allListings, existingIndex) {
  log(`\nProcessing: ${target.id}`);

  const links = allListings[target.listing] || [];
  const matched = findBestMatch(target, links);

  if (!matched) {
    log(`  ⚠ No match found on listing page for: ${target.title}`);
    return { status: 'not_found', docId: target.id };
  }

  log(`  ✓ Matched: "${matched.title.slice(0, 70)}..."`);

  // Build doc page URL
  const docPageUrl = matched.url && matched.url.includes('http')
    ? matched.url
    : `${RBI_BASE}/${matched.url}`;

  await sleep(DELAY_MS);

  const { text: htmlText, pdfUrl, rbiLastUpdated } = await extractDocumentContent(docPageUrl);

  let rawText = null;
  let sourceType = 'html';

  // Prefer PDF if available
  if (pdfUrl) {
    await sleep(DELAY_MS);
    const pdfText = await fetchAndExtractPDF(pdfUrl);
    if (pdfText && isGoodQuality(pdfText)) {
      rawText = pdfText;
      sourceType = 'pdf';
      log(`  ✓ PDF extracted (${rawText.length} chars)`);
    } else if (pdfText) {
      log(`  ⚠ PDF quality check failed, trying HTML fallback`);
    }
  }

  // Fallback to HTML
  if (!rawText && htmlText && isGoodQuality(htmlText)) {
    rawText = htmlText;
    sourceType = 'html';
    log(`  ✓ HTML extracted (${rawText.length} chars)`);
  }

  if (!rawText) {
    log(`  ✗ SKIPPED — no good quality content found`);
    return { status: 'skipped', docId: target.id, reason: 'quality_check_failed' };
  }

  // Hash and compare
  const contentHash = sha256(rawText);
  const existing = existingIndex.docs.find(d => d.id === target.id);

  if (!FORCE_REFRESH && existing && existing.hash === contentHash) {
    log(`  → No change detected (hash match)`);
    return { status: 'unchanged', docId: target.id };
  }

  log(`  ✓ Content changed — writing files`);

  // Chunk the text
  const chunks = chunkText(rawText, target.title);
  log(`  ✓ ${chunks.length} chunks created`);

  const yearMonth = getCurrentYearMonth();
  const now = new Date().toISOString();

  // Build doc data object
  const docData = {
    id: target.id,
    title: target.title,
    category: target.category,
    sourceUrl: docPageUrl,
    pdfUrl: pdfUrl || null,
    rbiLastUpdated: rbiLastUpdated || 'See source',
    ourSnapshot: yearMonth,
    snapshotDate: now,
    sourceType,
    totalChunks: chunks.length,
    chunks
  };

  // Save doc JSON
  ensureDir(DOCS_DIR);
  saveJSON(path.join(DOCS_DIR, `${target.id}.json`), docData);

  // Save snapshot
  const snapDir = path.join(SNAPSHOTS_DIR, yearMonth);
  ensureDir(snapDir);
  saveJSON(path.join(snapDir, `${target.id}.json`), docData);
  pruneSnapshots(target.id);

  return {
    status: existing ? 'updated' : 'new',
    docId: target.id,
    title: target.title,
    category: target.category,
    hash: contentHash,
    sourceUrl: docPageUrl,
    pdfUrl: pdfUrl || null,
    rbiLastUpdated: rbiLastUpdated || null,
    ourSnapshot: yearMonth,
    snapshotDate: now,
    sourceType,
    chunks: chunks.length,
    snapshotDates: getSnapshotDates(target.id)
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('=== ArthNiti Scraper Starting ===');
  log(`Force refresh: ${FORCE_REFRESH}`);
  ensureDir(DATA_DIR);
  ensureDir(DOCS_DIR);
  ensureDir(SNAPSHOTS_DIR);

  const existingIndex = loadJSON(INDEX_FILE, { lastScraped: null, totalDocs: 35, changedThisRun: 0, docs: [] });
  let changelog = loadJSON(CHANGELOG_FILE, []);

  // Collect all unique listing pages needed
  const listingKeys = [...new Set(TARGET_DOCS.map(d => d.listing))];
  const allListings = {};
  for (const key of listingKeys) {
    allListings[key] = await fetchListingLinks(key);
    await sleep(DELAY_MS);
  }

  const results = [];
  for (const target of TARGET_DOCS) {
    try {
      const result = await processDocument(target, allListings, existingIndex);
      results.push(result);
    } catch (err) {
      log(`  ✗ ERROR processing ${target.id}: ${err.message}`);
      results.push({ status: 'error', docId: target.id, error: err.message });
    }
    await sleep(DELAY_MS);
  }

  // Update index.json
  const changedOrNew = results.filter(r => r.status === 'updated' || r.status === 'new');
  const now = new Date().toISOString();

  const newDocs = TARGET_DOCS.map(target => {
    const result = results.find(r => r.docId === target.id);
    const existing = existingIndex.docs.find(d => d.id === target.id);
    if (result && (result.status === 'updated' || result.status === 'new')) {
      return {
        id: target.id,
        title: target.title,
        category: target.category,
        hash: result.hash,
        sourceUrl: result.sourceUrl,
        pdfUrl: result.pdfUrl || null,
        rbiLastUpdated: result.rbiLastUpdated || null,
        ourLastSnapshot: result.ourSnapshot,
        snapshotDate: result.snapshotDate,
        sourceType: result.sourceType,
        chunks: result.chunks,
        snapshotDates: result.snapshotDates,
        status: result.status === 'new' ? 'ok' : 'ok'
      };
    }
    if (existing) return existing;
    return {
      id: target.id, title: target.title, category: target.category,
      hash: null, sourceUrl: null, pdfUrl: null, rbiLastUpdated: null,
      ourLastSnapshot: null, snapshotDate: null, status: result ? result.status : 'pending',
      snapshotDates: []
    };
  });

  saveJSON(INDEX_FILE, {
    lastScraped: now,
    totalDocs: TARGET_DOCS.length,
    changedThisRun: changedOrNew.length,
    docs: newDocs
  });

  // Update changelog
  for (const r of changedOrNew) {
    changelog = addChangelogEntry(changelog, {
      docId: r.docId,
      docTitle: r.title,
      category: r.category,
      changeDate: now,
      snapshot: r.ourSnapshot,
      status: r.status
    });
  }
  saveJSON(CHANGELOG_FILE, changelog);

  // Summary
  log('\n=== Scrape Complete ===');
  log(`Total:     ${TARGET_DOCS.length}`);
  log(`New:       ${results.filter(r => r.status === 'new').length}`);
  log(`Updated:   ${results.filter(r => r.status === 'updated').length}`);
  log(`Unchanged: ${results.filter(r => r.status === 'unchanged').length}`);
  log(`Skipped:   ${results.filter(r => r.status === 'skipped').length}`);
  log(`Not found: ${results.filter(r => r.status === 'not_found').length}`);
  log(`Errors:    ${results.filter(r => r.status === 'error').length}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

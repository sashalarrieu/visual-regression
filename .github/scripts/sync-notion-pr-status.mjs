#!/usr/bin/env node
/**
 * POC — synchronise l’état des PRs GitHub dans un ticket Notion.
 *
 * Résolution du ticket (dans l’ordre) :
 * 1. URL Notion dans le body de la PR
 * 2. ID ticket (ex. VR-3) dans : titre PR, description, branche, messages de commit
 *
 * Sur chaque ticket résolu (refresh complet) :
 * - découvrir toutes les PR liées (tags flexibles + lignes « PR #N » + PR courante)
 * - fetch GitHub de chaque PR → tags contenu, section « GitHub PRs » (+ commits ticket),
 *   colonnes « PR status » / « PR done » (terminées/total)
 *
 * Tags acceptés : #PR50, #PR 50, PR #50, PR#50, #50PR, #50 PR, 50#PR, 50 #PR
 * → hors section : « 🟢 PR #50 » (icône = état, sans texte) + lien sur « PR #50 »
 * → section « GitHub PRs » : « 🟢 PR #50 · Open · titre · JJ/MM/AA - HHhMM »
 *   commits : « sha · message · JJ/MM/AA - HHhMM » (sha + PR #N = liens)
 *   skip si fingerprint identique (dates incluses), sinon upsert ligne par ligne
 *
 * Secrets GitHub : NOTION_API_VR
 * Data sources : NOTION_DATA_SOURCE_IDS ci-dessous
 *
 * Env optionnelles :
 * - NOTION_ID_PROPERTY, NOTION_ID_PREFIX, NOTION_VERSION
 */

// https://app.notion.com/p/4080420568508059b9b9c055311377cc
const NOTION_DATA_SOURCE_IDS = ["40804205-6850-806d-b489-000b8b09ba97"];

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_ID_PROPERTY = process.env.NOTION_ID_PROPERTY || "ID";
const NOTION_ID_PREFIX = (process.env.NOTION_ID_PREFIX || "").trim().toUpperCase();
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

const PR_NUMBER = process.env.PR_NUMBER || "";
const PR_TITLE = process.env.PR_TITLE || "";
const PR_BODY = process.env.PR_BODY || "";
const PR_HEAD_REF = process.env.PR_HEAD_REF || "";
const PR_HTML_URL = process.env.PR_HTML_URL || "";
const PR_STATE = process.env.PR_STATE || "open";
const PR_DRAFT = process.env.PR_DRAFT === "true";
const PR_MERGED = process.env.PR_MERGED === "true";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "";

const NOTION_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:notion\.so|notion\.site|notion\.com)\/[^\s)>\]"']+/gi;
const TICKET_ID_RE = /\b([A-Za-z][A-Za-z0-9]{0,15})-(\d+)\b/g;
const PR_LABEL_STATUS = "Open|Closed|Merged|Draft";
/** Formes flexibles de tag PR (capture le numéro). */
const FLEX_PR_TAG_RE = /#PR\s*(\d+)\b|PR\s*#\s*(\d+)\b|#\s*(\d+)\s*PR\b|(\d+)\s*#PR\b/gi;
/** Label sync contenu (avec ou sans ancien « · Open ») ou section. */
const PR_LABEL_RE = /(?:[🟢🆑💟📝]\s*)?PR\s*#(\d+)(?:\s*·\s*(?:Open|Closed|Merged|Draft))?/gi;
/** Commit sous une PR dans la section. */
const SECTION_COMMIT_LINE_RE = /^[a-f0-9]{7}\s*·/i;
/**
 * Ligne section complète : « 🟢 PR #50 · Open · titre/date » (≥ 2 séparateurs · après le n°)
 * — pas le tag court contenu « 🟢 PR #50 ».
 */
const SECTION_PR_FULL_LINE_RE = /(?:PR\s*#|#PR)\s*\d+\s*·\s*(?:Open|Closed|Merged|Draft)\s*·\s*\S/i;

const SECTION_TITLE = "GitHub PRs";
const PROP_PR_STATUS = "PR status";
const PROP_PR_DONE = "PR done";
const PR_STATUS_OPTIONS = ["None", "Remaining", "All open", "All draft", "All merged", "All closed", "All done"];
const DONE_PR_STATUSES = new Set(["Merged", "Closed"]);

function fail(message, code = 1) {
  console.error(`❌ ${message}`);
  process.exit(code);
}

function resolveEventPrStatus() {
  if (PR_MERGED) return "Merged";
  if (PR_STATE === "closed") return "Closed";
  if (PR_DRAFT) return "Draft";
  return "Open";
}

function statusFromGithubPr(pr) {
  if (pr.merged_at || pr.merged) return "Merged";
  if (pr.state === "closed") return "Closed";
  if (pr.draft) return "Draft";
  return "Open";
}

function statusEmoji(status) {
  if (status === "Merged") return "💟";
  if (status === "Closed") return "🆑";
  if (status === "Draft") return "📝";
  return "🟢";
}

function formatPrTagLabel({ prNumber, status }) {
  return `${statusEmoji(status)} PR #${prNumber}`;
}

/** « 10/12/26 - 10h23 » (Europe/Paris). */
function formatFrDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .filter(p => p.type !== "literal")
      .map(p => [p.type, p.value]),
  );
  if (!parts.day || !parts.month || !parts.year || parts.hour == null || parts.minute == null) return "";
  return `${parts.day}/${parts.month}/${parts.year} - ${parts.hour}h${parts.minute}`;
}

function safePrTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function safeCommitMessage(message) {
  return String(message || "")
    .split("\n")[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function textSeg(content, url) {
  if (!content) return null;
  if (url) return { type: "text", text: { content, link: { url } } };
  return { type: "text", text: { content } };
}

function richTextToPlain(parts) {
  return (parts || []).map(p => p?.text?.content || "").join("");
}

/** Normalise pour comparer Notion ↔ attendu (espaces, variation selectors emoji). */
function normalizeSectionPlain(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** rich_text section : « 🟢 PR #50 · Open · titre · 10/12/26 - 10h23 » (lien sur « PR #50 »). */
function richTextPrSectionLine({ prNumber, status, title, url, updatedAt }) {
  const titlePart = safePrTitle(title);
  const when = formatFrDateTime(updatedAt);
  let suffix = ` · ${status}`;
  if (titlePart) suffix += ` · ${titlePart}`;
  if (when) suffix += ` · ${when}`;
  return [textSeg(`${statusEmoji(status)} `), textSeg(`PR #${prNumber}`, url), textSeg(suffix)].filter(Boolean);
}

/** rich_text commit : sha cliquable + message + datetime. */
function richTextCommitLine({ sha, message, url, date }) {
  const short = String(sha || "").slice(0, 7);
  const msg = safeCommitMessage(message);
  const when = formatFrDateTime(date);
  const parts = [textSeg(short, url)].filter(Boolean);
  let rest = "";
  if (msg) rest += ` · ${msg}`;
  if (when) rest += ` · ${when}`;
  if (rest) parts.push(textSeg(rest));
  return parts;
}

function extractPrNumberFromSectionLine(text) {
  const m = String(text || "").match(/(?:PR\s*#|#PR)\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function buildExpectedSectionEntries(prInfos, ticketKeys) {
  return [...prInfos]
    .sort((a, b) => a.prNumber - b.prNumber)
    .map(pr => {
      const lineRich = richTextPrSectionLine(pr);
      const commits = (pr.commits || []).filter(c => textMentionsTicket(c.message, ticketKeys));
      return {
        prNumber: pr.prNumber,
        linePlain: richTextToPlain(lineRich),
        lineRich,
        commits: commits.map(c => {
          const lineRichCommit = richTextCommitLine(c);
          return {
            linePlain: richTextToPlain(lineRichCommit),
            lineRich: lineRichCommit,
          };
        }),
      };
    });
}

function sectionFingerprint(entries) {
  return entries
    .map(e => {
      const line = normalizeSectionPlain(e.linePlain);
      const commits = (e.commits || []).map(c => normalizeSectionPlain(c.linePlain)).join("\n");
      return `${line}\n${commits}`;
    })
    .join("\n---\n");
}

/**
 * rich_text contenu : conserve le texte, pose un lien sur chaque « PR #N » connu.
 * Tronque à ~1900 caractères (limite Notion).
 */
function richTextContentWithPrLinks(text, prInfos) {
  const chunk = text.slice(0, 1900);
  const byNumber = new Map(prInfos.map(p => [Number(p.prNumber), p]));
  const re = /PR\s*#(\d+)/gi;
  const parts = [];
  let last = 0;
  for (const m of chunk.matchAll(re)) {
    const n = Number(m[1]);
    const pr = byNumber.get(n);
    const start = m.index ?? 0;
    if (start > last) parts.push(textSeg(chunk.slice(last, start)));
    parts.push(textSeg(`PR #${n}`, pr?.url || null));
    last = start + m[0].length;
  }
  if (last < chunk.length) parts.push(textSeg(chunk.slice(last)));
  return parts.filter(Boolean);
}

function computeGlobalPrStatus(prs) {
  const total = prs.length;
  if (total === 0) return { status: "None", done: "0/0" };

  const doneCount = prs.filter(p => DONE_PR_STATUSES.has(p.status)).length;
  const done = `${doneCount}/${total}`;

  const all = status => prs.every(p => p.status === status);
  if (all("Merged")) return { status: "All merged", done };
  if (all("Closed")) return { status: "All closed", done };
  // Tout terminé (Merged et/ou Closed mélangés)
  if (prs.every(p => DONE_PR_STATUSES.has(p.status))) return { status: "All done", done };
  if (all("Draft")) return { status: "All draft", done };
  if (all("Open")) return { status: "All open", done };
  return { status: "Remaining", done };
}

function notionHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function notionFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: notionHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const detail = json.message || text;
    throw new Error(`Notion API ${res.status} ${method} ${path}: ${detail}`);
  }
  return json;
}

async function githubFetch(path) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error("GITHUB_TOKEN / GITHUB_REPOSITORY manquants");
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "notion-pr-status-sync",
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} GET ${path}: ${json.message || text}`);
  }
  return json;
}

function extractNotionPageIdFromUrl(url) {
  const cleaned = url.split("?")[0].split("#")[0];
  const match = cleaned.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) return null;
  const raw = match[1].replace(/-/g, "").toLowerCase();
  if (raw.length !== 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function findNotionUrls(text) {
  const urls = text.match(NOTION_URL_RE) || [];
  const out = [];
  for (const url of urls) {
    const id = extractNotionPageIdFromUrl(url);
    if (id) out.push({ pageId: id, source: `url:${url}` });
  }
  return out;
}

function extractTicketIds(text) {
  const found = new Map();
  TICKET_ID_RE.lastIndex = 0;
  let m;
  while ((m = TICKET_ID_RE.exec(text)) !== null) {
    const prefix = m[1].toUpperCase();
    const number = Number(m[2]);
    if (!Number.isFinite(number)) continue;
    if (NOTION_ID_PREFIX && prefix !== NOTION_ID_PREFIX) continue;
    const raw = `${prefix}-${number}`;
    found.set(raw, { prefix, number, raw });
  }
  return [...found.values()];
}

function textMentionsTicket(text, ticketKeys) {
  if (!ticketKeys?.size) return false;
  const ids = extractTicketIds(text);
  return ids.some(t => ticketKeys.has(t.raw));
}

function collectPrNumbersFromText(text, into = new Set()) {
  FLEX_PR_TAG_RE.lastIndex = 0;
  for (const m of text.matchAll(FLEX_PR_TAG_RE)) {
    const n = Number(m[1] || m[2] || m[3] || m[4]);
    if (Number.isFinite(n)) into.add(n);
  }
  PR_LABEL_RE.lastIndex = 0;
  for (const m of text.matchAll(PR_LABEL_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) into.add(n);
  }
  return into;
}

function replacePrTagsInText(text, prNumber, label) {
  const n = String(prNumber);
  // Placeholder : évite que « PR #50 » dans un label déjà sync soit re-matché par le flex
  const ph = `\u0000PR${n}\u0000`;
  // Labels sync : « 🟢 PR #n » ou ancien « 🟢 PR #n · Open » (doublons inclus)
  const labelForN = new RegExp(
    `(?:[🟢🆑💟📝]\\s*)*PR\\s*#${n}(?:\\s*·\\s*(?:${PR_LABEL_STATUS})(?:\\s*·\\s*(?:${PR_LABEL_STATUS}))*)?\\b`,
    "gi",
  );
  const flexForN = new RegExp(`#PR\\s*${n}\\b|PR\\s*#\\s*${n}\\b|#\\s*${n}\\s*PR\\b|${n}\\s*#PR\\b`, "gi");
  let next = text.replace(labelForN, ph);
  next = next.replace(flexForN, ph);
  if (new RegExp(`^PR\\s*#?${n}\\s*$`, "i").test(next.trim())) {
    next = ph;
  }
  return next.split(ph).join(label);
}

function replaceAllPrTagsInText(text, prInfos) {
  let next = text;
  // Plus grands numéros d’abord pour éviter 5 vs 50
  const sorted = [...prInfos].sort((a, b) => b.prNumber - a.prNumber);
  for (const pr of sorted) {
    next = replacePrTagsInText(next, pr.prNumber, formatPrTagLabel(pr));
  }
  return next;
}

function isGithubPrSectionManagedLine(text) {
  const t = normalizeSectionPlain(text);
  return SECTION_COMMIT_LINE_RE.test(t) || SECTION_PR_FULL_LINE_RE.test(t);
}

async function fetchPrCommitMessages() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return "";
  try {
    const commits = await fetchAllPrCommits(PR_NUMBER);
    return commits.map(c => c.message).join("\n");
  } catch (err) {
    console.warn(`⚠️  Impossible de lire les commits PR: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

async function fetchAllPrCommits(prNumber) {
  const out = [];
  let page = 1;
  while (page <= 5) {
    const commits = await githubFetch(`/pulls/${prNumber}/commits?per_page=100&page=${page}`);
    if (!Array.isArray(commits) || commits.length === 0) break;
    for (const c of commits) {
      out.push({
        sha: c.sha,
        message: c.commit?.message || "",
        url: c.html_url || `https://github.com/${GITHUB_REPOSITORY}/commit/${c.sha}`,
        date: c.commit?.committer?.date || c.commit?.author?.date || null,
      });
    }
    if (commits.length < 100) break;
    page++;
  }
  return out;
}

async function fetchPrInfo(prNumber) {
  const isEvent = String(prNumber) === String(PR_NUMBER);
  let pr = null;
  try {
    pr = await githubFetch(`/pulls/${prNumber}`);
  } catch (err) {
    if (!isEvent || !PR_HTML_URL) throw err;
    console.warn(`⚠️  Fetch PR #${prNumber}: ${err instanceof Error ? err.message : String(err)} — fallback event`);
  }

  const commits = await fetchAllPrCommits(prNumber).catch(() => []);
  return {
    prNumber: Number(prNumber),
    status: pr ? statusFromGithubPr(pr) : resolveEventPrStatus(),
    title: pr?.title || (isEvent ? PR_TITLE : "") || `PR #${prNumber}`,
    url: pr?.html_url || (isEvent ? PR_HTML_URL : "") || `https://github.com/${GITHUB_REPOSITORY}/pull/${prNumber}`,
    updatedAt: pr?.updated_at || null,
    commits,
  };
}

function formatNotionId(raw) {
  const id = String(raw).replace(/-/g, "");
  if (id.length !== 32) {
    throw new Error(`UUID Notion invalide: "${raw}" (attendu 32 hex)`);
  }
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function readIdPayload(prop) {
  if (!prop) return null;
  return prop.unique_id || prop.auto_increment_id || null;
}

function pickPageForTicket(results, ticket, idPropertyName) {
  if (!results.length) return null;
  if (!ticket.prefix) return results[0].id;
  const match = results.find(page => {
    const prop = page.properties?.[idPropertyName] || page.properties?.ID;
    const uid = readIdPayload(prop);
    if (!uid) return true;
    const pagePrefix = (uid.prefix || "").toUpperCase();
    return !pagePrefix || pagePrefix === ticket.prefix;
  });
  return match?.id ?? null;
}

function findIdPropertyMeta(properties) {
  const props = properties || {};
  const preferredNames = [NOTION_ID_PROPERTY, "ID", "Identifiant", "Id"];
  for (const name of preferredNames) {
    if (props[name]) {
      return { name, type: props[name].type };
    }
  }
  const unique = Object.entries(props).find(([, p]) => p?.type === "unique_id" || p?.type === "auto_increment_id");
  if (unique) return { name: unique[0], type: unique[1].type };
  return null;
}

function buildTicketFilters(idMeta, ticket) {
  if (!idMeta) {
    throw new Error(`Aucune propriété ID trouvée (cherché: ${NOTION_ID_PROPERTY} / Identifiant).`);
  }
  const name = idMeta.name;
  if (idMeta.type === "unique_id" || idMeta.type === "auto_increment_id") {
    return [
      { property: name, unique_id: { equals: ticket.number } },
      { property: name, auto_increment_id: { equals: ticket.number } },
      { property: name, number: { equals: ticket.number } },
    ];
  }
  if (idMeta.type === "rich_text") {
    return [{ property: name, rich_text: { equals: ticket.raw } }];
  }
  if (idMeta.type === "title") {
    return [{ property: name, title: { equals: ticket.raw } }];
  }
  if (idMeta.type === "number") {
    return [{ property: name, number: { equals: ticket.number } }];
  }
  throw new Error(`Type de propriété ID non supporté: ${name} (${idMeta.type})`);
}

async function queryTicketInDataSource(dataSourceId, body) {
  return notionFetch(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body,
  });
}

function parseTicketNumberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.trim().match(/^(?:[A-Za-z][A-Za-z0-9]{0,15}-)?(\d+)$/);
    if (m) return Number(m[1]);
  }
  if (value && typeof value === "object" && typeof value.number === "number") return value.number;
  return null;
}

function readTicketNumberFromPage(page, idPropertyName) {
  const prop = page.properties?.[idPropertyName] || page.properties?.ID;
  if (!prop) return null;
  const uid = readIdPayload(prop);
  return (
    parseTicketNumberValue(uid) ??
    parseTicketNumberValue(prop.number) ??
    parseTicketNumberValue(prop.auto_increment_id) ??
    parseTicketNumberValue(prop.unique_id) ??
    null
  );
}

function readTicketRawFromPage(page, idPropertyName) {
  const prop = page.properties?.[idPropertyName] || page.properties?.ID;
  if (!prop) return null;
  const uid = readIdPayload(prop);
  const num = readTicketNumberFromPage(page, idPropertyName);
  if (num == null) return null;
  const prefix = (uid?.prefix || NOTION_ID_PREFIX || "").toUpperCase();
  return prefix ? `${prefix}-${num}` : String(num);
}

async function findPageByScanning(dataSourceId, ticket, idPropertyName) {
  let cursor;
  let scanned = 0;
  let sampleLogged = false;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await queryTicketInDataSource(dataSourceId, body);
    for (const page of data.results || []) {
      scanned += 1;
      const prop = page.properties?.[idPropertyName] || page.properties?.ID;
      if (!sampleLogged) {
        sampleLogged = true;
        console.log(`🧪 Sample prop « ${idPropertyName} »: ${JSON.stringify(prop)}`);
      }
      const num = readTicketNumberFromPage(page, idPropertyName);
      if (num !== ticket.number) continue;
      const uid = readIdPayload(prop);
      const prefix = (uid?.prefix || "").toUpperCase();
      if (ticket.prefix && prefix && prefix !== ticket.prefix) continue;
      console.log(`📂 Trouvé ${ticket.raw} par scan (${scanned} pages) → ${page.id}`);
      return page.id;
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  console.warn(`⚠️  Scan data_source ${dataSourceId}: ${scanned} page(s), pas de ${ticket.raw}`);
  return null;
}

async function findPageByUniqueId(ticket) {
  if (!NOTION_DATA_SOURCE_IDS.length) {
    throw new Error("NOTION_DATA_SOURCE_IDS est vide — ajoute au moins un data_source_id dans le script.");
  }

  let lastError = null;
  for (const rawId of NOTION_DATA_SOURCE_IDS) {
    const dataSourceId = formatNotionId(rawId);
    try {
      console.log(`📚 data_source=${dataSourceId}`);
      let properties = {};
      try {
        const ds = await notionFetch(`/data_sources/${dataSourceId}`);
        properties = ds.properties || {};
        console.log(`🧩 Props data_source: ${Object.keys(properties).join(", ") || "(vide)"}`);
      } catch (err) {
        console.warn(
          `⚠️  Impossible de lire le schéma data_source: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const idMeta = findIdPropertyMeta(properties) || {
        name: NOTION_ID_PROPERTY,
        type: "auto_increment_id",
      };
      console.log(`🏷️  Lookup ID: ${idMeta.name} (${idMeta.type}) = ${ticket.raw}`);

      for (const filter of buildTicketFilters(idMeta, ticket)) {
        try {
          const data = await queryTicketInDataSource(dataSourceId, { page_size: 5, filter });
          const pageId = pickPageForTicket(data.results || [], ticket, idMeta.name);
          if (pageId) {
            console.log(`📂 Trouvé ${ticket.raw} via filtre → page ${pageId}`);
            return pageId;
          }
        } catch (err) {
          lastError = err;
          console.warn(`⚠️  Filtre ${JSON.stringify(filter)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const scannedId = await findPageByScanning(dataSourceId, ticket, idMeta.name);
      if (scannedId) return scannedId;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  data_source ${dataSourceId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (lastError) throw lastError;
  return null;
}

/** Crée PR status / PR done (+ options) si absents. */
async function ensurePrSchema(dataSourceId) {
  const ds = await notionFetch(`/data_sources/${dataSourceId}`);
  const props = ds.properties || {};
  const patch = {};

  if (!props[PROP_PR_STATUS]) {
    patch[PROP_PR_STATUS] = {
      select: {
        options: PR_STATUS_OPTIONS.map(name => ({ name })),
      },
    };
  } else if (props[PROP_PR_STATUS].type === "select") {
    const existing = new Set((props[PROP_PR_STATUS].select?.options || []).map(o => o.name));
    const missing = PR_STATUS_OPTIONS.filter(n => !existing.has(n));
    if (missing.length) {
      // Notion : re-déclarer les options pour en ajouter (merge côté API)
      const merged = [
        ...(props[PROP_PR_STATUS].select?.options || []).map(o => ({ name: o.name, color: o.color })),
        ...missing.map(name => ({ name })),
      ];
      patch[PROP_PR_STATUS] = { select: { options: merged } };
    }
  }

  if (!props[PROP_PR_DONE]) {
    patch[PROP_PR_DONE] = { rich_text: {} };
  }

  if (Object.keys(patch).length === 0) {
    console.log(`🧾 Schéma OK (${PROP_PR_STATUS}, ${PROP_PR_DONE})`);
    return;
  }

  await notionFetch(`/data_sources/${dataSourceId}`, {
    method: "PATCH",
    body: { properties: patch },
  });
  console.log(`🧾 Schéma mis à jour: ${Object.keys(patch).join(", ")}`);
}

async function ensurePrSchemaForAllSources() {
  for (const rawId of NOTION_DATA_SOURCE_IDS) {
    const dataSourceId = formatNotionId(rawId);
    try {
      await ensurePrSchema(dataSourceId);
    } catch (err) {
      console.warn(`⚠️  ensure schema ${dataSourceId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function blockPlainText(block) {
  const type = block.type;
  const payload = block[type];
  if (!payload?.rich_text) return "";
  return payload.rich_text.map(t => t.plain_text || "").join("");
}

async function listAllChildren(blockId) {
  const blocks = [];
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : "?page_size=100";
    const data = await notionFetch(`/blocks/${blockId}/children${q}`);
    blocks.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

async function walkAllBlocks(pageId) {
  const out = [];
  const queue = [pageId];
  while (queue.length) {
    const parentId = queue.shift();
    const children = await listAllChildren(parentId);
    for (const block of children) {
      out.push(block);
      if (block.has_children) queue.push(block.id);
    }
  }
  return out;
}

function blockRichTextPayload(block) {
  const payload = block?.[block.type];
  if (!payload || !Array.isArray(payload.rich_text)) return null;
  return payload;
}

async function updateAllPrTaggedBlocks(pageId, prInfos) {
  const blocks = await walkAllBlocks(pageId);
  let updated = 0;
  let skipped = 0;

  for (const block of blocks) {
    const payload = blockRichTextPayload(block);
    if (!payload) continue;
    const current = blockPlainText(block);
    if (isGithubPrSectionManagedLine(current)) continue;
    // Ne pas toucher le titre de section
    if (current.trim() === SECTION_TITLE) continue;

    const next = replaceAllPrTagsInText(current, prInfos);
    const prNums = collectPrNumbersFromText(next);
    // Texte inchangé et aucun tag PR → rien à faire
    if (next === current && prNums.size === 0) continue;
    // Texte inchangé mais labels déjà sync → on rafraîchit quand même les liens
    if (next === current && prNums.size > 0) {
      const alreadyLinked = (payload.rich_text || []).some(t => t?.href || t?.text?.link?.url);
      const canLink = [...prNums].some(n => prInfos.find(p => p.prNumber === n)?.url);
      if (alreadyLinked || !canLink) {
        skipped += 1;
        continue;
      }
    }

    await notionFetch(`/blocks/${block.id}`, {
      method: "PATCH",
      body: {
        [block.type]: {
          rich_text: richTextContentWithPrLinks(next, prInfos),
        },
      },
    });
    updated += 1;
  }

  console.log(`🏷️  Tags contenu: ${updated} maj, ${skipped} inchangé(s)`);
}

async function deleteBlock(blockId) {
  await notionFetch(`/blocks/${blockId}`, { method: "DELETE" });
}

async function ensureGithubPrsHeading(pageId, children) {
  const headingIdx = children.findIndex(
    b => (b.type === "heading_2" || b.type === "heading_3") && blockPlainText(b).trim() === SECTION_TITLE,
  );
  if (headingIdx >= 0) {
    return { headingId: children[headingIdx].id, headingIdx, children };
  }
  const createdHeading = await notionFetch(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: {
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: SECTION_TITLE } }],
          },
        },
      ],
    },
  });
  const headingId = createdHeading.results?.[0]?.id || null;
  const refreshed = await listAllChildren(pageId);
  const idx = refreshed.findIndex(b => b.id === headingId);
  return { headingId, headingIdx: idx, children: refreshed };
}

function collectSectionTopLevelBlocks(children, headingIdx) {
  const out = [];
  if (headingIdx < 0) return out;
  for (let i = headingIdx + 1; i < children.length; i++) {
    const b = children[i];
    if (b.type === "heading_2" || b.type === "heading_3") break;
    out.push(b);
  }
  return out;
}

async function readCurrentSectionEntries(sectionBlocks) {
  const entries = [];
  for (const block of sectionBlocks) {
    const linePlain = blockPlainText(block);
    const prNumber = extractPrNumberFromSectionLine(linePlain);
    let commitBlocks = [];
    if (block.has_children) {
      commitBlocks = await listAllChildren(block.id);
    }
    entries.push({
      id: block.id,
      prNumber,
      linePlain,
      commits: commitBlocks.map(c => ({ id: c.id, linePlain: blockPlainText(c) })),
    });
  }
  return entries;
}

async function syncCommitLines(prBlockId, expectedCommits, currentCommits) {
  let updated = 0;
  let afterId = null;
  const max = Math.max(expectedCommits.length, currentCommits.length);

  for (let i = 0; i < max; i++) {
    const exp = expectedCommits[i];
    const cur = currentCommits[i];
    if (exp && cur) {
      if (normalizeSectionPlain(cur.linePlain) !== normalizeSectionPlain(exp.linePlain)) {
        await notionFetch(`/blocks/${cur.id}`, {
          method: "PATCH",
          body: { bulleted_list_item: { rich_text: exp.lineRich } },
        });
        updated += 1;
      }
      afterId = cur.id;
    } else if (exp && !cur) {
      const body = {
        children: [
          {
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: exp.lineRich },
          },
        ],
      };
      if (afterId) body.position = { type: "after_block", after_block: { id: afterId } };
      const created = await notionFetch(`/blocks/${prBlockId}/children`, { method: "PATCH", body });
      afterId = created.results?.[0]?.id || afterId;
      updated += 1;
    } else if (!exp && cur) {
      try {
        await deleteBlock(cur.id);
        updated += 1;
      } catch (err) {
        console.warn(`⚠️  Delete commit ${cur.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return updated;
}

async function appendPrSectionBlock(pageId, afterId, entry) {
  const body = {
    children: [
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: entry.lineRich },
      },
    ],
  };
  if (afterId) body.position = { type: "after_block", after_block: { id: afterId } };
  const created = await notionFetch(`/blocks/${pageId}/children`, { method: "PATCH", body });
  const prBlockId = created.results?.[0]?.id || null;
  if (prBlockId && entry.commits.length) {
    await notionFetch(`/blocks/${prBlockId}/children`, {
      method: "PATCH",
      body: {
        children: entry.commits.map(c => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: c.lineRich },
        })),
      },
    });
  }
  return prBlockId;
}

/**
 * Section « GitHub PRs » : skip si fingerprint identique (texte + dates),
 * sinon upsert ligne par ligne (PR + commits).
 */
async function rebuildGithubPrsSection(pageId, prInfos, ticketKeys) {
  const expected = buildExpectedSectionEntries(prInfos, ticketKeys);
  const expectedFp = sectionFingerprint(expected);

  let children = await listAllChildren(pageId);
  const ensured = await ensureGithubPrsHeading(pageId, children);
  const headingId = ensured.headingId;
  children = ensured.children;
  const headingIdx = ensured.headingIdx;

  if (!headingId || headingIdx < 0) {
    console.warn(`⚠️  Impossible de créer/trouver le heading « ${SECTION_TITLE} »`);
    return;
  }

  const sectionBlocks = collectSectionTopLevelBlocks(children, headingIdx);
  const current = await readCurrentSectionEntries(sectionBlocks);
  const currentFp = sectionFingerprint(
    current.map(c => ({
      linePlain: c.linePlain,
      commits: c.commits.map(x => ({ linePlain: x.linePlain })),
    })),
  );

  if (currentFp === expectedFp && expected.length === current.length) {
    console.log(`📚 Section « ${SECTION_TITLE} » inchangée (${expected.length} PR) — skip`);
    return;
  }

  const byPr = new Map();
  const orphans = [];
  for (const cur of current) {
    if (cur.prNumber != null && Number.isFinite(cur.prNumber) && !byPr.has(cur.prNumber)) {
      byPr.set(cur.prNumber, cur);
    } else {
      orphans.push(cur);
    }
  }

  let afterId = headingId;
  let touched = 0;

  for (const entry of expected) {
    const cur = byPr.get(entry.prNumber);
    if (cur) {
      byPr.delete(entry.prNumber);
      if (normalizeSectionPlain(cur.linePlain) !== normalizeSectionPlain(entry.linePlain)) {
        await notionFetch(`/blocks/${cur.id}`, {
          method: "PATCH",
          body: { bulleted_list_item: { rich_text: entry.lineRich } },
        });
        touched += 1;
      }
      const commitTouched = await syncCommitLines(cur.id, entry.commits, cur.commits);
      touched += commitTouched;
      afterId = cur.id;
    } else {
      const createdId = await appendPrSectionBlock(pageId, afterId, entry);
      if (createdId) afterId = createdId;
      touched += 1;
      if (entry.commits.length) {
        console.log(`📝 PR #${entry.prNumber}: ${entry.commits.length} commit(s) ticket`);
      }
    }
  }

  for (const leftover of [...byPr.values(), ...orphans]) {
    try {
      await deleteBlock(leftover.id);
      touched += 1;
    } catch (err) {
      console.warn(`⚠️  Delete block ${leftover.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`📚 Section « ${SECTION_TITLE} » sync ligne à ligne (${expected.length} PR, ${touched} écriture(s))`);
}

async function updatePageGlobalProperties(pageId, prInfos) {
  const { status, done } = computeGlobalPrStatus(prInfos);
  try {
    const page = await notionFetch(`/pages/${pageId}`);
    const curStatus = page.properties?.[PROP_PR_STATUS]?.select?.name || "";
    const curDone = (page.properties?.[PROP_PR_DONE]?.rich_text || []).map(t => t.plain_text || "").join("");
    if (curStatus === status && curDone === done) {
      console.log(`🧾 ${PROP_PR_STATUS}/${PROP_PR_DONE} inchangés (${status} · ${done}) — skip`);
      return;
    }
  } catch (err) {
    console.warn(`⚠️  Lecture props: ${err instanceof Error ? err.message : String(err)}`);
  }

  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: {
      properties: {
        [PROP_PR_STATUS]: { select: { name: status } },
        [PROP_PR_DONE]: {
          rich_text: [{ type: "text", text: { content: done } }],
        },
      },
    },
  });
  console.log(`🧾 ${PROP_PR_STATUS}=${status} · ${PROP_PR_DONE}=${done}`);
}

async function discoverPrNumbersOnPage(pageId) {
  const nums = new Set();
  if (PR_NUMBER) nums.add(Number(PR_NUMBER));
  const blocks = await walkAllBlocks(pageId);
  for (const block of blocks) {
    collectPrNumbersFromText(blockPlainText(block), nums);
  }
  return [...nums].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

async function resolveTicketKeysForPage(pageId, sourceHint) {
  const keys = new Set();
  if (sourceHint?.startsWith("id:")) {
    keys.add(sourceHint.slice(3));
  }
  try {
    const page = await notionFetch(`/pages/${pageId}`);
    const raw = readTicketRawFromPage(page, NOTION_ID_PROPERTY);
    if (raw) keys.add(raw);
  } catch (err) {
    console.warn(`⚠️  Lecture page ${pageId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return keys;
}

async function syncPage(pageId, source) {
  console.log(`🔗 Page ${pageId} (via ${source}) — refresh complet`);

  const ticketKeys = await resolveTicketKeysForPage(pageId, source);
  console.log(`🎫 Tickets page: ${[...ticketKeys].join(", ") || "(aucun)"}`);

  const prNumbers = await discoverPrNumbersOnPage(pageId);
  console.log(`🔍 PR découvertes: ${prNumbers.map(n => `#${n}`).join(", ") || "(aucune)"}`);

  const prInfos = [];
  for (const n of prNumbers) {
    try {
      const info = await fetchPrInfo(n);
      prInfos.push(info);
      console.log(`📦 PR #${n} → ${info.status} · ${info.title}`);
    } catch (err) {
      console.warn(`⚠️  Fetch PR #${n}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await updateAllPrTaggedBlocks(pageId, prInfos);
  await rebuildGithubPrsSection(pageId, prInfos, ticketKeys);
  await updatePageGlobalProperties(pageId, prInfos);
}

async function resolveTargetPages(haystack) {
  const targets = new Map();

  for (const hit of findNotionUrls(haystack)) {
    targets.set(hit.pageId, hit.source);
  }

  const tickets = extractTicketIds(haystack);
  const lookupErrors = [];
  for (const ticket of tickets) {
    console.log(`🔎 Ticket ID détecté: ${ticket.raw}`);
    try {
      const pageId = await findPageByUniqueId(ticket);
      if (!pageId) {
        console.warn(`⚠️  Aucune page Notion pour ${ticket.raw} (propriété ${NOTION_ID_PROPERTY})`);
        continue;
      }
      if (!targets.has(pageId)) targets.set(pageId, `id:${ticket.raw}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Lookup ${ticket.raw}: ${msg}`);
      lookupErrors.push(`${ticket.raw}: ${msg}`);
    }
  }

  if (tickets.length > 0 && targets.size === 0) {
    const detail = lookupErrors.length ? lookupErrors.join(" | ") : "aucun résultat Notion";
    throw new Error(`Impossible de résoudre le(s) ticket(s) Notion (${detail})`);
  }

  return targets;
}

async function main() {
  if (!NOTION_TOKEN) fail("NOTION_TOKEN manquant (secret GitHub NOTION_API_VR).");
  if (!PR_HTML_URL) fail("PR_HTML_URL manquant.");
  if (!PR_NUMBER) fail("PR_NUMBER manquant.");

  await ensurePrSchemaForAllSources();

  const commitMessages = await fetchPrCommitMessages();
  const haystack = [PR_TITLE, PR_BODY, PR_HEAD_REF, commitMessages].filter(Boolean).join("\n");

  console.log(`📌 Event PR #${PR_NUMBER} — ${PR_HTML_URL}`);
  console.log(`🌿 Branche: ${PR_HEAD_REF || "(n/a)"}`);

  const targets = await resolveTargetPages(haystack);
  if (targets.size === 0) {
    console.log(
      "ℹ️  Aucun ticket Notion trouvé (ni URL Notion, ni ID type PREFIX-123 dans titre/description/branche/commits) — skip.",
    );
    process.exit(0);
  }

  for (const [pageId, source] of targets) {
    await syncPage(pageId, source);
  }

  console.log(`💟 Sync terminée (${targets.size} page(s) Notion)`);
}

main().catch(err => {
  fail(err instanceof Error ? err.message : String(err));
});

#!/usr/bin/env node
/**
 * POC — synchronise l’état des PRs GitHub dans un ticket Notion.
 *
 * Résolution du ticket (dans l’ordre) :
 * 1. URL Notion dans le body de la PR
 * 2. ID ticket (ex. VR-3) dans : titre PR, description, branche, messages de commit
 *
 * Sur chaque ticket résolu (refresh complet) :
 * - découvrir toutes les PR liées (tags flexibles + section [[vr-pr:N]] + PR courante)
 * - fetch GitHub de chaque PR → tags contenu, section « GitHub PRs » (+ commits ticket),
 *   colonnes « PR status » / « PR remaining »
 *
 * Tags acceptés : #PR50, #PR 50, PR #50, PR#50, #50PR, #50 PR, 50#PR, 50 #PR
 * → remplacés par « 🔵 PR #50 · Open » (sans lien)
 *
 * Secrets GitHub : NOTION_API_VR
 * Bases : NOTION_TICKET_SOURCES ci-dessous
 *
 * Env optionnelles :
 * - NOTION_ID_PROPERTY, NOTION_ID_PREFIX, NOTION_VERSION
 */

const NOTION_TICKET_SOURCES = [
  {
    // https://app.notion.com/p/4080420568508059b9b9c055311377cc
    databaseId: "40804205-6850-8059-b9b9-c055311377cc",
    dataSourceId: "40804205-6850-806d-b489-000b8b09ba97",
  },
];

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
const PR_LINE_RE = n => new RegExp(`\\[\\[vr-pr:${n}\\]\\]`);
const PR_MARKER_RE = /\[\[vr-pr:(\d+)\]\]/gi;
const PR_LABEL_STATUS = "Open|Closed|Merged|Draft";
/** Formes flexibles de tag PR (capture le numéro). */
const FLEX_PR_TAG_RE = /#PR\s*(\d+)\b|PR\s*#\s*(\d+)\b|#\s*(\d+)\s*PR\b|(\d+)\s*#PR\b/gi;
const PR_LABEL_RE = /(?:[🔵⏹️✅📝]\s*)?PR\s*#(\d+)\s*·\s*(?:Open|Closed|Merged|Draft)\b/gi;

const SECTION_TITLE = "GitHub PRs";
const PROP_PR_STATUS = "PR status";
const PROP_PR_REMAINING = "PR remaining";
const PR_STATUS_OPTIONS = ["None", "All merged", "All draft", "All open", "All closed", "Remaining"];

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
  if (status === "Merged") return "✅";
  if (status === "Closed") return "⏹️";
  if (status === "Draft") return "📝";
  return "🔵";
}

function formatPrTagLabel({ prNumber, status }) {
  return `${statusEmoji(status)} PR #${prNumber} · ${status}`;
}

function formatPrSectionLine({ prNumber, status, title, url }) {
  const safeTitle = String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const titlePart = safeTitle ? ` · ${safeTitle}` : "";
  return `${statusEmoji(status)} #PR${prNumber} · ${status}${titlePart} · ${url} [[vr-pr:${prNumber}]]`;
}

function formatCommitLine({ sha, message, url }) {
  const short = String(sha || "").slice(0, 7);
  const msg = String(message || "")
    .split("\n")[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${short} · ${msg} · ${url}`;
}

function computeGlobalPrStatus(prs) {
  const total = prs.length;
  if (total === 0) return { status: "None", remaining: "0/0" };

  const remainingCount = prs.filter(p => p.status === "Open" || p.status === "Draft").length;
  const remaining = `${remainingCount}/${total}`;

  const all = status => prs.every(p => p.status === status);
  if (all("Merged")) return { status: "All merged", remaining };
  if (all("Draft")) return { status: "All draft", remaining };
  if (all("Open")) return { status: "All open", remaining };
  if (all("Closed")) return { status: "All closed", remaining };
  return { status: "Remaining", remaining };
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
  PR_MARKER_RE.lastIndex = 0;
  for (const m of text.matchAll(PR_MARKER_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) into.add(n);
  }
  return into;
}

function replacePrTagsInText(text, prNumber, label) {
  const n = String(prNumber);
  const labelForN = new RegExp(`(?:[🔵⏹️✅📝]\\s*)?PR\\s*#${n}\\s*·\\s*(?:${PR_LABEL_STATUS})\\b`, "gi");
  // Formes flexibles pour ce numéro uniquement
  const flexForN = new RegExp(`#PR\\s*${n}\\b|PR\\s*#\\s*${n}\\b|#\\s*${n}\\s*PR\\b|${n}\\s*#PR\\b`, "gi");
  let next = text.replace(labelForN, label).replace(flexForN, label);
  if (new RegExp(`^PR\\s*#?${n}\\s*$`, "i").test(next.trim())) {
    next = label;
  }
  return next;
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
  return /\[\[vr-pr:\d+\]\]/i.test(text) || /^[a-f0-9]{7}\s*·/i.test(text.trim());
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
      });
    }
    if (commits.length < 100) break;
    page++;
  }
  return out;
}

async function fetchPrInfo(prNumber) {
  // PR de l’event : pas besoin d’un round-trip si c’est la même
  if (String(prNumber) === String(PR_NUMBER) && PR_HTML_URL) {
    const status = resolveEventPrStatus();
    const commits = await fetchAllPrCommits(prNumber).catch(() => []);
    return {
      prNumber: Number(prNumber),
      status,
      title: PR_TITLE || `PR #${prNumber}`,
      url: PR_HTML_URL,
      commits,
    };
  }

  const pr = await githubFetch(`/pulls/${prNumber}`);
  const commits = await fetchAllPrCommits(prNumber).catch(() => []);
  return {
    prNumber: Number(prNumber),
    status: statusFromGithubPr(pr),
    title: pr.title || `PR #${prNumber}`,
    url: pr.html_url || `https://github.com/${GITHUB_REPOSITORY}/pull/${prNumber}`,
    commits,
  };
}

function formatDatabaseId(raw) {
  const dbId = String(raw).replace(/-/g, "");
  if (dbId.length !== 32) {
    throw new Error(`UUID Notion invalide: "${raw}" (attendu 32 hex)`);
  }
  return `${dbId.slice(0, 8)}-${dbId.slice(8, 12)}-${dbId.slice(12, 16)}-${dbId.slice(16, 20)}-${dbId.slice(20)}`;
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

async function resolveDataSource(source) {
  const databaseId = formatDatabaseId(source.databaseId);
  if (source.dataSourceId) {
    const dataSourceId = formatDatabaseId(source.dataSourceId);
    console.log(`📚 data_source=${dataSourceId} (hardcodé, base ${databaseId})`);
    return { dataSourceId, databaseId };
  }
  const db = await notionFetch(`/databases/${databaseId}`);
  const sources = db.data_sources || [];
  if (sources.length > 0) {
    console.log(`📚 data_source=${sources[0].id} (base ${databaseId})`);
    return { dataSourceId: sources[0].id, databaseId };
  }
  console.log(`📚 Pas de data_sources[] — fallback ${databaseId}`);
  return { dataSourceId: databaseId, databaseId };
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
  if (!NOTION_TICKET_SOURCES.length) {
    throw new Error("NOTION_TICKET_SOURCES est vide — ajoute au moins une base dans le script.");
  }

  let lastError = null;
  for (const source of NOTION_TICKET_SOURCES) {
    try {
      const { dataSourceId } = await resolveDataSource(source);
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
      console.warn(`⚠️  Source ${source.databaseId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (lastError) throw lastError;
  return null;
}

/** Crée PR status / PR remaining (+ options) si absents. */
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

  if (!props[PROP_PR_REMAINING]) {
    patch[PROP_PR_REMAINING] = { rich_text: {} };
  }

  if (Object.keys(patch).length === 0) {
    console.log(`🧾 Schéma OK (${PROP_PR_STATUS}, ${PROP_PR_REMAINING})`);
    return;
  }

  await notionFetch(`/data_sources/${dataSourceId}`, {
    method: "PATCH",
    body: { properties: patch },
  });
  console.log(`🧾 Schéma mis à jour: ${Object.keys(patch).join(", ")}`);
}

async function ensurePrSchemaForAllSources() {
  for (const source of NOTION_TICKET_SOURCES) {
    try {
      const { dataSourceId } = await resolveDataSource(source);
      await ensurePrSchema(dataSourceId);
    } catch (err) {
      console.warn(`⚠️  ensure schema ${source.databaseId}: ${err instanceof Error ? err.message : String(err)}`);
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

function richTextWithOptionalLink(content) {
  const chunk = content.slice(0, 1900);
  const urlMatch = chunk.match(/https?:\/\/\S+/);
  if (!urlMatch) {
    return [{ type: "text", text: { content: chunk } }];
  }
  const url = urlMatch[0].replace(/\s*\[\[vr-pr:.*$/, "").trim();
  const before = chunk.slice(0, urlMatch.index);
  const after = chunk.slice(urlMatch.index + urlMatch[0].length);
  const parts = [];
  if (before) parts.push({ type: "text", text: { content: before } });
  parts.push({ type: "text", text: { content: url, link: { url } } });
  if (after) parts.push({ type: "text", text: { content: after } });
  return parts;
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
    if (next === current) {
      if (collectPrNumbersFromText(current).size) skipped += 1;
      continue;
    }

    await notionFetch(`/blocks/${block.id}`, {
      method: "PATCH",
      body: {
        [block.type]: {
          rich_text: [{ type: "text", text: { content: next.slice(0, 1900) } }],
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

/**
 * Reconstruit la section « GitHub PRs » :
 * - une puce par PR (tag + statut + titre + lien)
 * - sous-puces = commits qui mentionnent le ticket
 */
async function rebuildGithubPrsSection(pageId, prInfos, ticketKeys) {
  const children = await listAllChildren(pageId);
  let headingIdx = children.findIndex(
    b => (b.type === "heading_2" || b.type === "heading_3") && blockPlainText(b).trim() === SECTION_TITLE,
  );
  let afterId = null;

  if (headingIdx >= 0) {
    afterId = children[headingIdx].id;
    const toDelete = [];
    for (let i = headingIdx + 1; i < children.length; i++) {
      const b = children[i];
      if (b.type === "heading_2" || b.type === "heading_3") break;
      toDelete.push(b.id);
    }
    for (const id of toDelete) {
      try {
        await deleteBlock(id);
      } catch (err) {
        console.warn(`⚠️  Delete block ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
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
    afterId = createdHeading.results?.[0]?.id || null;
  }

  const sorted = [...prInfos].sort((a, b) => a.prNumber - b.prNumber);
  for (const pr of sorted) {
    const line = formatPrSectionLine(pr);
    const body = {
      children: [
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: richTextWithOptionalLink(line),
          },
        },
      ],
    };
    if (afterId) {
      body.position = { type: "after_block", after_block: { id: afterId } };
    }
    const created = await notionFetch(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body,
    });
    const prBlockId = created.results?.[0]?.id;
    if (prBlockId) afterId = prBlockId;

    const ticketCommits = (pr.commits || []).filter(c => textMentionsTicket(c.message, ticketKeys));
    if (!prBlockId || !ticketCommits.length) continue;

    await notionFetch(`/blocks/${prBlockId}/children`, {
      method: "PATCH",
      body: {
        children: ticketCommits.map(c => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: richTextWithOptionalLink(formatCommitLine(c)),
          },
        })),
      },
    });
    console.log(`📝 PR #${pr.prNumber}: ${ticketCommits.length} commit(s) ticket`);
  }

  console.log(`📚 Section « ${SECTION_TITLE} » reconstruite (${sorted.length} PR)`);
}

async function updatePageGlobalProperties(pageId, prInfos) {
  const { status, remaining } = computeGlobalPrStatus(prInfos);
  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: {
      properties: {
        [PROP_PR_STATUS]: { select: { name: status } },
        [PROP_PR_REMAINING]: {
          rich_text: [{ type: "text", text: { content: remaining } }],
        },
      },
    },
  });
  console.log(`🧾 ${PROP_PR_STATUS}=${status} · ${PROP_PR_REMAINING}=${remaining}`);
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

  console.log(`✅ Sync terminée (${targets.size} page(s) Notion)`);
}

main().catch(err => {
  fail(err instanceof Error ? err.message : String(err));
});

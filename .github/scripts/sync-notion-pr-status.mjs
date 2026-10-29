#!/usr/bin/env node
/**
 * POC — synchronise l’état d’une PR GitHub dans le *contenu* d’un ticket Notion
 * (plusieurs PR par ticket possibles).
 *
 * Résolution du ticket (dans l’ordre) :
 * 1. URL Notion dans le body de la PR
 * 2. ID ticket (ex. TAS-12) dans : titre PR, description, branche, messages de commit
 *    → requête sur la propriété "ID" (unique_id) de la base Notion
 *
 * Secrets GitHub :
 * - NOTION_API_VR  PAT Notion
 *
 * Bases tickets (pas secret) : ajouter un UUID ci-dessous pour chaque tableau.
 *
 * Env optionnelles :
 * - NOTION_ID_PROPERTY   nom propriété ID (défaut: "ID")
 * - NOTION_ID_PREFIX     si défini, n’accepte que PREFIX-123 (ex. TAS)
 * - NOTION_VERSION       (défaut: 2026-03-11 — requis pour PAT Notion)
 */

/**
 * Bases tickets Notion (database container + data_source).
 * data_source_id = collection://… (voir fetch Notion de la base).
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
/** IDs type TAS-12, VR-3 (préfixe lettres/chiffres + tiret + numéro). */
const TICKET_ID_RE = /\b([A-Za-z][A-Za-z0-9]{0,15})-(\d+)\b/g;
const PR_LINE_RE = n => new RegExp(`\\[\\[vr-pr:${n}\\]\\]`);

const SECTION_TITLE = "GitHub PRs";

function fail(message, code = 1) {
  console.error(`❌ ${message}`);
  process.exit(code);
}

function resolvePrStatus() {
  if (PR_MERGED) return "Merged";
  if (PR_STATE === "closed") return "Closed";
  if (PR_DRAFT) return "Draft";
  return "Open";
}

function statusEmoji(status) {
  if (status === "Merged") return "✅";
  if (status === "Closed") return "⏹️";
  if (status === "Draft") return "📝";
  return "🔵";
}

function formatPrLine({ prNumber, status, url }) {
  return `${statusEmoji(status)} PR #${prNumber} · ${status} · ${url} [[vr-pr:${prNumber}]]`;
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
  const found = new Map(); // key: PREFIX-num upper → { prefix, number, raw }
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

async function fetchPrCommitMessages() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return "";
  const messages = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/commits?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      console.warn(`⚠️  Impossible de lire les commits PR (${res.status})`);
      break;
    }
    const commits = await res.json();
    if (!Array.isArray(commits) || commits.length === 0) break;
    for (const c of commits) {
      if (c?.commit?.message) messages.push(c.commit.message);
    }
    if (commits.length < 100) break;
    page++;
  }
  return messages.join("\n");
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

/** Résout data_source_id (hardcodé ou via GET /databases). */
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
  // Notion REST: formes possibles selon version / type (unique_id vs auto_increment_id)
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

/** Fallback fiable : parcourt le data_source et matche le numéro ID en JS. */
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

/** Cherche le ticket dans chaque base listée ; retourne le premier hit. */
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

function richTextLine(content) {
  // Notion limite ~2000 chars par text item
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

async function ensureSectionAndUpsertPrLine(pageId, lineText, prNumber) {
  const children = await listAllChildren(pageId);
  const marker = PR_LINE_RE(prNumber);

  const existing = children.find(b => {
    if (!["paragraph", "bulleted_list_item", "to_do", "quote", "callout"].includes(b.type)) {
      return false;
    }
    return marker.test(blockPlainText(b));
  });

  if (existing) {
    const type = existing.type;
    await notionFetch(`/blocks/${existing.id}`, {
      method: "PATCH",
      body: {
        [type]: {
          rich_text: richTextLine(lineText),
        },
      },
    });
    console.log(`✏️  Ligne PR #${prNumber} mise à jour (block ${existing.id})`);
    return;
  }

  let hasHeading = children.some(
    b => (b.type === "heading_2" || b.type === "heading_3") && blockPlainText(b).trim() === SECTION_TITLE,
  );

  const toAppend = [];
  if (!hasHeading) {
    toAppend.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: SECTION_TITLE } }],
      },
    });
  }
  toAppend.push({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: richTextLine(lineText),
    },
  });

  // Notion API 2026-03-11 : append = PATCH (POST → « Invalid request URL »)
  await notionFetch(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: { children: toAppend },
  });
  console.log(`➕ Ligne PR #${prNumber} ajoutée sous « ${SECTION_TITLE} »`);
}

async function resolveTargetPages(haystack) {
  const targets = new Map(); // pageId → source

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

  // Si on a détecté des IDs mais aucune page résolue → échec explicite (évite un faux vert)
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

  const commitMessages = await fetchPrCommitMessages();
  const haystack = [PR_TITLE, PR_BODY, PR_HEAD_REF, commitMessages].filter(Boolean).join("\n");

  console.log(`📌 PR #${PR_NUMBER} — ${PR_HTML_URL}`);
  console.log(`🌿 Branche: ${PR_HEAD_REF || "(n/a)"}`);

  const targets = await resolveTargetPages(haystack);
  if (targets.size === 0) {
    console.log(
      "ℹ️  Aucun ticket Notion trouvé (ni URL Notion, ni ID type PREFIX-123 dans titre/description/branche/commits) — skip.",
    );
    process.exit(0);
  }

  const status = resolvePrStatus();
  const line = formatPrLine({ prNumber: PR_NUMBER, status, url: PR_HTML_URL });

  for (const [pageId, source] of targets) {
    console.log(`🔗 Page ${pageId} (via ${source}) → ${status}`);
    await ensureSectionAndUpsertPrLine(pageId, line, PR_NUMBER);
    // Colonnes tableau (dernière PR gagnante si plusieurs)
    try {
      await notionFetch(`/pages/${pageId}`, {
        method: "PATCH",
        body: {
          properties: {
            PR: { url: PR_HTML_URL },
            "PR status": { select: { name: status } },
          },
        },
      });
      console.log(`🧾 Propriétés PR / PR status → ${status}`);
    } catch (err) {
      console.warn(`⚠️  Update propriétés: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`✅ Sync terminée (${targets.size} page(s) Notion)`);
}

main().catch(err => {
  fail(err instanceof Error ? err.message : String(err));
});

#!/usr/bin/env node
/**
 * POC — synchronise l’état d’une PR GitHub vers une page Notion.
 *
 * Entrées (env) :
 * - NOTION_TOKEN              secret API Notion (GitHub secret NOTION_VR)
 * - PR_BODY                   corps de la PR (où coller l’URL Notion du ticket)
 * - PR_HTML_URL               URL de la PR GitHub
 * - PR_STATE                  open | closed
 * - PR_DRAFT                  true | false
 * - PR_MERGED                 true | false
 * - NOTION_PR_URL_PROPERTY    nom propriété URL (défaut: "PR")
 * - NOTION_PR_STATUS_PROPERTY nom propriété statut (défaut: "PR status")
 * - NOTION_PR_STATUS_TYPE     select | status (défaut: select)
 * - NOTION_VERSION            header API (défaut: 2022-06-28)
 *
 * Convention : coller l’URL de la page Notion ticket dans la description de la PR.
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PR_BODY = process.env.PR_BODY || "";
const PR_HTML_URL = process.env.PR_HTML_URL || "";
const PR_STATE = process.env.PR_STATE || "open";
const PR_DRAFT = process.env.PR_DRAFT === "true";
const PR_MERGED = process.env.PR_MERGED === "true";
const URL_PROP = process.env.NOTION_PR_URL_PROPERTY || "PR";
const STATUS_PROP = process.env.NOTION_PR_STATUS_PROPERTY || "PR status";
const STATUS_TYPE = process.env.NOTION_PR_STATUS_TYPE || "select";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

const NOTION_URL_RE = /https?:\/\/(?:www\.)?(?:notion\.so|notion\.site|notion\.com)\/[^\s)>\]"']+/gi;

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

/** Extrait l’UUID 32 hex d’une URL Notion (avec ou sans tirets). */
function extractNotionPageId(url) {
  const cleaned = url.split("?")[0].split("#")[0];
  const match = cleaned.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) return null;
  const raw = match[1].replace(/-/g, "").toLowerCase();
  if (raw.length !== 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function findNotionPageId(body) {
  const urls = body.match(NOTION_URL_RE) || [];
  for (const url of urls) {
    const id = extractNotionPageId(url);
    if (id) {
      return { id, url };
    }
  }
  return null;
}

async function patchNotionPage(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
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
    fail(`Notion API ${res.status}: ${detail}`);
  }
  return json;
}

async function main() {
  if (!NOTION_TOKEN) fail("NOTION_TOKEN manquant (secret GitHub NOTION_VR).");
  if (!PR_HTML_URL) fail("PR_HTML_URL manquant.");

  const found = findNotionPageId(PR_BODY);
  if (!found) {
    console.log("ℹ️  Aucune URL Notion trouvée dans la description de la PR — skip.");
    process.exit(0);
  }

  const statusName = resolvePrStatus();
  console.log(`🔗 Notion page: ${found.id} (depuis ${found.url})`);
  console.log(`📌 PR: ${PR_HTML_URL}`);
  console.log(`📊 Status → ${statusName}`);

  const statusValue = STATUS_TYPE === "status" ? { status: { name: statusName } } : { select: { name: statusName } };

  const properties = {
    [URL_PROP]: { url: PR_HTML_URL },
    [STATUS_PROP]: statusValue,
  };

  await patchNotionPage(found.id, properties);
  console.log(`✅ Notion mis à jour (${URL_PROP} + ${STATUS_PROP}=${statusName})`);
}

main().catch(err => {
  fail(err instanceof Error ? err.message : String(err));
});

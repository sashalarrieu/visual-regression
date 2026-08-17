/** Entrée Storybook telle que renvoyée par `index.json`. */
export type StorybookIndexEntry = {
  id: string;
  type?: string;
  importPath?: string;
  title?: string;
  name?: string;
  tags?: string[];
};

type IndexCacheEntry = {
  entries: Record<string, StorybookIndexEntry>;
  fetchedAt: number;
};

export type FetchStorybookIndexOptions = {
  /** Tentatives réseau (défaut: 1 si cache chaud, sinon 3). */
  retries?: number;
  /** Délai entre tentatives en ms. */
  retryDelayMs?: number;
};

const indexCacheByUrl = new Map<string, IndexCacheEntry>();

const DEFAULT_RETRY_DELAY_MS = 400;
const DEFAULT_RETRIES_WITHOUT_CACHE = 3;

const normalizeStorybookUrl = (storybookUrl: string): string => storybookUrl.replace(/\/$/, "");

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const isTransientNetworkError = (err: unknown): boolean => {
  const codes = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ECONNABORTED"]);
  const hasCode = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const code = (value as NodeJS.ErrnoException).code;
    return typeof code === "string" && codes.has(code);
  };
  if (hasCode(err)) return true;
  if (err && typeof err === "object" && "cause" in err) {
    return hasCode((err as { cause?: unknown }).cause);
  }
  return false;
};

const isTransientHttpStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;

const parseIndexResponse = async (res: Response): Promise<Record<string, StorybookIndexEntry>> => {
  const data = (await res.json()) as { entries?: Record<string, StorybookIndexEntry> };
  return data.entries ?? {};
};

/**
 * Lit `index.json` Storybook avec cache en mémoire.
 * Rebuild / redémarrage sidecar : retries silencieux puis repli cache (sans warn).
 */
export const fetchStorybookIndexEntries = async (
  storybookUrl: string,
  options?: FetchStorybookIndexOptions,
): Promise<Record<string, StorybookIndexEntry>> => {
  const baseUrl = normalizeStorybookUrl(storybookUrl);
  const cached = indexCacheByUrl.get(baseUrl);
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxAttempts = options?.retries ?? (cached ? 1 : DEFAULT_RETRIES_WITHOUT_CACHE);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/index.json`);
      if (res.ok) {
        const entries = await parseIndexResponse(res);
        indexCacheByUrl.set(baseUrl, { entries, fetchedAt: Date.now() });
        return entries;
      }

      if (cached) return cached.entries;

      if (isTransientHttpStatus(res.status) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }

      if (attempt === maxAttempts && !isTransientHttpStatus(res.status)) {
        console.warn(`⚠️  Storybook index.json HTTP ${res.status} (${baseUrl})`);
      }
      return {};
    } catch (err) {
      if (cached) return cached.entries;

      if (isTransientNetworkError(err) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }

      if (attempt === maxAttempts && !isTransientNetworkError(err)) {
        console.warn(`⚠️  Storybook index.json illisible (${baseUrl})`);
      }
      return {};
    }
  }

  return cached?.entries ?? {};
};

/** Pré-charge le cache index (démarrage serveur VR). */
export const warmStorybookIndexCache = (storybookUrl: string): void => {
  void fetchStorybookIndexEntries(storybookUrl);
};

/** Vide le cache index (tests ou changement d’URL Storybook). */
export const resetStorybookIndexCache = (storybookUrl?: string): void => {
  if (storybookUrl) {
    indexCacheByUrl.delete(normalizeStorybookUrl(storybookUrl));
    return;
  }
  indexCacheByUrl.clear();
};

/** Expose le cache pour les tests. */
export const getStorybookIndexCacheForTests = (): Map<string, IndexCacheEntry> => indexCacheByUrl;

/** Entrées index en cache (sans fetch réseau) — pour filtrer ignore-vr hors ligne. */
export const peekStorybookIndexEntries = (storybookUrl: string): Record<string, StorybookIndexEntry> | undefined =>
  indexCacheByUrl.get(normalizeStorybookUrl(storybookUrl))?.entries;

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config, isFlaresolverrConfigured } from '../config.js';

const DEFAULT_TIMEOUT = 30000;
const FLARESOLVERR_TIMEOUT = 60000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache HTML en mémoire
interface CacheEntry {
  html: string;
  timestamp: number;
}

const htmlCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedHtml(url: string): string | null {
  const entry = htmlCache.get(url);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    console.log(`[Cache] HIT for ${url}`);
    return entry.html;
  }
  if (entry) {
    htmlCache.delete(url); // Expire le cache
  }
  return null;
}

function setCachedHtml(url: string, html: string): void {
  htmlCache.set(url, { html, timestamp: Date.now() });
  console.log(`[Cache] Stored ${url} (${html.length} chars)`);
}

// Nettoie le cache périodiquement (toutes les 10 minutes)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [url, entry] of htmlCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      htmlCache.delete(url);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cache] Cleaned ${cleaned} expired entries`);
  }
}, 10 * 60 * 1000);

interface FlaresolverrResponse {
  status: string;
  message: string;
  solution?: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string;
    cookies: Array<{ name: string; value: string }>;
    userAgent: string;
  };
}

export function createHttpClient(baseURL?: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
}

async function fetchViaFlaresolverr(url: string): Promise<string> {
  const response = await axios.post<FlaresolverrResponse>(
    config.flaresolverrUrl,
    {
      cmd: 'request.get',
      url,
      maxTimeout: FLARESOLVERR_TIMEOUT,
    },
    {
      timeout: FLARESOLVERR_TIMEOUT + 5000,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  if (response.data.status !== 'ok' || !response.data.solution) {
    throw new Error(`FlareSolverr error: ${response.data.message}`);
  }

  return response.data.solution.response;
}

async function fetchDirect(url: string, configOpts?: AxiosRequestConfig): Promise<string> {
  const client = createHttpClient();
  const response = await client.get<string>(url, {
    ...configOpts,
    responseType: 'text',
  });
  return response.data;
}

export async function fetchHtml(url: string, configOpts?: AxiosRequestConfig): Promise<string> {
  // Vérifie le cache d'abord
  const cached = getCachedHtml(url);
  if (cached) {
    return cached;
  }

  // Try direct fetch first
  try {
    const html = await fetchDirect(url, configOpts);
    setCachedHtml(url, html); // Cache la réponse
    return html;
  } catch (error: any) {
    // If we get a 403/503 and FlareSolverr is configured, try via FlareSolverr
    const status = error?.response?.status;
    if (isFlaresolverrConfigured() && (status === 403 || status === 503 || status === 429)) {
      console.log(`Direct fetch failed (${status}), trying FlareSolverr for: ${url}`);
      const html = await fetchViaFlaresolverr(url);
      setCachedHtml(url, html); // Cache aussi les réponses FlareSolverr
      return html;
    }
    throw error;
  }
}

export async function fetchHtmlWithFlaresolverr(url: string): Promise<string> {
  if (isFlaresolverrConfigured()) {
    return fetchViaFlaresolverr(url);
  }
  return fetchDirect(url);
}

export async function fetchJson<T>(url: string, configOpts?: AxiosRequestConfig): Promise<T> {
  const client = createHttpClient();
  const response = await client.get<T>(url, {
    ...configOpts,
    responseType: 'json',
  });
  return response.data;
}

export function encodeSearchQuery(query: string): string {
  return encodeURIComponent(query.trim().toLowerCase());
}

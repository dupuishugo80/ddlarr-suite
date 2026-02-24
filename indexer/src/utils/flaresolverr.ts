import axios from 'axios';
import { fetchHtml } from './http.js';
import { config } from '../config.js';

/**
 * Fetch HTML with FlareSolverr fallback
 * 1. Try direct fetch via axios (uses existing cache)
 * 2. If 403/503 (Cloudflare), fallback to FlareSolverr
 */
export async function fetchHtmlSmart(url: string): Promise<string> {
  try {
    return await fetchHtml(url);
  } catch (error: any) {
    const status = error?.response?.status;
    if ((status === 403 || status === 503) && config.flaresolverrUrl) {
      console.log(`[FlareSolverr] Direct fetch failed (${status}), trying FlareSolverr for: ${url}`);
      return await fetchViaFlaresolverr(url);
    }
    throw error;
  }
}

/**
 * Fetch HTML via FlareSolverr service
 */
async function fetchViaFlaresolverr(url: string): Promise<string> {
  const flaresolverrUrl = config.flaresolverrUrl;
  if (!flaresolverrUrl) {
    throw new Error('FlareSolverr URL not configured');
  }

  try {
    const response = await axios.post<{
      status: string;
      message: string;
      solution: {
        url: string;
        status: number;
        headers: Record<string, string>;
        response: string;
        cookies: Array<{ name: string; value: string }>;
        userAgent: string;
      };
    }>(
      `${flaresolverrUrl}/v1`,
      {
        cmd: 'request.get',
        url,
        maxTimeout: 60000,
      },
      {
        timeout: 70000, // Slightly more than maxTimeout
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.status === 'ok' && response.data.solution?.response) {
      console.log(`[FlareSolverr] Successfully fetched: ${url}`);
      return response.data.solution.response;
    }

    throw new Error(`FlareSolverr returned status: ${response.data.status} - ${response.data.message}`);
  } catch (error: any) {
    console.error(`[FlareSolverr] Error fetching ${url}:`, error.message);
    throw error;
  }
}

/**
 * Check if FlareSolverr service is available
 */
export async function checkFlaresolverrHealth(): Promise<boolean> {
  if (!config.flaresolverrUrl) return false;
  try {
    const response = await axios.get(`${config.flaresolverrUrl}/health`, { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}

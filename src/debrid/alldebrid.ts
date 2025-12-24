import axios from 'axios';
import { config } from '../config.js';

// Domains that need redirector resolution first
const REDIRECTOR_DOMAINS = [
  'dl-protect.link',
  'dl-protect.net',
  'dl-protect.org',
];

const ALLDEBRID_API_BASE = 'https://api.alldebrid.com/v4';

// Cache for unavailable hosts (15 minutes TTL)
const UNAVAILABLE_HOST_TTL = 15 * 60 * 1000;
const unavailableHosts = new Map<string, number>();

// Error codes that indicate host is temporarily unavailable
const HOST_UNAVAILABLE_CODES = [
  'LINK_HOST_NOT_SUPPORTED',
  'LINK_HOST_UNAVAILABLE',
  'LINK_HOST_FULL',
  'LINK_HOST_LIMIT_REACHED',
];

interface AllDebridResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface DebridLink {
  link: string;
  filename?: string;
  host?: string;
  filesize?: number;
}

interface RedirectorResult {
  links: string[];
}

export class AllDebridClient {
  private readonly apiKey: string | null = null;

  constructor(apiKey?: string) {
    const key = apiKey || config.alldebridApiKey;
    if (key) {
      this.apiKey = key;
    }
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Extract hostname from a URL
   */
  private getHostFromUrl(link: string): string | null {
    try {
      const url = new URL(link);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  /**
   * Check if a host is marked as unavailable
   */
  private isHostUnavailable(host: string): boolean {
    const unavailableSince = unavailableHosts.get(host);
    if (!unavailableSince) {
      return false;
    }

    // Check if TTL has expired
    if (Date.now() - unavailableSince > UNAVAILABLE_HOST_TTL) {
      unavailableHosts.delete(host);
      console.log(`Host ${host} is now available again (TTL expired)`);
      return false;
    }

    return true;
  }

  /**
   * Mark a host as unavailable
   */
  private markHostUnavailable(host: string): void {
    unavailableHosts.set(host, Date.now());
    const expiresIn = Math.round(UNAVAILABLE_HOST_TTL / 60000);
    console.log(`Host ${host} marked as unavailable for ${expiresIn} minutes`);
  }

  /**
   * Check if a link needs redirector resolution (dl-protect, etc.)
   */
  private needsRedirector(link: string): boolean {
    try {
      const url = new URL(link);
      return REDIRECTOR_DOMAINS.some(domain => url.hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Clean a dl-protect link by removing query parameters
   * https://dl-protect.link/abc123?fn=xxx&rl=yyy → https://dl-protect.link/abc123
   */
  private cleanDlProtectLink(link: string): string {
    try {
      const url = new URL(link);
      if (REDIRECTOR_DOMAINS.some(domain => url.hostname.includes(domain))) {
        return `${url.origin}${url.pathname}`;
      }
      return link;
    } catch {
      return link;
    }
  }

  /**
   * Resolve a protected link via the AllDebrid redirector API
   */
  private async resolveRedirector(link: string): Promise<string[]> {
    if (!this.apiKey) {
      return [link];
    }

    try {
      const formData = new FormData();
      formData.append('link', link);

      const response = await axios.post<AllDebridResponse<RedirectorResult>>(
        `${ALLDEBRID_API_BASE}/link/redirector`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      if (response.data.status === 'success' && response.data.data?.links && response.data.data.links.length > 0) {
        console.log(`AllDebrid redirector resolved ${link} to ${response.data.data.links.length} links`);
        return response.data.data.links;
      }

      if (response.data.error) {
        console.warn(`AllDebrid redirector error: ${response.data.error.message}`);
      }
    } catch (error) {
      console.error('AllDebrid redirector error:', error);
    }

    return [link];
  }

  /**
   * Unlock a single link via the debrid API
   * Returns null if debrid fails (caller should use fallback)
   */
  private async debridLink(link: string): Promise<string | null> {
    if (!this.apiKey) {
      return null;
    }

    // Check if host is temporarily unavailable
    const host = this.getHostFromUrl(link);
    if (host && this.isHostUnavailable(host)) {
      console.log(`Skipping ${link} - host ${host} is temporarily unavailable`);
      return null;
    }

    try {
      const formData = new FormData();
      formData.append('link', link);

      const response = await axios.post<AllDebridResponse<DebridLink>>(
        `${ALLDEBRID_API_BASE}/link/unlock`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      if (response.data.status === 'success' && response.data.data?.link) {
        return response.data.data.link;
      }

      if (response.data.error) {
        const errorCode = response.data.error.code;
        console.warn(`Debrid error for ${link}: ${response.data.error.message} (${errorCode})`);

        // Mark host as unavailable if it's a host-related error
        if (host && HOST_UNAVAILABLE_CODES.includes(errorCode)) {
          this.markHostUnavailable(host);
        }
      }
      return null;
    } catch (error) {
      console.error('Debrid error:', error);
      return null;
    }
  }

  async unlockLink(link: string, originalLink?: string): Promise<string> {
    // Always clean dl-protect links, even without AllDebrid
    if (!this.apiKey) {
      return this.cleanDlProtectLink(link);
    }

    // Keep track of the original link for fallback (cleaned if dl-protect)
    const fallbackLink = this.cleanDlProtectLink(originalLink || link);

    try {
      // If it's a protected link (dl-protect), try to resolve it via AllDebrid
      if (this.needsRedirector(link)) {
        const resolvedLinks = await this.resolveRedirector(link);
        if (resolvedLinks.length > 0 && resolvedLinks[0] !== link) {
          // Try to unlock the resolved link, passing original for fallback
          return this.unlockLink(resolvedLinks[0], link);
        }
        // AllDebrid couldn't resolve, return cleaned dl-protect link
        return fallbackLink;
      }

      // Try to debrid the link
      const debriddedLink = await this.debridLink(link);
      if (debriddedLink) {
        return debriddedLink;
      }

      // Debrid failed, return original link (cleaned)
      console.log(`Debrid failed, returning original link: ${fallbackLink}`);
      return fallbackLink;
    } catch (error) {
      console.error('AllDebrid error:', error);
      return fallbackLink;
    }
  }

  async unlockLinks(links: string[]): Promise<string[]> {
    if (!this.apiKey) {
      return links;
    }

    const results = await Promise.allSettled(
      links.map((link) => this.unlockLink(link))
    );

    return results.map((result, index) =>
      result.status === 'fulfilled' ? result.value : links[index]
    );
  }

  async checkStatus(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await axios.get<AllDebridResponse<{ user: { isPremium: boolean } }>>(
        `${ALLDEBRID_API_BASE}/user`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      return response.data.status === 'success' && response.data.data?.user?.isPremium === true;
    } catch {
      return false;
    }
  }
}

export const alldebrid = new AllDebridClient();

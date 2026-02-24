import * as cheerio from 'cheerio';
import { BaseScraper, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtmlSmart } from '../utils/flaresolverr.js';
import { encodeSearchQuery } from '../utils/http.js';
import { config } from '../config.js';

interface BookysItem {
  title: string;
  pageUrl: string;
}

export class BookysScraper implements BaseScraper {
  readonly name = 'Bookys';

  constructor(public readonly baseUrl: string) {}

  /**
   * Generic search — only searches ebooks (journaux)
   */
  async search(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchEbooks(params);
  }

  async searchMovies(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  async searchSeries(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  async searchAnime(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  /**
   * Search ebooks (journaux)
   * - With query: uses /search?q=...
   * - Without query: RSS mode, scrapes /journaux/new
   */
  async searchEbooks(params: SearchParams): Promise<ScraperResult[]> {
    try {
      let items: BookysItem[];

      if (params.q) {
        items = await this.searchByQuery(params.q);
      } else {
        items = await this.fetchNewItems();
      }

      console.log(`[Bookys] Found ${items.length} items`);

      if (items.length === 0) {
        return [];
      }

      // Visit detail pages (limit to 20 to avoid too many requests)
      const pagesToVisit = items.slice(0, 20);
      const allResults: ScraperResult[] = [];

      for (const item of pagesToVisit) {
        try {
          const results = await this.parseDetailPage(item, params);
          allResults.push(...results);
        } catch (error) {
          console.error(`[Bookys] Error parsing detail page ${item.pageUrl}:`, error);
        }
      }

      console.log(`[Bookys] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[Bookys] Search error:`, error);
      return [];
    }
  }

  /**
   * Fetch newest items from /journaux/new (RSS mode)
   */
  private async fetchNewItems(): Promise<BookysItem[]> {
    const allItems: BookysItem[] = [];
    const maxPages = config.searchMaxPages;

    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? `${this.baseUrl}/journaux/new`
        : `${this.baseUrl}/journaux/new?page=${page}`;

      console.log(`[Bookys] Fetching new items page ${page}: ${url}`);

      try {
        const html = await fetchHtmlSmart(url);
        const items = this.parseListPage(html);
        allItems.push(...items);

        // Check for next page
        const $ = cheerio.load(html);
        const hasNextPage = $('a[rel="next"]').length > 0;
        if (!hasNextPage) {
          console.log(`[Bookys] No more pages after page ${page}`);
          break;
        }
      } catch (error) {
        console.error(`[Bookys] Error fetching page ${page}:`, error);
        break;
      }
    }

    return allItems;
  }

  /**
   * Search by query using /search endpoint
   */
  private async searchByQuery(query: string): Promise<BookysItem[]> {
    const searchUrl = `${this.baseUrl}/search?q=${encodeSearchQuery(query)}`;
    console.log(`[Bookys] Searching: ${searchUrl}`);

    try {
      const html = await fetchHtmlSmart(searchUrl);
      // Filter only /journaux/ results
      const allItems = this.parseListPage(html);
      const journauxItems = allItems.filter(item => item.pageUrl.includes('/journaux/'));

      console.log(`[Bookys] Search returned ${allItems.length} items, ${journauxItems.length} journaux`);
      return journauxItems;
    } catch (error) {
      console.error(`[Bookys] Search error:`, error);
      return [];
    }
  }

  /**
   * Parse a list page (new or search results) to extract item links
   */
  private parseListPage(html: string): BookysItem[] {
    const $ = cheerio.load(html);
    const items: BookysItem[] = [];

    $('.bys-items-container a.bys-item').each((_, element) => {
      try {
        const $item = $(element);
        const href = $item.attr('href');
        const title = $item.find('.item-details b.font-bold').first().text().trim();

        if (!href || !title) return;

        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        items.push({ title, pageUrl });
      } catch {
        // Skip invalid items
      }
    });

    return items;
  }

  /**
   * Parse a detail page to extract download links
   */
  private async parseDetailPage(
    item: BookysItem,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[Bookys] Fetching detail page: ${item.pageUrl}`);

    const html = await fetchHtmlSmart(item.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extract title from h1
    const pageTitle = $('h1[itemprop="name"]').text().trim() || item.title;

    // Extract date from meta tag
    let pubDate: Date | undefined;
    const releaseDateStr = $('meta[name="book:release_date"]').attr('content');
    if (releaseDateStr) {
      pubDate = new Date(releaseDateStr);
      if (isNaN(pubDate.getTime())) {
        pubDate = undefined;
      }
    }

    // Extract item ID
    const itemId = $('meta[name="item_id"]').attr('content');

    // Parse download table
    $('#links-wrapper table tbody tr[data-id]').each((_, row) => {
      try {
        const $row = $(row);
        const cells = $row.find('td');
        if (cells.length < 4) return;

        // Hoster name and download link
        const $hostLink = $(cells[0]).find('a.bys-host').first();
        const hoster = $hostLink.text().trim();
        const downloadLink = $hostLink.attr('href');

        if (!hoster || !downloadLink) return;

        const hosterLower = hoster.toLowerCase();

        // Filter by hoster if specified
        if (params.hoster) {
          const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
          if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
            console.log(`[Bookys] Skipping hoster "${hoster}" - not in allowed list: ${params.hoster}`);
            return;
          }
        }

        // Format
        const format = $(cells[1]).text().trim(); // e.g., "PDF"

        // Language
        const language = $(cells[2]).text().trim(); // e.g., "Français"

        // Size
        const sizeText = $(cells[3]).text().trim(); // e.g., "653 MB"
        const size = parseSize(sizeText);

        // Build formatted title
        // "Journaux Français Locaux Du Lundi 23 Février 2026" → "Journaux.Français.Locaux.Du.Lundi.23.Février.2026.PDF.FRENCH.1fichier"
        const cleanTitle = pageTitle
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, '.')
          .replace(/\.{2,}/g, '.');

        const titleParts: string[] = [cleanTitle];
        if (format) titleParts.push(format.toUpperCase());
        if (language) {
          // Normalize language
          const langUpper = language.toUpperCase();
          if (langUpper.includes('FRAN')) {
            titleParts.push('FRENCH');
          } else {
            titleParts.push(langUpper);
          }
        }
        titleParts.push(hoster);

        const formattedTitle = titleParts.join('.');

        // Full download link
        const fullDownloadLink = downloadLink.startsWith('http')
          ? downloadLink
          : `${this.baseUrl}${downloadLink}`;

        results.push({
          title: formattedTitle,
          link: fullDownloadLink,
          pageUrl: item.pageUrl,
          size,
          quality: format || undefined,
          language: language || undefined,
          pubDate,
          contentType: 'ebook' as ContentType,
        });

        console.log(`[Bookys] Found download: ${formattedTitle} (${hoster}, ${sizeText})`);
      } catch {
        // Skip invalid rows
      }
    });

    console.log(`[Bookys] Found ${results.length} download links on detail page`);
    return results;
  }
}

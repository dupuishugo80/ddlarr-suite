import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getScraper, isValidSite, getAvailableSites, contentTypeToCategory } from '../scrapers/index.js';
import { alldebrid } from '../debrid/index.js';
import { buildTorznabResponse, buildCapsResponse, buildErrorResponse } from '../utils/xml.js';
import { TorznabItem, TorznabCaps, TorznabCategory, SearchParams, ScraperResult } from '../models/torznab.js';
import { SiteType } from '../config.js';

interface TorznabQuerystring {
  t?: string;
  q?: string;
  cat?: string;
  limit?: string;
  offset?: string;
  imdbid?: string;
  tmdbid?: string;
  tvdbid?: string;
  season?: string;
  ep?: string;
  apikey?: string;
  hoster?: string;
}

interface SiteParams {
  site: string;
}

function getCapsForSite(siteName: string): TorznabCaps {
  return {
    server: {
      title: `DDL Torznab - ${siteName}`,
    },
    limits: {
      default: 100,
      max: 500,
    },
    searching: {
      search: { available: true },
      tvsearch: { available: true },
      moviesearch: { available: true },
    },
    categories: [
      { id: TorznabCategory.Movies, name: 'Movies' },
      { id: TorznabCategory.MoviesHD, name: 'Movies/HD' },
      { id: TorznabCategory.MoviesUHD, name: 'Movies/UHD' },
      { id: TorznabCategory.TV, name: 'TV' },
      { id: TorznabCategory.TVHD, name: 'TV/HD' },
      { id: TorznabCategory.TVUHD, name: 'TV/UHD' },
      { id: TorznabCategory.Anime, name: 'Anime' },
    ],
  };
}

async function processResults(results: ScraperResult[]): Promise<TorznabItem[]> {
  const items: TorznabItem[] = [];

  for (const result of results) {
    // Process link (debrid if configured, clean dl-protect links)
    const link = await alldebrid.unlockLink(result.link);

    items.push({
      title: result.title,
      guid: Buffer.from(result.link).toString('base64').slice(0, 40),
      link,
      pubDate: result.pubDate,
      size: result.size,
      category: contentTypeToCategory(result.contentType, result.quality),
      imdbId: result.imdbId,
      tmdbId: result.tmdbId,
      season: result.season,
      episode: result.episode,
      quality: result.quality,
      language: result.language,
    });
  }

  return items;
}

export async function torznabRoutes(app: FastifyInstance): Promise<void> {
  // Health check
  app.get('/health', async () => {
    return { status: 'ok', sites: getAvailableSites() };
  });

  // List available sites
  app.get('/sites', async () => {
    return { sites: getAvailableSites() };
  });

  // Torznab API endpoint
  app.get<{
    Params: SiteParams;
    Querystring: TorznabQuerystring;
  }>('/api/:site', async (request: FastifyRequest<{ Params: SiteParams; Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { site } = request.params;
    const { t: action, q, cat, limit, offset, imdbid, tmdbid, tvdbid, season, ep, hoster } = request.query;

    // Parse category filter
    const categoryFilter = cat
      ? cat.split(',').map(c => parseInt(c.trim(), 10)).filter(c => !isNaN(c))
      : null;

    // Validate site
    if (!isValidSite(site)) {
      reply.type('application/xml');
      return buildErrorResponse(100, `Unknown site: ${site}. Available: ${getAvailableSites().join(', ')}`);
    }

    const scraper = getScraper(site as SiteType);
    if (!scraper) {
      reply.type('application/xml');
      return buildErrorResponse(100, `Site ${site} is not configured`);
    }

    reply.type('application/xml');

    // Handle capabilities request
    if (action === 'caps') {
      return buildCapsResponse(getCapsForSite(scraper.name));
    }

    // Validate action
    if (!action || !['search', 'tvsearch', 'movie'].includes(action)) {
      return buildErrorResponse(200, 'Missing or invalid parameter t');
    }

    // Build search params
    const searchParams: SearchParams = {
      q: q || '',
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
      imdbid,
      tmdbid,
      tvdbid,
      season,
      ep,
      hoster,
    };

    if (!searchParams.q && !imdbid && !tmdbid && !tvdbid) {
      return buildErrorResponse(200, 'Missing search query');
    }

    try {
      let results: ScraperResult[] = [];

      switch (action) {
        case 'search':
          results = await scraper.search(searchParams);
          break;
        case 'movie':
          results = await scraper.searchMovies(searchParams);
          break;
        case 'tvsearch':
          results = await scraper.searchSeries(searchParams);
          break;
      }

      // Process results
      let items = await processResults(results);

      // Filter by category if specified
      if (categoryFilter && categoryFilter.length > 0) {
        items = items.filter(item => categoryFilter.includes(item.category));
      }

      // Apply limit and offset
      const start = searchParams.offset || 0;
      const end = start + (searchParams.limit || 100);
      const paginatedItems = items.slice(start, end);

      return buildTorznabResponse(paginatedItems, scraper.name);
    } catch (error) {
      console.error(`Search error for ${site}:`, error);
      return buildErrorResponse(900, 'Internal server error');
    }
  });
}

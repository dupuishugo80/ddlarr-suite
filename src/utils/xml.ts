import { XMLBuilder } from 'fast-xml-parser';
import { TorznabItem, TorznabCaps, TorznabCategory } from '../models/torznab.js';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

function formatDate(date: Date): string {
  return date.toUTCString();
}

function categoryToName(category: TorznabCategory): string {
  const names: Record<TorznabCategory, string> = {
    [TorznabCategory.Movies]: 'Movies',
    [TorznabCategory.MoviesSD]: 'Movies/SD',
    [TorznabCategory.MoviesHD]: 'Movies/HD',
    [TorznabCategory.MoviesUHD]: 'Movies/UHD',
    [TorznabCategory.Movies3D]: 'Movies/3D',
    [TorznabCategory.TV]: 'TV',
    [TorznabCategory.TVSD]: 'TV/SD',
    [TorznabCategory.TVHD]: 'TV/HD',
    [TorznabCategory.TVUHD]: 'TV/UHD',
    [TorznabCategory.Anime]: 'Anime',
  };
  return names[category] || 'Other';
}

export function buildTorznabResponse(items: TorznabItem[], siteTitle: string): string {
  const rssItems = items.map((item) => {
    const torznabAttrs: Array<{ '@_name': string; '@_value': string }> = [
      { '@_name': 'category', '@_value': String(item.category) },
    ];

    if (item.imdbId) {
      torznabAttrs.push({ '@_name': 'imdb', '@_value': item.imdbId });
    }
    if (item.tmdbId) {
      torznabAttrs.push({ '@_name': 'tmdbid', '@_value': item.tmdbId });
    }
    if (item.tvdbId) {
      torznabAttrs.push({ '@_name': 'tvdbid', '@_value': item.tvdbId });
    }
    if (item.season !== undefined) {
      torznabAttrs.push({ '@_name': 'season', '@_value': String(item.season) });
    }
    if (item.episode !== undefined) {
      torznabAttrs.push({ '@_name': 'episode', '@_value': String(item.episode) });
    }
    if (item.size) {
      torznabAttrs.push({ '@_name': 'size', '@_value': String(item.size) });
    }

    return {
      title: item.title,
      guid: item.guid,
      link: item.link,
      pubDate: item.pubDate ? formatDate(item.pubDate) : formatDate(new Date()),
      size: item.size || 0,
      category: { '#text': categoryToName(item.category), '@_id': String(item.category) },
      'torznab:attr': torznabAttrs,
    };
  });

  const rss = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    rss: {
      '@_version': '2.0',
      '@_xmlns:atom': 'http://www.w3.org/2005/Atom',
      '@_xmlns:torznab': 'http://torznab.com/schemas/2015/feed',
      channel: {
        title: `DDL Torznab - ${siteTitle}`,
        description: `DDL indexer for ${siteTitle}`,
        item: rssItems,
      },
    },
  };

  return xmlBuilder.build(rss);
}

export function buildCapsResponse(caps: TorznabCaps): string {
  const capsXml = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    caps: {
      server: { '@_title': caps.server.title },
      limits: {
        '@_default': String(caps.limits.default),
        '@_max': String(caps.limits.max),
      },
      searching: {
        search: { '@_available': caps.searching.search.available ? 'yes' : 'no' },
        'tv-search': { '@_available': caps.searching.tvsearch.available ? 'yes' : 'no' },
        'movie-search': { '@_available': caps.searching.moviesearch.available ? 'yes' : 'no' },
      },
      categories: {
        category: caps.categories.map((cat) => ({
          '@_id': String(cat.id),
          '@_name': cat.name,
        })),
      },
    },
  };

  return xmlBuilder.build(capsXml);
}

export function buildErrorResponse(code: number, description: string): string {
  const errorXml = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    error: {
      '@_code': String(code),
      '@_description': description,
    },
  };

  return xmlBuilder.build(errorXml);
}

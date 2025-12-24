import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';

type ZTContentType = 'films' | 'series' | 'mangas';

// Mapping pour le paramètre de recherche
const CONTENT_TYPE_MAP: Record<string, ZTContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
}

export class ZoneTelechargerScraper implements BaseScraper {
  readonly name = 'Zone-Téléchargement';

  constructor(public readonly baseUrl: string) {}

  // Normalise une chaîne pour la comparaison (minuscules, sans accents, sans caractères spéciaux)
  private normalizeForMatch(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
      .replace(/[^a-z0-9]/g, ''); // Garde uniquement lettres et chiffres
  }

  // Calcule la distance de Levenshtein entre deux chaînes
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // suppression
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  // Vérifie si deux noms de séries sont suffisamment proches
  private isSeriesNameMatch(searchQuery: string, foundName: string): boolean {
    const normalizedQuery = this.normalizeForMatch(searchQuery);
    const normalizedFound = this.normalizeForMatch(foundName);

    // Si les deux sont identiques, c'est un match direct
    if (normalizedQuery === normalizedFound) {
      console.log(`[ZoneTelecharger] Exact match: "${searchQuery}" = "${foundName}"`);
      return true;
    }

    // Calcule la distance de Levenshtein
    const distance = this.levenshteinDistance(normalizedQuery, normalizedFound);

    // La distance autorisée dépend de la longueur de la recherche
    const queryLength = normalizedQuery.length;
    let allowedDistance: number;

    if (queryLength <= 5) {
      allowedDistance = 1;
    } else if (queryLength <= 10) {
      allowedDistance = 2;
    } else {
      allowedDistance = Math.floor(queryLength * 0.2);
    }

    console.log(`[ZoneTelecharger] Comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

    return distance <= allowedDistance;
  }

  // Extrait le nom de la série depuis le titre (enlève la partie "Saison X" et langue)
  private extractSeriesName(titleHtml: string): { seriesName: string; season?: number } {
    // Enlève les tags HTML
    const cleanTitle = titleHtml
      .replace(/<[^>]+>/g, '') // Supprime les tags HTML
      .replace(/\s+/g, ' ')    // Normalise les espaces
      .trim();

    // Split sur " - " pour séparer les parties
    const parts = cleanTitle.split(' - ');

    if (parts.length >= 2) {
      let seriesName = '';
      let season: number | undefined;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        const seasonMatch = part.match(/^saison\s*(\d+)$/i);

        if (seasonMatch) {
          season = parseInt(seasonMatch[1], 10);
          seriesName = parts.slice(0, i).join(' - ').trim();
          break;
        }
      }

      if (!seriesName) {
        seriesName = parts.slice(0, -1).join(' - ').trim();
      }

      return { seriesName, season };
    }

    return { seriesName: cleanTitle };
  }

  async search(params: SearchParams): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    const [movies, series, anime] = await Promise.allSettled([
      this.searchMovies(params),
      this.searchSeries(params),
      this.searchAnime(params),
    ]);

    if (movies.status === 'fulfilled') results.push(...movies.value);
    if (series.status === 'fulfilled') results.push(...series.value);
    if (anime.status === 'fulfilled') results.push(...anime.value);

    return results;
  }

  async searchMovies(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'movie');
  }

  async searchSeries(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'series');
  }

  async searchAnime(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'anime');
  }

  private async searchByType(params: SearchParams, contentType: ContentType): Promise<ScraperResult[]> {
    if (!params.q) return [];

    const ztType = CONTENT_TYPE_MAP[contentType];

    // Construit le terme de recherche
    let searchTerm = params.q;
    if (params.season) {
      searchTerm += ` Saison ${params.season}`;
    }

    // URL de recherche Zone-Téléchargement
    const baseSearchUrl = `${this.baseUrl}/?search=${encodeSearchQuery(searchTerm)}&p=${ztType}`;

    console.log(`[ZoneTelecharger] Searching ${contentType}: ${baseSearchUrl}`);

    try {
      // Récupère toutes les pages de résultats
      const allSearchResults = await this.fetchAllPages(baseSearchUrl, contentType, params);
      console.log(`[ZoneTelecharger] Found ${allSearchResults.length} total search results across all pages`);

      if (allSearchResults.length === 0) {
        return [];
      }

      // Pour chaque résultat, visite la page et récupère les liens de téléchargement
      const allResults: ScraperResult[] = [];

      // Limite à 10 résultats pour éviter trop de requêtes
      const pagesToVisit = allSearchResults.slice(0, 10);

      for (const result of pagesToVisit) {
        try {
          const episodes = await this.parseDetailPage(result, contentType, params);
          allResults.push(...episodes);
        } catch (error) {
          console.error(`[ZoneTelecharger] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[ZoneTelecharger] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[ZoneTelecharger] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = 5; // Limite pour éviter trop de requêtes

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[ZoneTelecharger] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params);

        if (results.length === 0) {
          console.log(`[ZoneTelecharger] No results on page ${currentPage}, stopping pagination`);
          break;
        }

        allResults.push(...results);

        // Vérifie s'il y a une page suivante (div.navigation a[rel="next"])
        const $ = cheerio.load(html);
        const hasNextPage = $('div.navigation a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[ZoneTelecharger] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[ZoneTelecharger] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[ZoneTelecharger] Parsing search results for ${contentType}`);

    // Parse les blocs .cover_global
    $('.cover_global').each((_, block) => {
      try {
        const $block = $(block);

        // Titre et lien dans div.cover_infos_title > a
        const $titleLink = $block.find('div.cover_infos_title > a').first();

        if ($titleLink.length === 0) return;

        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Langue dans div.cover_infos_title > .detail_release > span > b
        const langText = $block.find('div.cover_infos_title .detail_release > span > b').text().trim();
        const language = parseLanguage(langText) || parseLanguage(title);

        const { seriesName, season: extractedSeason } = this.extractSeriesName(titleHtml);

        console.log(`[ZoneTelecharger] Parsed title: "${title}" -> series="${seriesName}", season=${extractedSeason}, lang="${langText}"`);

        // Vérifie que le nom de la série correspond à la recherche (Levenshtein)
        if (params.q && seriesName) {
          if (!this.isSeriesNameMatch(params.q, seriesName)) {
            console.log(`[ZoneTelecharger] Skipping "${seriesName}" - too different from "${params.q}"`);
            return;
          }
        }

        // Si on cherche une saison spécifique, vérifie que la saison correspond
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[ZoneTelecharger] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        const quality = parseQuality(title);

        console.log(`[ZoneTelecharger] Found matching result: ${title}`);

        results.push({
          title,
          pageUrl,
          quality,
          language,
          season: extractedSeason,
        });
      } catch {
        // Skip invalid items
      }
    });

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[ZoneTelecharger] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Parse les blocs div.postinfo
    $('div.postinfo').each((_, postinfo) => {
      const $postinfo = $(postinfo);
      let currentHoster = '';

      // Parcourt tous les éléments <b> dans le bloc
      $postinfo.find('> b').each((_, bElement) => {
        const $b = $(bElement);

        // Si c'est un <b><div>Hoster</div></b>, c'est le nom de l'hébergeur
        const $hosterDiv = $b.find('> div');
        if ($hosterDiv.length > 0) {
          currentHoster = $hosterDiv.text().trim();
          console.log(`[ZoneTelecharger] Found hoster: ${currentHoster}`);
          return; // continue
        }

        // Si c'est un <b><a>Episode X</a></b>, c'est un lien de téléchargement
        const $link = $b.find('> a[rel="external nofollow"]');
        if ($link.length > 0 && currentHoster) {
          const downloadLink = $link.attr('href');
          const linkText = $link.text().trim();

          if (!downloadLink) return;

          const hosterLower = currentHoster.toLowerCase();

          // Filtre par hébergeur si spécifié dans les params
          if (params.hoster) {
            const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
            if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
              return;
            }
          }

          // Extrait le numéro d'épisode depuis le texte du lien (ex: "Episode 1", "Episode 12 FiNAL")
          let episode: number | undefined;
          const episodeMatch = linkText.match(/[ÉE]pisode\s*(\d+)/i);
          if (episodeMatch) {
            episode = parseInt(episodeMatch[1], 10);
          }

          // Filtre par épisode si spécifié dans les params
          if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
            return;
          }

          const quality = searchResult.quality || parseQuality(searchResult.title);
          const language = searchResult.language || parseLanguage(searchResult.title);

          // Construit le titre
          let title = searchResult.title.split(' - ')[0].trim();
          if (searchResult.season) title += ` S${String(searchResult.season).padStart(2, '0')}`;
          if (episode !== undefined) title += `E${String(episode).padStart(2, '0')}`;
          if (quality) title += ` ${quality}`;
          if (language) title += ` ${language}`;
          if (currentHoster) title += ` [${currentHoster}]`;

          results.push({
            title,
            link: downloadLink,
            size: undefined, // Pas de taille disponible dans cette structure
            quality,
            language,
            season: searchResult.season,
            episode,
            contentType,
            pubDate: new Date(),
          });
        }
      });
    });

    console.log(`[ZoneTelecharger] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      // Parse les blocs div.postinfo
      $('div.postinfo b > a[rel="external nofollow"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[ZoneTelecharger] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[ZoneTelecharger] Error fetching download links:', error);
      return [];
    }
  }
}

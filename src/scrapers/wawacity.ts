import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';

type WawaContentType = 'films' | 'series' | 'mangas';

// Mapping pour le paramètre de recherche
const CONTENT_TYPE_MAP: Record<string, WawaContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
};

// Sélecteurs pour les résultats de recherche
const RESULT_SELECTORS: Record<string, string> = {
  movie: 'a[href^="?p=film&id="]',
  series: 'a[href^="?p=serie&id="]',
  anime: 'a[href^="?p=manga&id="]',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
}

export class WawacityScraper implements BaseScraper {
  readonly name = 'WawaCity';

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
      console.log(`[WawaCity] Exact match: "${searchQuery}" = "${foundName}"`);
      return true;
    }

    // Calcule la distance de Levenshtein
    const distance = this.levenshteinDistance(normalizedQuery, normalizedFound);

    // La distance autorisée dépend de la longueur de la recherche
    // Pour des noms courts (< 10 chars), on autorise max 2 caractères de différence
    // Pour des noms plus longs, on autorise max 20% de différence
    const queryLength = normalizedQuery.length;
    let allowedDistance: number;

    if (queryLength <= 5) {
      allowedDistance = 1; // "Dexter" (6 chars) → max 1 char de différence
    } else if (queryLength <= 10) {
      allowedDistance = 2;
    } else {
      allowedDistance = Math.floor(queryLength * 0.2);
    }

    console.log(`[WawaCity] Comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

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
      // La dernière partie est souvent la langue (VF, VOSTFR, etc.) ou la saison
      // On cherche la partie "Saison X"
      let seriesName = '';
      let season: number | undefined;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        const seasonMatch = part.match(/^saison\s*(\d+)$/i);

        if (seasonMatch) {
          season = parseInt(seasonMatch[1], 10);
          // Le nom de la série est tout ce qui précède
          seriesName = parts.slice(0, i).join(' - ').trim();
          break;
        }
      }

      // Si on n'a pas trouvé de saison explicite, prend tout sauf le dernier élément
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

    const wawaType = CONTENT_TYPE_MAP[contentType];

    // Construit le terme de recherche
    let searchTerm = params.q;
    if (params.season) {
      searchTerm += ` Saison ${params.season}`;
    }

    // URL avec linkType=hasDownloadLink pour filtrer les pages sans téléchargement
    const baseSearchUrl = `${this.baseUrl}/?p=${wawaType}&linkType=hasDownloadLink&search=${encodeSearchQuery(searchTerm)}`;

    console.log(`[WawaCity] Searching ${contentType}: ${baseSearchUrl}`);

    try {
      // Récupère toutes les pages de résultats
      const allSearchResults = await this.fetchAllPages(baseSearchUrl, contentType, params);
      console.log(`[WawaCity] Found ${allSearchResults.length} total search results across all pages`);

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
          console.error(`[WawaCity] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[WawaCity] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[WawaCity] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = 5; // Limite pour éviter trop de requêtes

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[WawaCity] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params);

        if (results.length === 0) {
          console.log(`[WawaCity] No results on page ${currentPage}, stopping pagination`);
          break;
        }

        allResults.push(...results);

        // Vérifie s'il y a une page suivante
        const $ = cheerio.load(html);
        const hasNextPage = $('ul.pagination li:not(.disabled) a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[WawaCity] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[WawaCity] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[WawaCity] Parsing search results for ${contentType}`);

    // Parse les blocs .wa-sub-block.wa-post-detail-item
    $('.wa-sub-block.wa-post-detail-item').each((_, block) => {
      try {
        const $block = $(block);
        const $titleLink = $block.find('.wa-sub-block-title a[href^="?p="]').first();

        if ($titleLink.length === 0) return;

        // Récupère le HTML du lien pour extraire le nom sans les tags <i>
        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Extrait le nom de la série et la saison depuis le titre
        const { seriesName, season: extractedSeason } = this.extractSeriesName(titleHtml);

        console.log(`[WawaCity] Parsed title: "${title}" -> series="${seriesName}", season=${extractedSeason}`);

        // Vérifie que le nom de la série correspond à la recherche (Levenshtein)
        if (params.q && seriesName) {
          if (!this.isSeriesNameMatch(params.q, seriesName)) {
            console.log(`[WawaCity] Skipping "${seriesName}" - too different from "${params.q}"`);
            return;
          }
        }

        // Si on cherche une saison spécifique, vérifie que la saison correspond
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[WawaCity] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        // Construit le lien complet
        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

        const quality = parseQuality(title);
        const language = parseLanguage(title);

        console.log(`[WawaCity] Found matching result: ${title}`);

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

    // Fallback: utilise les anciens sélecteurs si aucun résultat
    if (results.length === 0) {
      const selector = RESULT_SELECTORS[contentType];
      $(selector).each((_, element) => {
        try {
          const $link = $(element);
          const titleHtml = $link.html() || '';
          const title = $link.text().trim();
          const href = $link.attr('href') || '';

          if (!title || !href) return;

          // Extrait le nom de la série et la saison
          const { seriesName, season: extractedSeason } = this.extractSeriesName(titleHtml);

          // Vérifie que le nom de la série correspond
          if (params.q && seriesName) {
            if (!this.isSeriesNameMatch(params.q, seriesName)) {
              return;
            }
          }

          // Si on cherche une saison spécifique, vérifie
          if (params.season && contentType === 'series') {
            const seasonNum = parseInt(params.season, 10);
            if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
              return;
            }
          }

          const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

          results.push({
            title,
            pageUrl,
            quality: parseQuality(title),
            language: parseLanguage(title),
            season: extractedSeason,
          });
        } catch {
          // Skip invalid items
        }
      });
    }

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[WawaCity] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Parse le tableau #DDLLinkѕ (avec le ѕ cyrillique)
    const $table = $('#DDLLinkѕ, #DDLLinks');

    if ($table.length === 0) {
      console.log(`[WawaCity] No download table found on ${searchResult.pageUrl}`);
      return results;
    }

    // Variable pour tracker l'épisode courant (pour les séries)
    let currentEpisode: number | undefined;

    $table.find('tr').each((_, row) => {
      const $row = $(row);

      // Vérifie si c'est un titre d'épisode (tr.title.episode-title)
      if ($row.hasClass('title') && $row.hasClass('episode-title')) {
        const episodeText = $row.text();
        // Extrait le numéro d'épisode depuis "Épisode X" ou "Episode X"
        const episodeMatch = episodeText.match(/[ÉE]pisode\s*(\d+)/i);
        if (episodeMatch) {
          currentEpisode = parseInt(episodeMatch[1], 10);
          console.log(`[WawaCity] Found episode header: Episode ${currentEpisode}`);
        }
        return; // Passe à la ligne suivante
      }

      // Vérifie si c'est une ligne de lien (tr.link-row)
      if (!$row.hasClass('link-row')) {
        return;
      }

      const cells = $row.find('td');
      if (cells.length < 3) return;

      // Colonne 1: lien
      const $linkCell = $(cells[0]);
      const $link = $linkCell.find('a').first();
      const downloadLink = $link.attr('href');

      if (!downloadLink) return;

      // Colonne 2: hébergeur
      const hoster = $(cells[1]).text().trim();
      const hosterLower = hoster.toLowerCase();

      // Skip les liens "Anonyme" (pub)
      if (hosterLower === 'anonyme') {
        return;
      }

      // Filtre par hébergeur si spécifié dans les params
      if (params.hoster) {
        const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
        if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
          return;
        }
      }

      // Colonne 3: taille
      const sizeText = $(cells[2]).text().trim();
      const size = parseSize(sizeText);

      // Pour les séries, utilise l'épisode courant
      // Pour les films, currentEpisode sera undefined
      const episode = currentEpisode;

      // Filtre par épisode si spécifié dans les params
      if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
        return;
      }

      // Extrait qualité et langue du titre du résultat de recherche
      const quality = searchResult.quality || parseQuality(searchResult.title);
      const language = searchResult.language || parseLanguage(searchResult.title);

      // Construit le titre
      let title = searchResult.title.split(' - ')[0].trim(); // Nom de la série/film sans "Saison X - VF"
      if (searchResult.season) title += ` S${String(searchResult.season).padStart(2, '0')}`;
      if (episode !== undefined) title += `E${String(episode).padStart(2, '0')}`;
      if (quality) title += ` ${quality}`;
      if (language) title += ` ${language}`;
      if (hoster) title += ` [${hoster}]`;

      results.push({
        title,
        link: downloadLink,
        size,
        quality,
        language,
        season: searchResult.season,
        episode,
        contentType,
        pubDate: new Date(),
      });
    });

    console.log(`[WawaCity] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      $('#DDLLinks tr, #DDLLinkѕ tr').each((index, row) => {
        if (index === 0) return; // Skip header
        const linkEl = $(row).find('a[href*="dl-protect"], a.link').first();
        const href = linkEl.attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[WawaCity] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[WawaCity] Error fetching download links:', error);
      return [];
    }
  }
}

import { BaseScraper, parseQuality, parseLanguage } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchJson } from '../utils/http.js';

// API Response interfaces
interface DDLRelease {
  release_id: number;
  link: string;
  filename: string;
  quality?: string;
  size?: number;
  size_gb?: number;
}

interface DDLMediaResponse {
  media: {
    id: number;
    name: string;
    original_title: string;
    type: string;
    is_series: boolean;
    release_date: number;
    imdb_id: string;
    tmdb_id: number;
    status?: string;
  };
  // For series
  seasons?: {
    [season: string]: {
      episodes?: {
        [episode: string]: DDLRelease[];
      };
      full_season_links?: DDLRelease[];
    };
  };
  // For movies
  download_links?: DDLRelease[];
  total_links?: number;
  filters_applied?: {
    season: number | null;
    episode: number | null;
    full_season: boolean | null;
  };
}

interface DDLDebridResponse {
  release_id: number;
  original_link: string;
  debrid_link: string;
  filename: string;
  size: number;
  size_gb: number;
}

const DDL_API_BASE = 'https://ddl.socoolmen.me';

export class DarkiworldPremiumScraper implements BaseScraper {
  readonly name = 'DarkiWorld Premium';

  constructor(public readonly baseUrl: string) {}

  /**
   * Get media releases by ID, TMDB ID, or IMDB ID
   */
  private async getMediaReleases(
    id?: number,
    tmdbId?: string,
    imdbId?: string,
    type?: 'movies' | 'series',
    season?: string,
    episode?: string,
    fullSeason?: boolean
  ): Promise<DDLMediaResponse | null> {
    try {
      let url: string;
      if (id) {
        url = `${DDL_API_BASE}/media?id=${id}`;
      } else if (tmdbId) {
        url = `${DDL_API_BASE}/media?tmdb_id=${encodeURIComponent(tmdbId)}&type=${type || 'movies'}`;
      } else if (imdbId) {
        url = `${DDL_API_BASE}/media?imdb_id=${encodeURIComponent(imdbId)}&type=${type || 'movies'}`;
      } else {
        console.error(`[DarkiworldPremium] No ID, TMDB ID, or IMDB ID provided`);
        return null;
      }

      // Add filters for series
      if (season) url += `&season=${encodeURIComponent(season)}`;
      if (episode) url += `&episode=${encodeURIComponent(episode)}`;
      if (fullSeason !== undefined) url += `&full_season=${fullSeason}`;

      console.log(`[DarkiworldPremium] Getting media releases: ${url}`);
      
      const response = await fetchJson<DDLMediaResponse>(url, { timeout: 30000 });
      
      if (!response.media) {
        console.log(`[DarkiworldPremium] No media found`);
        return null;
      }

      return response;
    } catch (error) {
      console.error(`[DarkiworldPremium] Get media releases failed:`, error);
      return null;
    }
  }

  /**
   * Get debrid info for a release (includes original link, size, filename)
   */
  private async getDebridInfo(releaseId: number): Promise<DDLDebridResponse | null> {
    try {
      const url = `${DDL_API_BASE}/debrid?release_id=${releaseId}`;
      console.log(`[DarkiworldPremium] Getting original link for release: ${releaseId}`);
      
      const response = await fetchJson<DDLDebridResponse>(url, { timeout: 30000 });
      
      // Debug log to see the response
      console.log(`[DarkiworldPremium] Debrid response for ${releaseId}: size=${response.size}, filename=${response.filename?.substring(0, 50)}`);
      
      if (!response.original_link) {
        console.log(`[DarkiworldPremium] No original link found for release: ${releaseId}`);
        return null;
      }

      return response;
    } catch (error) {
      console.error(`[DarkiworldPremium] Get debrid info failed:`, error);
      return null;
    }
  }

  /**
   * Extract all releases from a media response
   */
  private extractReleasesFromMedia(mediaResponse: DDLMediaResponse): DDLRelease[] {
    const releases: DDLRelease[] = [];

    // For movies, releases are in download_links
    if (mediaResponse.download_links) {
      releases.push(...mediaResponse.download_links);
    }

    // For series, releases are nested in seasons/episodes or full_season_links
    if (mediaResponse.seasons) {
      for (const seasonNum of Object.keys(mediaResponse.seasons)) {
        const season = mediaResponse.seasons[seasonNum];
        
        // Extract episode releases
        if (season.episodes) {
          for (const episodeNum of Object.keys(season.episodes)) {
            const episodeReleases = season.episodes[episodeNum];
            releases.push(...episodeReleases);
          }
        }
        
        // Extract full season releases
        if (season.full_season_links) {
          releases.push(...season.full_season_links);
        }
      }
    }

    return releases;
  }

  /**
   * Maps a DDL release to a ScraperResult
   */
  private async mapToScraperResult(
    release: DDLRelease,
    mediaTitle: string,
    contentType: ContentType
  ): Promise<ScraperResult | null> {
    // Get the debrid info (includes original link and size)
    const debridInfo = await this.getDebridInfo(release.release_id);
    if (!debridInfo) {
      return null;
    }

    // Use filename from debrid response, fallback to release filename
    const filename = debridInfo.filename || release.filename;

    // Extract quality from filename
    const quality = parseQuality(filename) || release.quality;

    // Extract language from filename
    const language = parseLanguage(filename);

    // Use size from debrid response (always present)
    const size = debridInfo.size;

    return {
      title: filename,
      link: debridInfo.original_link, // Original link for Ddlarr to debrid
      size,
      quality,
      language,
      contentType,
      pubDate: new Date(),
    };
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
    // TMDB ID or IMDB ID is required - skip if neither is provided
    if (!params.tmdbid && !params.imdbid) {
      console.log(`[DarkiworldPremium] Skipping ${contentType} search: TMDB ID or IMDB ID is required`);
      return [];
    }

    const allResults: ScraperResult[] = [];
    const seenLinks = new Set<string>();

    // Use TMDB ID if available, otherwise fall back to IMDB ID
    const idType = params.tmdbid ? 'TMDB' : 'IMDB';
    const idValue = params.tmdbid || params.imdbid;
    console.log(`[DarkiworldPremium] Using ${idType} ID for ${contentType}: ${idValue}`);
    
    // Determine API type parameter (anime is treated as series)
    const apiType: 'movies' | 'series' = contentType === 'movie' ? 'movies' : 'series';
    
    // Fetch regular releases (episodes for series, direct links for movies)
    const mediaResponse = await this.getMediaReleases(
      undefined,
      params.tmdbid,
      params.imdbid,
      apiType,
      params.season,
      params.ep,
      undefined
    );

    if (!mediaResponse) {
      console.log(`[DarkiworldPremium] No media found for ${idType}: ${idValue}`);
      return [];
    }

    // Check if media type matches
    const isMovie = !mediaResponse.media.is_series;
    const isSeries = mediaResponse.media.is_series;
    
    if ((contentType === 'movie' && !isMovie) || (contentType === 'series' && !isSeries)) {
      console.log(`[DarkiworldPremium] Media type mismatch: expected ${contentType}, got ${mediaResponse.media.type}`);
      return [];
    }

    let releases = this.extractReleasesFromMedia(mediaResponse);
    console.log(`[DarkiworldPremium] Found ${releases.length} episode releases for ${idType}: ${idValue}`);

    // For series, also fetch full season packs
    if (isSeries && params.season) {
      const fullSeasonResponse = await this.getMediaReleases(
        undefined,
        params.tmdbid,
        params.imdbid,
        apiType,
        params.season,
        undefined, // No specific episode
        true // full_season=true
      );

      if (fullSeasonResponse) {
        const fullSeasonReleases = this.extractReleasesFromMedia(fullSeasonResponse);
        console.log(`[DarkiworldPremium] Found ${fullSeasonReleases.length} full season releases for ${idType}: ${idValue}`);
        releases = [...releases, ...fullSeasonReleases];
      }
    }

    // Process releases in parallel with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < releases.length; i += batchSize) {
      const batch = releases.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(release => this.mapToScraperResult(release, mediaResponse.media.name, contentType))
      );

      for (const result of results) {
        if (result && !seenLinks.has(result.link)) {
          seenLinks.add(result.link);
          allResults.push(result);
        }
      }
    }

    return allResults;
  }
}

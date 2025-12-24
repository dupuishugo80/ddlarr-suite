import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  port: parseInt(process.env.PORT || '9117', 10),
  host: process.env.HOST || '0.0.0.0',

  sites: {
    wawacity: process.env.WAWACITY_URL || '',
    zonetelecharger: process.env.ZONETELECHARGER_URL || '',
    darkiworld: process.env.DARKIWORLD_URL || '',
  },

  darkiworldApiKey: process.env.DARKIWORLD_API_KEY || '',
  alldebridApiKey: process.env.ALLDEBRID_API_KEY || '',
  flaresolverrUrl: process.env.FLARESOLVERR_URL || '',
} as const;

export type SiteType = 'wawacity' | 'zonetelecharger' | 'darkiworld';

export function getSiteUrl(site: SiteType): string {
  return config.sites[site];
}

export function isSiteConfigured(site: SiteType): boolean {
  return Boolean(config.sites[site]);
}

export function isAlldebridConfigured(): boolean {
  return Boolean(config.alldebridApiKey);
}

export function isFlaresolverrConfigured(): boolean {
  return Boolean(config.flaresolverrUrl);
}

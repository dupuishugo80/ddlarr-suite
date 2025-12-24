# DDL Torznab

Indexeur Torznab pour sites DDL (Direct Download Links), compatible avec Sonarr et Radarr.

## Sites supportés

| Site | Variable ENV | Description |
|------|--------------|-------------|
| WawaCity | `WAWACITY_URL` | Scraping HTML |
| Zone-Téléchargement | `ZONETELECHARGER_URL` | Scraping HTML |
| DarkiWorld | `DARKIWORLD_URL` | API |

## Installation

### Avec Docker (recommandé)

```bash
# Cloner le repo
git clone https://github.com/votre-repo/ddl_torznab.git
cd ddl_torznab

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos URLs

# Lancer (inclut FlareSolverr)
docker-compose up -d
```

### Sans Docker

```bash
# Installer les dépendances
npm install

# Configurer
cp .env.example .env

# Build
npm run build

# Lancer
npm start

# Ou en développement (hot reload)
npm run dev
```

## Configuration

### Variables d'environnement

| Variable | Description | Requis |
|----------|-------------|--------|
| `PORT` | Port du serveur (défaut: 9117) | Non |
| `HOST` | Host du serveur (défaut: 0.0.0.0) | Non |
| `WAWACITY_URL` | URL de WawaCity | Non* |
| `ZONETELECHARGER_URL` | URL de Zone-Téléchargement | Non* |
| `DARKIWORLD_URL` | URL de l'API DarkiWorld | Non* |
| `DARKIWORLD_API_KEY` | Clé API DarkiWorld | Non |
| `ALLDEBRID_API_KEY` | Clé API AllDebrid | Non |
| `FLARESOLVERR_URL` | URL de FlareSolverr | Non |

> \* Au moins une URL de site doit être configurée.

### AllDebrid (optionnel)

Si `ALLDEBRID_API_KEY` est configuré, les liens DDL sont automatiquement convertis via AllDebrid avant d'être retournés. Sinon, les liens bruts sont retournés.

### FlareSolverr (optionnel)

Si `FLARESOLVERR_URL` est configuré (ex: `http://flaresolverr:8191/v1`), FlareSolverr sera utilisé automatiquement en cas de protection Cloudflare (erreurs 403, 503, 429).

Le docker-compose inclut FlareSolverr par défaut.

## Interface Web

Ouvrez `http://localhost:9117` dans votre navigateur pour accéder à l'interface web qui permet de :
- Voir les sites configurés et leur statut
- Générer les URLs par application :
  - **Radarr** : Films (catégories 2000, 2040, 2045)
  - **Sonarr** : Séries (catégories 5000, 5040)
  - **Sonarr (Anime)** : Anime (catégorie 5070 dans le champ "Anime Categories")

## API Endpoints

### Informations

| Endpoint | Description |
|----------|-------------|
| `GET /` | Interface web (HTML) |
| `GET /info` | Informations JSON sur le service |
| `GET /health` | Health check |
| `GET /sites` | Liste des sites configurés |

### Torznab API

Format : `GET /api/:site` où `:site` = `wawacity` | `zonetelecharger` | `darkiworld`

| Endpoint | Description |
|----------|-------------|
| `/api/:site?t=caps` | Capacités de l'indexeur |
| `/api/:site?t=search&q=...` | Recherche générale |
| `/api/:site?t=movie&q=...` | Recherche films |
| `/api/:site?t=tvsearch&q=...` | Recherche séries |

#### Paramètres de recherche

| Paramètre | Description |
|-----------|-------------|
| `q` | Terme de recherche |
| `cat` | Catégories (ex: 2000,5000) |
| `limit` | Nombre max de résultats (défaut: 100) |
| `offset` | Décalage pour pagination |
| `imdbid` | ID IMDb (ex: tt1234567) |
| `tmdbid` | ID TMDb |
| `tvdbid` | ID TVDb |
| `season` | Numéro de saison |
| `ep` | Numéro d'épisode |

## Configuration Sonarr / Radarr

### Radarr (Films)

1. Settings → Indexers → Add (bouton +)
2. Choisir **Torznab**
3. Configurer :
   - **Name** : WawaCity (ou autre)
   - **URL** : `http://localhost:9117/api/wawacity`
   - **API Key** : laisser vide
   - **Categories** : 2000, 2040, 2045

### Sonarr (Séries)

1. Settings → Indexers → Add (bouton +)
2. Choisir **Torznab**
3. Configurer :
   - **Name** : WawaCity (ou autre)
   - **URL** : `http://localhost:9117/api/wawacity`
   - **API Key** : laisser vide
   - **Categories** : 5000, 5040
   - **Anime Categories** : 5070

## Catégories Torznab

| Catégorie | Code | Description |
|-----------|------|-------------|
| Movies | 2000 | Films |
| Movies/HD | 2040 | Films HD (720p, 1080p) |
| Movies/UHD | 2045 | Films 4K |
| TV | 5000 | Séries |
| TV/HD | 5040 | Séries HD |
| Anime | 5070 | Anime |

## Docker Compose

```yaml
services:
  ddl-torznab:
    build: .
    container_name: ddl-torznab
    ports:
      - "9117:9117"
    environment:
      - WAWACITY_URL=https://...
      - ZONETELECHARGER_URL=https://...
      - DARKIWORLD_URL=https://...
      - DARKIWORLD_API_KEY=
      - ALLDEBRID_API_KEY=
      - FLARESOLVERR_URL=http://flaresolverr:8191/v1
    depends_on:
      - flaresolverr
    restart: unless-stopped

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    environment:
      - LOG_LEVEL=info
    ports:
      - "8191:8191"
    restart: unless-stopped
```

## Structure du projet

```
ddl_torznab/
├── src/
│   ├── index.ts           # Point d'entrée Fastify
│   ├── config.ts          # Configuration (env vars)
│   ├── routes/
│   │   └── torznab.ts     # Routes API Torznab
│   ├── scrapers/
│   │   ├── base.ts        # Interface + helpers
│   │   ├── wawacity.ts    # Scraper WawaCity
│   │   ├── zonetelecharger.ts
│   │   └── darkiworld.ts  # Client API Darki
│   ├── debrid/
│   │   └── alldebrid.ts   # Client AllDebrid
│   ├── models/
│   │   └── torznab.ts     # Types TypeScript
│   ├── views/
│   │   └── home.ts        # Interface web HTML
│   └── utils/
│       ├── xml.ts         # Builder XML Torznab
│       └── http.ts        # Client HTTP + FlareSolverr
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Développement

```bash
# Installer les dépendances
npm install

# Lancer en mode dev (hot reload)
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## Crédits

Inspiré par [wastream](https://github.com/Dyhlio/wastream) pour la logique de scraping.

## License

MIT

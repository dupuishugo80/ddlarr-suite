import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { config } from './config.js';
import { torznabRoutes } from './routes/torznab.js';
import { getAvailableSites } from './scrapers/index.js';
import { isAlldebridConfigured } from './config.js';
import { renderHomePage } from './views/home.js';

const isDev = process.env.NODE_ENV !== 'production';

const app = Fastify({
  logger: isDev
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : { level: 'info' },
});

async function start(): Promise<void> {
  try {
    // Register routes
    await app.register(torznabRoutes);

    // Homepage - HTML interface
    app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host || `${config.host}:${config.port}`;
      const baseUrl = `${protocol}://${host}`;

      reply.type('text/html');
      return renderHomePage(baseUrl);
    });

    // JSON API info endpoint
    app.get('/info', async () => {
      return {
        name: 'DDL Torznab',
        version: '1.0.0',
        description: 'Torznab indexer for DDL sites',
        availableSites: getAvailableSites(),
        alldebridEnabled: isAlldebridConfigured(),
        endpoints: {
          health: '/health',
          sites: '/sites',
          api: '/api/:site?t=caps|search|tvsearch|movie',
        },
      };
    });

    // Start server
    await app.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    DDL Torznab Server                      ║
╠════════════════════════════════════════════════════════════╣
║  Server running on http://${config.host}:${config.port}                    ║
║                                                            ║
║  Available sites: ${getAvailableSites().join(', ') || 'None configured'}
║  AllDebrid: ${isAlldebridConfigured() ? 'Enabled' : 'Disabled'}                                      ║
║                                                            ║
║  Open http://localhost:${config.port} in your browser            ║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    await app.close();
    console.log('Server closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();

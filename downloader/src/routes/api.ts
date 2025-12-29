import { FastifyInstance } from 'fastify';
import { getConfig, saveConfig, Config } from '../utils/config.js';
import { clients, getEnabledClients, getDirectDownloads, stopDirectDownload } from '../clients/index.js';
import { stopWatcher, startWatcher } from '../watcher.js';
import { debridServices, getEnabledDebridServices, testDebridService } from '../debrid/index.js';

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // Get current config
  app.get('/api/config', async () => {
    const config = getConfig();
    // Hide passwords/secrets in response
    return {
      ...config,
      alldebridApiKey: config.alldebridApiKey ? '********' : '',
      debrid: {
        alldebrid: {
          ...config.debrid.alldebrid,
          apiKey: config.debrid.alldebrid.apiKey ? '********' : '',
        },
        realdebrid: {
          ...config.debrid.realdebrid,
          apiKey: config.debrid.realdebrid.apiKey ? '********' : '',
        },
        premiumize: {
          ...config.debrid.premiumize,
          apiKey: config.debrid.premiumize.apiKey ? '********' : '',
        },
      },
      downloadStation: {
        ...config.downloadStation,
        password: config.downloadStation.password ? '********' : '',
      },
      jdownloader: {
        ...config.jdownloader,
        password: config.jdownloader.password ? '********' : '',
      },
      pyload: {
        ...config.pyload,
        password: config.pyload.password ? '********' : '',
      },
    };
  });

  // Save config
  app.post<{ Body: Partial<Config> }>('/api/config', async (request, reply) => {
    try {
      const currentConfig = getConfig();
      const newConfig = request.body;

      // Merge configs, preserving passwords/secrets if not changed
      const merged: Config = {
        ...currentConfig,
        ...newConfig,
        alldebridApiKey: newConfig.alldebridApiKey === '********'
          ? currentConfig.alldebridApiKey
          : (newConfig.alldebridApiKey ?? currentConfig.alldebridApiKey),
        debrid: {
          alldebrid: {
            ...currentConfig.debrid.alldebrid,
            ...newConfig.debrid?.alldebrid,
            apiKey: newConfig.debrid?.alldebrid?.apiKey === '********'
              ? currentConfig.debrid.alldebrid.apiKey
              : (newConfig.debrid?.alldebrid?.apiKey ?? currentConfig.debrid.alldebrid.apiKey),
          },
          realdebrid: {
            ...currentConfig.debrid.realdebrid,
            ...newConfig.debrid?.realdebrid,
            apiKey: newConfig.debrid?.realdebrid?.apiKey === '********'
              ? currentConfig.debrid.realdebrid.apiKey
              : (newConfig.debrid?.realdebrid?.apiKey ?? currentConfig.debrid.realdebrid.apiKey),
          },
          premiumize: {
            ...currentConfig.debrid.premiumize,
            ...newConfig.debrid?.premiumize,
            apiKey: newConfig.debrid?.premiumize?.apiKey === '********'
              ? currentConfig.debrid.premiumize.apiKey
              : (newConfig.debrid?.premiumize?.apiKey ?? currentConfig.debrid.premiumize.apiKey),
          },
        },
        downloadStation: {
          ...currentConfig.downloadStation,
          ...newConfig.downloadStation,
          password: newConfig.downloadStation?.password === '********'
            ? currentConfig.downloadStation.password
            : (newConfig.downloadStation?.password || currentConfig.downloadStation.password),
        },
        jdownloader: {
          ...currentConfig.jdownloader,
          ...newConfig.jdownloader,
          apiMode: newConfig.jdownloader?.apiMode || currentConfig.jdownloader.apiMode || 'auto',
          password: newConfig.jdownloader?.password === '********'
            ? currentConfig.jdownloader.password
            : (newConfig.jdownloader?.password || currentConfig.jdownloader.password),
        },
        aria2: {
          ...currentConfig.aria2,
          ...newConfig.aria2,
        },
        pyload: {
          ...currentConfig.pyload,
          ...newConfig.pyload,
          password: newConfig.pyload?.password === '********'
            ? currentConfig.pyload.password
            : (newConfig.pyload?.password || currentConfig.pyload.password),
        },
        curl: {
          ...currentConfig.curl,
          ...newConfig.curl,
        },
        wget: {
          ...currentConfig.wget,
          ...newConfig.wget,
        },
      };

      saveConfig(merged);

      // Restart watcher with new config
      stopWatcher();
      startWatcher();

      return { success: true };
    } catch (error) {
      reply.status(500);
      return { success: false, error: String(error) };
    }
  });

  // Get clients status
  app.get('/api/clients', async () => {
    const results = [];

    for (const client of clients) {
      results.push({
        name: client.name,
        enabled: client.isEnabled(),
      });
    }

    return results;
  });

  // Test client connection (with optional config override from form)
  app.post<{ Params: { clientName: string }; Body: Partial<Config> }>('/api/clients/:clientName/test', async (request, reply) => {
    const { clientName } = request.params;
    const formConfig = request.body;
    console.log(`[API] Testing client: ${clientName}`);

    // If form config is provided, temporarily save it for the test
    if (formConfig && Object.keys(formConfig).length > 0) {
      console.log(`[API] Using form config for test`);
      const currentConfig = getConfig();
      const tempConfig: Config = {
        ...currentConfig,
        ...formConfig,
        debrid: {
          alldebrid: {
            ...currentConfig.debrid.alldebrid,
            ...formConfig.debrid?.alldebrid,
            apiKey: formConfig.debrid?.alldebrid?.apiKey === '********'
              ? currentConfig.debrid.alldebrid.apiKey
              : (formConfig.debrid?.alldebrid?.apiKey ?? currentConfig.debrid.alldebrid.apiKey),
          },
          realdebrid: {
            ...currentConfig.debrid.realdebrid,
            ...formConfig.debrid?.realdebrid,
            apiKey: formConfig.debrid?.realdebrid?.apiKey === '********'
              ? currentConfig.debrid.realdebrid.apiKey
              : (formConfig.debrid?.realdebrid?.apiKey ?? currentConfig.debrid.realdebrid.apiKey),
          },
          premiumize: {
            ...currentConfig.debrid.premiumize,
            ...formConfig.debrid?.premiumize,
            apiKey: formConfig.debrid?.premiumize?.apiKey === '********'
              ? currentConfig.debrid.premiumize.apiKey
              : (formConfig.debrid?.premiumize?.apiKey ?? currentConfig.debrid.premiumize.apiKey),
          },
        },
        downloadStation: {
          ...currentConfig.downloadStation,
          ...formConfig.downloadStation,
          password: formConfig.downloadStation?.password === '********'
            ? currentConfig.downloadStation.password
            : (formConfig.downloadStation?.password || currentConfig.downloadStation.password),
        },
        jdownloader: {
          ...currentConfig.jdownloader,
          ...formConfig.jdownloader,
          apiMode: formConfig.jdownloader?.apiMode || currentConfig.jdownloader.apiMode || 'auto',
          password: formConfig.jdownloader?.password === '********'
            ? currentConfig.jdownloader.password
            : (formConfig.jdownloader?.password || currentConfig.jdownloader.password),
        },
        aria2: {
          ...currentConfig.aria2,
          ...formConfig.aria2,
        },
        pyload: {
          ...currentConfig.pyload,
          ...formConfig.pyload,
          password: formConfig.pyload?.password === '********'
            ? currentConfig.pyload.password
            : (formConfig.pyload?.password || currentConfig.pyload.password),
        },
        curl: {
          ...currentConfig.curl,
          ...formConfig.curl,
        },
        wget: {
          ...currentConfig.wget,
          ...formConfig.wget,
        },
      };
      saveConfig(tempConfig);
    }

    const client = clients.find(c => c.name.toLowerCase() === clientName.toLowerCase());

    if (!client) {
      console.log(`[API] Client not found: ${clientName}`);
      reply.status(404);
      return { success: false, error: 'Client not found' };
    }

    try {
      const result = await client.testConnection();
      console.log(`[API] Test result for ${clientName}: ${result}`);
      return { success: result, message: result ? 'Connection successful' : 'Connection failed - check logs for details' };
    } catch (error) {
      console.error(`[API] Test error for ${clientName}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Get debrid services status
  app.get('/api/debrid', async () => {
    return debridServices.map(service => ({
      name: service.name,
      configured: service.isConfigured(),
      enabled: service.isEnabled(),
    }));
  });

  // Test debrid service connection
  app.post<{ Params: { serviceName: string }; Body: Partial<Config> }>('/api/debrid/:serviceName/test', async (request, reply) => {
    const { serviceName } = request.params;
    const formConfig = request.body;
    console.log(`[API] Testing debrid service: ${serviceName}`);

    // If form config is provided, temporarily save it for the test
    if (formConfig && Object.keys(formConfig).length > 0) {
      console.log(`[API] Using form config for debrid test`);
      const currentConfig = getConfig();
      const tempConfig: Config = {
        ...currentConfig,
        ...formConfig,
        debrid: {
          alldebrid: {
            ...currentConfig.debrid.alldebrid,
            ...formConfig.debrid?.alldebrid,
            apiKey: formConfig.debrid?.alldebrid?.apiKey === '********'
              ? currentConfig.debrid.alldebrid.apiKey
              : (formConfig.debrid?.alldebrid?.apiKey ?? currentConfig.debrid.alldebrid.apiKey),
          },
          realdebrid: {
            ...currentConfig.debrid.realdebrid,
            ...formConfig.debrid?.realdebrid,
            apiKey: formConfig.debrid?.realdebrid?.apiKey === '********'
              ? currentConfig.debrid.realdebrid.apiKey
              : (formConfig.debrid?.realdebrid?.apiKey ?? currentConfig.debrid.realdebrid.apiKey),
          },
          premiumize: {
            ...currentConfig.debrid.premiumize,
            ...formConfig.debrid?.premiumize,
            apiKey: formConfig.debrid?.premiumize?.apiKey === '********'
              ? currentConfig.debrid.premiumize.apiKey
              : (formConfig.debrid?.premiumize?.apiKey ?? currentConfig.debrid.premiumize.apiKey),
          },
        },
      };
      saveConfig(tempConfig);
    }

    try {
      const result = await testDebridService(serviceName);
      return { success: result, message: result ? 'Connection successful' : 'Connection failed - check logs for details' };
    } catch (error) {
      console.error(`[API] Debrid test error for ${serviceName}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Health check
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      enabledClients: getEnabledClients().map(c => c.name),
      enabledDebridServices: getEnabledDebridServices().map(s => s.name),
      blackholePath: getConfig().blackholePath,
    };
  });

  // Get active downloads (curl/wget progress)
  app.get('/api/downloads', async () => {
    return {
      downloads: getDirectDownloads(),
    };
  });

  // Stop a download
  app.post<{ Params: { id: string } }>('/api/downloads/:id/stop', async (request, reply) => {
    const { id } = request.params;
    console.log(`[API] Stopping download: ${id}`);

    const success = stopDirectDownload(id);
    if (success) {
      return { success: true, message: 'Download stopped' };
    } else {
      reply.status(404);
      return { success: false, error: 'Download not found or already completed' };
    }
  });
}

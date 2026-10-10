import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // In-memory cache for fast repeated image searches
  const imageCache = new Map<string, { image: string; images: string[]; titles: string[] }>();

  // Real Product Image Search Endpoint
  app.get('/api/search-image', async (req, res) => {
    const rawQuery = (req.query.q as string) || '';
    const cleanQuery = rawQuery.trim();

    if (!cleanQuery) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const cacheKey = cleanQuery.toLowerCase();
    if (imageCache.has(cacheKey)) {
      return res.json({
        success: true,
        query: cleanQuery,
        cached: true,
        ...imageCache.get(cacheKey),
      });
    }

    try {
      const searchTerms = `${cleanQuery} product photo`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res1 = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(searchTerms)}&iax=images&ia=images`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      const html = await res1.text();
      clearTimeout(timeoutId);

      const m = html.match(/vqd=([0-9-]+)/) || html.match(/vqd=["']([0-9-]+)/);
      if (!m) {
        return res.status(404).json({ error: 'No search token found' });
      }

      const vqd = m[1];
      const apiUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(searchTerms)}&vqd=${vqd}&f=,,,&p=1`;

      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 6000);

      const res2 = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        signal: controller2.signal,
      });

      const data = await res2.json();
      clearTimeout(timeoutId2);

      if (!data.results || data.results.length === 0) {
        return res.status(404).json({ error: 'No images found for query' });
      }

      const validImages = data.results
        .filter((r: any) => r.image && r.image.startsWith('http') && !r.image.endsWith('.svg'))
        .slice(0, 10);

      const result = {
        image: validImages[0]?.image || data.results[0]?.image,
        images: validImages.map((r: any) => r.image),
        titles: validImages.map((r: any) => r.title || cleanQuery),
      };

      imageCache.set(cacheKey, result);

      return res.json({
        success: true,
        query: cleanQuery,
        ...result,
      });
    } catch (err: any) {
      console.error('Error fetching image for:', cleanQuery, err?.message);
      return res.status(500).json({ error: 'Failed to search image', details: err?.message });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    } else {
      app.use(express.static(__dirname));
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();

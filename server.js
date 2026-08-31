const http = require('http');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { init, ask, recommend, metiersCount, metiers, getSimilarMetiers, analyzeTransferability, calculateCareerAndSalary } = require('./ragService');

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 8_000_000;

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, file, contentType) {
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 500, { error: 'Impossible de charger l\'interface.' });
    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  });
}

function renderHtmlWithIncludes(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  return content.replace(/<!--\s*include:([a-zA-Z0-9_-]+)\s*-->/g, (match, compName) => {
    const compFile = path.join(path.dirname(filePath), 'components', `${compName}.html`);
    if (fs.existsSync(compFile)) {
      return fs.readFileSync(compFile, 'utf8');
    }
    return match;
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) reject(new Error('Corps de requête trop volumineux.'));
    });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON invalide.')); } });
    req.on('error', reject);
  });
}

async function start() {
  // Initialiser la connexion MongoDB et charger les données
  await init();

  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return json(res, 204, {});

    // API Routes
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', metiers: metiersCount() });

    if (url.pathname.startsWith('/api/')) {
      try {
        const body = req.method === 'POST' ? await readJson(req) : Object.fromEntries(url.searchParams);
        if (url.pathname === '/api/chat') return json(res, 200, await ask(body.question));
        if (url.pathname === '/api/recommendations') return json(res, 200, await recommend(body.cvText || body.profileText, Math.min(Number(body.limit) || 5, 20)));
        if (url.pathname === '/api/metiers') return json(res, 200, metiers());
        if (url.pathname === '/api/metiers/search') {
          const code = body.code || url.searchParams.get('code');
          const titre = body.titre || url.searchParams.get('titre');
          if (code) {
            const metier = metiers().find(m => m.code === code.toUpperCase());
            return json(res, metier ? 200 : 404, metier || { error: 'Métier introuvable.' });
          }
          if (titre) {
            const normalizedTitre = titre.toLowerCase();
            const found = metiers().filter(m => m.titre.toLowerCase().includes(normalizedTitre));
            return json(res, 200, found);
          }
          return json(res, 400, { error: 'Paramètre code ou titre requis.' });
        }
        if (url.pathname === '/api/metiers/similar') {
          const queryUrl = body.url || url.searchParams.get('url');
          const limit = Math.min(Number(body.limit || url.searchParams.get('limit')) || 5, 10);
          return json(res, 200, getSimilarMetiers(queryUrl, limit));
        }
        if (url.pathname === '/api/transferability') {
          const sourceUrl = body.sourceUrl || url.searchParams.get('sourceUrl');
          const targetUrl = body.targetUrl || url.searchParams.get('targetUrl');
          if (!sourceUrl || !targetUrl) return json(res, 400, { error: 'sourceUrl et targetUrl requis.' });
          return json(res, 200, analyzeTransferability(sourceUrl, targetUrl));
        }
        if (url.pathname === '/api/career-salary') {
          const jobUrl = body.jobUrl || body.code || body.url || url.searchParams.get('jobUrl') || url.searchParams.get('code') || url.searchParams.get('url');
          const level = body.level || url.searchParams.get('level') || 'junior';
          if (!jobUrl) return json(res, 400, { error: 'jobUrl ou code de métier requis.' });
          return json(res, 200, calculateCareerAndSalary(jobUrl, level));
        }
        return json(res, 404, { error: 'Route API introuvable.' });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    // Generic static files serving from /public
    const publicDir = path.join(__dirname, 'public');
    let safePath = url.pathname === '/' ? 'index.html' : url.pathname;
    safePath = safePath.replace(/^(\.\.[\\/])+/, '');
    const filePath = path.resolve(publicDir, safePath.startsWith('/') ? safePath.slice(1) : safePath);

    if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderHtmlWithIncludes(filePath));
      }
      const mimeTypes = {
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      return sendFile(res, filePath, mimeTypes[ext] || 'application/octet-stream');
    }

    return json(res, 404, { error: 'Ressource introuvable.' });
  }).listen(PORT, () => console.log(`🚀 RTMC RAG disponible sur http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('❌ Erreur au démarrage :', err.message);
  process.exit(1);
});

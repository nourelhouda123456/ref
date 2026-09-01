const http = require('http');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const {
  init, ask, recommend, metiersCount, metiers,
  getSimilarMetiers, analyzeTransferability, calculateCareerAndSalary,
  refreshCache,
} = require('./ragService');
const { getUsersCollection, getMetiersCollection, getEscoCollection, getDomainesCollection } = require('./db');

const PORT       = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const MAX_BODY_BYTES = 8_000_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, file, contentType) {
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 500, { error: "Impossible de charger l'interface." });
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) reject(new Error('Corps de requête trop volumineux.'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

/**
 * Vérifie le JWT dans l'en-tête Authorization et retourne le payload décodé.
 * Renvoie null si le token est absent ou invalide.
 */
function verifyToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Middleware de protection : vérifie que l'utilisateur est ADMIN.
 * Retourne true si l'accès est autorisé, false (+ réponse 401/403) sinon.
 */
function requireAdmin(req, res) {
  const payload = verifyToken(req);
  if (!payload) {
    json(res, 401, { error: 'Non authentifié. Token manquant ou invalide.' });
    return false;
  }
  if (payload.role !== 'ADMIN') {
    json(res, 403, { error: 'Accès refusé. Rôle ADMIN requis.' });
    return false;
  }
  return true;
}

// ── Server ────────────────────────────────────────────────────────────────────

async function start() {
  await init();

  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') return json(res, 204, {});

    // ── Health ────────────────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      return json(res, 200, { status: 'ok', metiers: metiersCount() });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        // ── Auth : POST /api/admin/login ────────────────────────────────────
        if (url.pathname === '/api/admin/login' && req.method === 'POST') {
          const { email, password } = await readJson(req);
          if (!email || !password) {
            return json(res, 400, { error: 'Email et mot de passe requis.' });
          }

          const users = getUsersCollection();
          const user  = await users.findOne({ email: email.toLowerCase().trim() });

          if (!user || user.role !== 'ADMIN') {
            return json(res, 401, { error: 'Identifiants incorrects.' });
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            return json(res, 401, { error: 'Identifiants incorrects.' });
          }

          if (user.active === false) {
            return json(res, 403, { error: 'Compte désactivé.' });
          }

          const token = jwt.sign(
            { id: String(user._id), email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
          );

          return json(res, 200, {
            token,
            user: { id: String(user._id), email: user.email, role: user.role },
          });
        }

        // ── Auth : GET /api/admin/me ────────────────────────────────────────
        if (url.pathname === '/api/admin/me' && req.method === 'GET') {
          if (!requireAdmin(req, res)) return;
          const payload = verifyToken(req);
          return json(res, 200, {
            id: payload.id,
            email: payload.email,
            role: payload.role,
          });
        }

        // ── Admin CRUD Métiers ──────────────────────────────────────────────

        // GET /api/admin/metiers  — liste paginée + recherche (RTMC + ESCO)
        if (url.pathname === '/api/admin/metiers' && req.method === 'GET') {
          if (!requireAdmin(req, res)) return;

          const search      = (url.searchParams.get('search') || '').toLowerCase().trim();
          const sourceFilter = url.searchParams.get('source') || '';
          const activeParam  = url.searchParams.get('active'); // 'true' | 'false' | ''
          const page  = Math.max(1, Number(url.searchParams.get('page'))  || 1);
          const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));

          const query = {};
          if (search) {
            query.$or = [
              { titre:   { $regex: search, $options: 'i' } },
              { code:    { $regex: search, $options: 'i' } },
              { domaine: { $regex: search, $options: 'i' } },
            ];
          }
          if (activeParam === 'true')  query.active = { $ne: false };
          if (activeParam === 'false') query.active = false;

          const rtmcCol = getMetiersCollection();
          const escoCol = getEscoCollection();

          // Requêter les deux collections selon le filtre source
          let docs = [];
          let total = 0;

          if (sourceFilter === 'rtmc') {
            total = await rtmcCol.countDocuments(query);
            docs  = await rtmcCol.find(query).sort({ titre: 1 }).skip((page - 1) * limit).limit(limit).toArray();
          } else if (sourceFilter === 'esco') {
            total = await escoCol.countDocuments(query);
            docs  = await escoCol.find(query).sort({ titre: 1 }).skip((page - 1) * limit).limit(limit).toArray();
          } else {
            // Les deux sources : on récupère tout, on trie, puis on pagine en mémoire
            const [rtmcDocs, escoDocs] = await Promise.all([
              rtmcCol.find(query).sort({ titre: 1 }).toArray(),
              escoCol.find(query).sort({ titre: 1 }).toArray(),
            ]);
            const all = [...rtmcDocs, ...escoDocs].sort((a, b) =>
              (a.titre || '').localeCompare(b.titre || '', 'fr')
            );
            total = all.length;
            docs  = all.slice((page - 1) * limit, page * limit);
          }

          return json(res, 200, {
            data:  docs,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit) || 1,
          });
        }

        // POST /api/admin/metiers  — créer un métier
        if (url.pathname === '/api/admin/metiers' && req.method === 'POST') {
          if (!requireAdmin(req, res)) return;

          const body = await readJson(req);
          if (!body.titre || !body.titre.trim()) {
            return json(res, 400, { error: 'Le champ titre est obligatoire.' });
          }

          const col   = getMetiersCollection();
          const newDoc = {
            ...body,
            titre:     body.titre.trim(),
            code:      (body.code || '').trim().toUpperCase() || undefined,
            source:    body.source || 'rtmc',
            active:    body.active !== false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await col.insertOne(newDoc);
          const inserted = await col.findOne({ _id: result.insertedId });

          // Rafraîchir le cache RAG en mémoire
          await refreshCache();

          return json(res, 201, inserted);
        }

        // PUT /api/admin/metiers/:id  — modifier un métier
        const putMatch = url.pathname.match(/^\/api\/admin\/metiers\/([a-f0-9]{24})$/i);
        if (putMatch && req.method === 'PUT') {
          if (!requireAdmin(req, res)) return;

          const id  = putMatch[1];
          const body = await readJson(req);
          delete body._id;

          // Chercher dans les deux collections
          const rtmcCol = getMetiersCollection();
          const escoCol = getEscoCollection();

          let result = await rtmcCol.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { ...body, updatedAt: new Date() } },
            { returnDocument: 'after' }
          );
          if (!result) {
            result = await escoCol.findOneAndUpdate(
              { _id: new ObjectId(id) },
              { $set: { ...body, updatedAt: new Date() } },
              { returnDocument: 'after' }
            );
          }

          if (!result) {
            return json(res, 404, { error: 'Métier introuvable.' });
          }

          await refreshCache();
          return json(res, 200, result);
        }

        // PATCH /api/admin/metiers/:id/toggle — activer / désactiver
        const patchMatch = url.pathname.match(/^\/api\/admin\/metiers\/([a-f0-9]{24})\/toggle$/i);
        if (patchMatch && req.method === 'PATCH') {
          if (!requireAdmin(req, res)) return;

          const id  = patchMatch[1];
          // Chercher dans les deux collections (RTMC et ESCO)
          const rtmcCol = getMetiersCollection();
          const escoCol = getEscoCollection();

          let doc = await rtmcCol.findOne({ _id: new ObjectId(id) });
          let col = rtmcCol;
          if (!doc) {
            doc = await escoCol.findOne({ _id: new ObjectId(id) });
            col = escoCol;
          }

          if (!doc) return json(res, 404, { error: 'Métier introuvable.' });

          const newActive = doc.active === false ? true : false;
          await col.updateOne(
            { _id: new ObjectId(id) },
            { $set: { active: newActive, updatedAt: new Date() } }
          );

          await refreshCache();
          return json(res, 200, { active: newActive });
        }

        // DELETE /api/admin/metiers/:id  — supprimer un métier
        const deleteMatch = url.pathname.match(/^\/api\/admin\/metiers\/([a-f0-9]{24})$/i);
        if (deleteMatch && req.method === 'DELETE') {
          if (!requireAdmin(req, res)) return;

          const id  = deleteMatch[1];
          // Chercher dans les deux collections
          const rtmcCol = getMetiersCollection();
          const escoCol = getEscoCollection();

          let result = await rtmcCol.deleteOne({ _id: new ObjectId(id) });
          if (result.deletedCount === 0) {
            result = await escoCol.deleteOne({ _id: new ObjectId(id) });
          }

          if (result.deletedCount === 0) {
            return json(res, 404, { error: 'Métier introuvable.' });
          }

          await refreshCache();
          return json(res, 200, { success: true });
        }

        // ── Domaines : route publique ───────────────────────────────────────
        // GET /api/domaines — liste de tous les domaines actifs (pour les selects)
        if (url.pathname === '/api/domaines' && req.method === 'GET') {
          const col  = getDomainesCollection();
          const docs = await col.find({ active: { $ne: false } }).sort({ nom: 1 }).toArray();
          return json(res, 200, docs);
        }

        // ── Domaines : routes admin ────────────────────────────────────────

        // GET /api/admin/domaines — liste paginée + recherche
        if (url.pathname === '/api/admin/domaines' && req.method === 'GET') {
          if (!requireAdmin(req, res)) return;

          const search = (url.searchParams.get('search') || '').trim();
          const page   = Math.max(1, Number(url.searchParams.get('page'))  || 1);
          const limit  = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

          const col   = getDomainesCollection();
          const query = search
            ? { nom: { $regex: search, $options: 'i' } }
            : {};

          const total = await col.countDocuments(query);
          const docs  = await col.find(query).sort({ nom: 1 }).skip((page - 1) * limit).limit(limit).toArray();

          return json(res, 200, { data: docs, total, page, limit, pages: Math.ceil(total / limit) || 1 });
        }

        // POST /api/admin/domaines — créer un domaine
        if (url.pathname === '/api/admin/domaines' && req.method === 'POST') {
          if (!requireAdmin(req, res)) return;

          const body = await readJson(req);
          if (!body.nom || !body.nom.trim()) {
            return json(res, 400, { error: 'Le champ nom est obligatoire.' });
          }

          const col = getDomainesCollection();
          const existing = await col.findOne({ nom: { $regex: `^${body.nom.trim()}$`, $options: 'i' } });
          if (existing) {
            return json(res, 409, { error: `Le domaine "${body.nom.trim()}" existe déjà.` });
          }

          const doc = {
            nom:       body.nom.trim(),
            active:    body.active !== false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result  = await col.insertOne(doc);
          const inserted = await col.findOne({ _id: result.insertedId });
          return json(res, 201, inserted);
        }

        // PUT /api/admin/domaines/:id — modifier un domaine
        const domainePutMatch = url.pathname.match(/^\/api\/admin\/domaines\/([a-f0-9]{24})$/i);
        if (domainePutMatch && req.method === 'PUT') {
          if (!requireAdmin(req, res)) return;

          const id   = domainePutMatch[1];
          const body = await readJson(req);
          delete body._id;

          const col    = getDomainesCollection();
          const result = await col.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { ...body, nom: (body.nom || '').trim(), updatedAt: new Date() } },
            { returnDocument: 'after' }
          );

          if (!result) return json(res, 404, { error: 'Domaine introuvable.' });
          return json(res, 200, result);
        }

        // PATCH /api/admin/domaines/:id/toggle — activer / désactiver
        const domaineToggleMatch = url.pathname.match(/^\/api\/admin\/domaines\/([a-f0-9]{24})\/toggle$/i);
        if (domaineToggleMatch && req.method === 'PATCH') {
          if (!requireAdmin(req, res)) return;

          const id  = domaineToggleMatch[1];
          const col = getDomainesCollection();
          const doc = await col.findOne({ _id: new ObjectId(id) });

          if (!doc) return json(res, 404, { error: 'Domaine introuvable.' });

          const newActive = doc.active === false ? true : false;
          await col.updateOne(
            { _id: new ObjectId(id) },
            { $set: { active: newActive, updatedAt: new Date() } }
          );
          return json(res, 200, { active: newActive });
        }

        // DELETE /api/admin/domaines/:id — supprimer un domaine
        const domaineDeleteMatch = url.pathname.match(/^\/api\/admin\/domaines\/([a-f0-9]{24})$/i);
        if (domaineDeleteMatch && req.method === 'DELETE') {
          if (!requireAdmin(req, res)) return;

          const id     = domaineDeleteMatch[1];
          const col    = getDomainesCollection();
          const result = await col.deleteOne({ _id: new ObjectId(id) });

          if (result.deletedCount === 0) return json(res, 404, { error: 'Domaine introuvable.' });
          return json(res, 200, { success: true });
        }

        // ── Routes publiques existantes ─────────────────────────────────────

        const body = req.method === 'POST'
          ? await readJson(req)
          : Object.fromEntries(url.searchParams);

        if (url.pathname === '/api/chat') {
          return json(res, 200, await ask(body.question));
        }
        if (url.pathname === '/api/recommendations') {
          return json(res, 200, await recommend(
            body.cvText || body.profileText,
            Math.min(Number(body.limit) || 5, 20)
          ));
        }
        if (url.pathname === '/api/metiers') {
          return json(res, 200, metiers());
        }
        if (url.pathname === '/api/metiers/search') {
          const code  = body.code  || url.searchParams.get('code');
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
          const limit    = Math.min(Number(body.limit || url.searchParams.get('limit')) || 5, 10);
          return json(res, 200, getSimilarMetiers(queryUrl, limit));
        }
        if (url.pathname === '/api/transferability') {
          const sourceUrl = body.sourceUrl || url.searchParams.get('sourceUrl');
          const targetUrl = body.targetUrl  || url.searchParams.get('targetUrl');
          if (!sourceUrl || !targetUrl) {
            return json(res, 400, { error: 'sourceUrl et targetUrl requis.' });
          }
          return json(res, 200, analyzeTransferability(sourceUrl, targetUrl));
        }
        if (url.pathname === '/api/career-salary') {
          const jobUrl = body.jobUrl || body.code || body.url
            || url.searchParams.get('jobUrl')
            || url.searchParams.get('code')
            || url.searchParams.get('url');
          const level = body.level || url.searchParams.get('level') || 'junior';
          if (!jobUrl) return json(res, 400, { error: 'jobUrl ou code de métier requis.' });
          return json(res, 200, calculateCareerAndSalary(jobUrl, level));
        }

        return json(res, 404, { error: 'Route API introuvable.' });

      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    // ── Root ─────────────────────────────────────────────────────────────────
    if (url.pathname === '/') {
      return json(res, 200, { service: 'API Backend RTMC & ESCO', status: 'online', metiers: metiersCount() });
    }

    // ── Static files from /public ─────────────────────────────────────────
    const publicDir = path.join(__dirname, 'public');
    let safePath    = url.pathname.replace(/^(\.\.[\\/])+/, '');
    const filePath  = path.resolve(publicDir, safePath.startsWith('/') ? safePath.slice(1) : safePath);

    if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.css': 'text/css; charset=utf-8',
        '.js':  'application/javascript; charset=utf-8',
        '.json':'application/json; charset=utf-8',
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

/**
 * Script de récupération des données ESCO en français via l'API officielle.
 * Utilise https natif pour une stabilité maximale.
 * Sauvegarde les résultats dans data/esco_occupations.json
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ESCO_FILE = path.join(DATA_DIR, 'esco_occupations.json');
const CONCURRENCY = 25;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getJson(url, retries = 3, delay = 1000) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'NodeJS/ESCO-Client' } }, (res) => {
        if (res.statusCode >= 400) {
          if (n > 1) return setTimeout(() => attempt(n - 1), delay);
          return resolve(null);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            if (n > 1) setTimeout(() => attempt(n - 1), delay);
            else resolve(null);
          }
        });
      });
      req.on('error', (err) => {
        if (n > 1) setTimeout(() => attempt(n - 1), delay);
        else resolve(null);
      });
      req.setTimeout(15000, () => {
        req.destroy();
        if (n > 1) setTimeout(() => attempt(n - 1), delay);
        else resolve(null);
      });
    }
    attempt(retries);
  });
}

// Récupérer la liste complète des occupations ESCO
async function fetchAllOccupationUris() {
  console.log('🔍 Récupération de la liste complète des métiers ESCO...');
  const results = [];
  const limit = 100;
  let page = 0;
  let total = 1;

  while (true) {
    const url = `https://ec.europa.eu/esco/api/search?type=occupation&language=fr&limit=${limit}&offset=${page}`;
    const data = await getJson(url);
    if (!data || !data._embedded || !data._embedded.results || data._embedded.results.length === 0) break;

    total = data.total || total;
    const items = data._embedded.results;
    results.push(...items);
    page++;

    process.stdout.write(`\r📥 Liste : ${results.length} / ${total} métiers trouvés (page ${page})`);
    if (!data._links?.next) break;
  }
  console.log(`\n✅ ${results.length} métiers ESCO trouvés au total.`);
  return results;
}

// Récupérer les détails d'un métier
async function fetchOccupationDetails(item) {
  const url = `https://ec.europa.eu/esco/api/resource/occupation?uri=${encodeURIComponent(item.uri)}&language=fr`;
  const detail = await getJson(url);
  if (!detail) return null;

  const descFr = detail.description?.fr?.literal || detail.description?.en?.literal || '';
  const altLabelsFr = detail.alternativeLabel?.fr || (Array.isArray(detail.alternativeLabel) ? detail.alternativeLabel : []);
  const essentialSkills = (detail._links?.hasEssentialSkill || []).map(s => s.title).filter(Boolean);
  const optionalSkills = (detail._links?.hasOptionalSkill || []).map(s => s.title).filter(Boolean);

  const titre = detail.preferredLabel?.fr || detail.title || item.title || '';

  return {
    source: 'esco',
    code: detail.code || item.code || 'ESCO',
    titre: titre,
    url: detail.uri || item.uri,
    uri: detail.uri || item.uri,
    domaine: 'Référentiel Européen ESCO',
    domaineGrand: 'ESCO (Europe)',
    domaineProfessionnel: (detail._links?.isChildOf || []).map(c => c.title).join(', ') || 'Europe',
    resume: descFr,
    definition: descFr,
    appellations: altLabelsFr,
    competencesTechniquesSavoirFaire: essentialSkills,
    competencesTechniquesSavoir: optionalSkills,
    competencesComportementales: [],
    competencesNumeriques: [],
    environnementSecteurs: [],
    accesEmploi: '',
    salary: null,
    essentialSkills: essentialSkills,
    optionalSkills: optionalSkills,
  };
}

async function run() {
  console.time('Durée totale');
  
  // Charger les données existantes si reprise
  let existing = [];
  const existingUris = new Set();
  if (fs.existsSync(ESCO_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(ESCO_FILE, 'utf8'));
      existing.forEach(m => existingUris.add(m.uri));
      console.log(`ℹ️ ${existing.length} fiches déjà dans le cache local.`);
    } catch (e) {}
  }

  const allItems = await fetchAllOccupationUris();
  const toFetch = allItems.filter(item => !existingUris.has(item.uri));

  console.log(`🚀 Récupération des détails pour ${toFetch.length} métiers (${CONCURRENCY} requêtes en parallèle)...`);

  const output = [...existing];
  let processed = 0;

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const chunk = toFetch.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(fetchOccupationDetails));
    
    for (const res of chunkResults) {
      if (res) output.push(res);
    }
    processed += chunk.length;

    // Sauvegarde intermédiaire
    if (processed % 100 === 0 || processed >= toFetch.length) {
      fs.writeFileSync(ESCO_FILE, JSON.stringify(output, null, 2), 'utf8');
    }

    const currentTotal = output.length;
    const grandTotal = allItems.length;
    process.stdout.write(`\r⏳ Progression : ${currentTotal} / ${grandTotal} (${Math.round((currentTotal / grandTotal) * 100)}%)`);
  }

  // Sauvegarde finale
  fs.writeFileSync(ESCO_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n\n🎉 Scraping ESCO terminé avec succès !`);
  console.log(`📁 Fichier généré : ${ESCO_FILE} (${output.length} fiches métiers)`);
  console.timeEnd('Durée totale');
}

run().catch(err => {
  console.error('\n❌ Erreur :', err);
  process.exit(1);
});

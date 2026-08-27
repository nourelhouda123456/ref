/**
 * Génération des embeddings pour les fiches ESCO (Référentiel Européen)
 * --------------------------------------------------------------------
 * Transforme chaque fiche ESCO en vecteur numérique (1024-dim) via Voyage AI.
 * Sauvegarde les résultats au fur et à mesure dans data/esco_embeddings.json
 * et les synchronise avec MongoDB (collection embeddings).
 *
 * Supporte la reprise automatique sur interruption.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, getEmbeddingsCollection, closeDB } = require('./db');

const DATA_DIR = path.join(__dirname, 'data');
const ESCO_INPUT_FILE = path.join(DATA_DIR, 'esco_occupations.json');
const ESCO_EMBEDDINGS_FILE = path.join(DATA_DIR, 'esco_embeddings.json');

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite';

// Paramètres de gestion de quota Voyage AI
const MAX_TOKENS_PER_BATCH = 2800; // Marge sous les 10 000 tokens/minute
const REQUEST_INTERVAL_MS = 21000; // ~3 requêtes par minute (compte gratuit)
const RATE_LIMIT_COOLDOWN_MS = 65000; // En cas d'erreur 429

function estimateTokens(text = '') {
  return Math.ceil(text.length / 4);
}

function buildEscoText(m) {
  const parts = [];
  if (m.titre) parts.push(`Métier : ${m.titre}`);
  if (m.code) parts.push(`Code ESCO/ISCO : ${m.code}`);
  if (m.domaineGrand) parts.push(`Domaine : ${m.domaineGrand}`);
  if (m.appellations?.length) parts.push(`Appellations : ${m.appellations.slice(0, 10).join(', ')}`);
  if (m.definition || m.resume) parts.push(`Description : ${m.definition || m.resume}`);
  if (m.competencesTechniquesSavoirFaire?.length || m.essentialSkills?.length) {
    const skills = m.competencesTechniquesSavoirFaire || m.essentialSkills;
    parts.push(`Compétences essentielles : ${skills.slice(0, 15).join(', ')}`);
  }
  if (m.competencesTechniquesSavoir?.length || m.optionalSkills?.length) {
    const opt = m.competencesTechniquesSavoir || m.optionalSkills;
    parts.push(`Compétences complémentaires : ${opt.slice(0, 10).join(', ')}`);
  }
  return parts.join('\n');
}

function buildDynamicBatches(items, texts) {
  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  items.forEach((item, idx) => {
    const text = texts[idx];
    const tokens = estimateTokens(text);

    if (currentBatch.length > 0 && currentTokens + tokens > MAX_TOKENS_PER_BATCH) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push({ item, text });
    currentTokens += tokens;
  });

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(texts, apiKey) {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('❌ VOYAGE_API_KEY manquante dans le fichier .env.');
    process.exit(1);
  }

  if (!fs.existsSync(ESCO_INPUT_FILE)) {
    console.error(`❌ Fichier introuvable : ${ESCO_INPUT_FILE}`);
    process.exit(1);
  }

  const escoList = JSON.parse(fs.readFileSync(ESCO_INPUT_FILE, 'utf8'));
  console.log(`📋 ${escoList.length} fiches ESCO chargées pour génération d'embeddings.`);

  // Reprise sur interruption
  let results = [];
  const alreadyDone = new Set();
  if (fs.existsSync(ESCO_EMBEDDINGS_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(ESCO_EMBEDDINGS_FILE, 'utf8'));
      results.forEach((r) => alreadyDone.add(r.url));
      console.log(`ℹ️ ${alreadyDone.size} fiches ESCO déjà vectorisées.`);
    } catch (e) {}
  }

  const remaining = escoList.filter((m) => !alreadyDone.has(m.url));
  console.log(`🔄 ${remaining.length} fiches ESCO restantes à vectoriser.`);

  if (remaining.length === 0) {
    console.log('✅ Tous les embeddings ESCO ont déjà été générés !');
    await syncToMongo(results);
    return;
  }

  const remainingTexts = remaining.map(buildEscoText);
  const batches = buildDynamicBatches(remaining, remainingTexts);
  console.log(`📦 ${batches.length} batches dynamiques à traiter (~${MAX_TOKENS_PER_BATCH} tokens max/batch).`);
  console.log(`⏱️ Estimation de la durée : ~${Math.ceil((batches.length * REQUEST_INTERVAL_MS) / 60000)} minutes.\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const texts = batch.map((b) => b.text);

    console.log(`→ Batch ${i + 1}/${batches.length} (${batch.length} métiers ESCO)...`);

    let attempt = 0;
    let success = false;
    while (attempt < 5 && !success) {
      try {
        attempt++;
        const embeddings = await embedBatch(texts, apiKey);
        batch.forEach(({ item: metier }, idx) => {
          results.push({
            url: metier.url,
            code: metier.code,
            titre: metier.titre,
            domaine: metier.domaineGrand || 'ESCO (Europe)',
            source: 'esco',
            text: texts[idx],
            embedding: embeddings[idx],
          });
        });
        success = true;
        fs.writeFileSync(ESCO_EMBEDDINGS_FILE, JSON.stringify(results, null, 2), 'utf8');
      } catch (err) {
        const isRateLimit = err.message.includes('429');
        console.error(`  ⚠️ Erreur (essai ${attempt}/5)${isRateLimit ? ' [rate limit]' : ''}:`, err.message.slice(0, 120));
        await sleep(isRateLimit ? RATE_LIMIT_COOLDOWN_MS : 4000);
      }
    }

    if (!success) {
      console.error(`  ❌ Échec sur ce batch après 5 essais, passage au suivant.`);
    }

    // Intervalle de respect du quota API
    await sleep(REQUEST_INTERVAL_MS);
  }

  console.log(`\n🎉 Génération des embeddings ESCO terminée (${results.length} vecteurs) !`);
  await syncToMongo(results);
}

async function syncToMongo(results) {
  try {
    console.log('🔄 Synchronisation des embeddings ESCO dans MongoDB...');
    await connectDB();
    const embeddingsCol = getEmbeddingsCollection();
    
    // Supprimer les anciens embeddings esco et réinsérer
    await embeddingsCol.deleteMany({ source: 'esco' });
    if (results.length > 0) {
      const res = await embeddingsCol.insertMany(results);
      console.log(`✅ ${res.insertedCount} embeddings ESCO enregistrés dans MongoDB (collection embeddings) !`);
    }
    await closeDB();
  } catch (err) {
    console.error('⚠️ Erreur lors de la synchronisation MongoDB :', err.message);
  }
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});

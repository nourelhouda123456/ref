/**
 * Génération des embeddings pour data/metiers_clean.json
 * --------------------------------------------------------
 * Pour chaque métier, construit un texte combiné (titre + définition +
 * appellations + compétences...) et le transforme en vecteur numérique
 * via l'API Voyage AI. Ces vecteurs serviront à la recherche sémantique
 * (RAG) du chatbot.
 *
 * PRÉREQUIS :
 *   - Un fichier .env à la racine avec : VOYAGE_API_KEY=ta_cle
 *   - data/metiers_clean.json généré par checkData.js
 *
 * LANCEMENT (Node 20.6+ / 24 a --env-file en natif, pas besoin de dotenv) :
 *   node --env-file=.env generateEmbeddings.js
 *
 * SORTIE :
 *   data/metiers_embeddings.json → chaque métier + son vecteur embedding
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'data', 'metiers_clean.json');
const OUTPUT_FILE = path.join(__dirname, 'data', 'metiers_embeddings.json');
const CHECKPOINT_FILE = path.join(__dirname, 'data', 'embeddings_checkpoint.json');

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite'; // rapide, pas cher, 200M tokens gratuits
// ⚠️ Compte Voyage AI SANS carte bancaire = limite stricte de 3 requêtes/minute
// ET 10 000 tokens/minute au total. On calcule donc des batches dynamiques dont
// la taille en tokens reste sous un budget sûr, et on espace chaque requête de
// 21 secondes (= max 3 requêtes/minute avec marge).
const MAX_TOKENS_PER_BATCH = 2800; // marge de sécurité sous les 10 000 TPM / 3 requêtes
const REQUEST_INTERVAL_MS = 21000; // ~3 requêtes/minute max
const RATE_LIMIT_COOLDOWN_MS = 65000; // pause longue si on tape quand même un 429

function estimateTokens(text) {
  // Estimation grossière : ~4 caractères par token (suffisant pour du budgeting)
  return Math.ceil(text.length / 4);
}

// Regroupe les métiers en batches dont le total de tokens estimé reste sous la limite
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

// Construit le texte à vectoriser à partir de tous les champs utiles d'un métier
function buildText(metier) {
  const parts = [];

  if (metier.titre) parts.push(`Métier : ${metier.titre}`);
  if (metier.code) parts.push(`Code : ${metier.code}`);
  if (metier.domaineGrand) parts.push(`Domaine : ${metier.domaineGrand}`);
  if (metier.domaineProfessionnel) parts.push(`Domaine professionnel : ${metier.domaineProfessionnel}`);
  if (metier.appellations?.length) parts.push(`Appellations : ${metier.appellations.join(', ')}`);
  if (metier.resume) parts.push(`Résumé : ${metier.resume}`);
  if (metier.definition) parts.push(`Définition : ${metier.definition}`);
  if (metier.accesEmploi) parts.push(`Accès à l'emploi : ${metier.accesEmploi}`);
  if (metier.competencesTechniquesSavoirFaire?.length) {
    parts.push(`Compétences (savoir-faire) : ${metier.competencesTechniquesSavoirFaire.join(', ')}`);
  }
  if (metier.competencesTechniquesSavoir?.length) {
    parts.push(`Connaissances (savoir) : ${metier.competencesTechniquesSavoir.join(', ')}`);
  }
  if (metier.competencesComportementales?.length) {
    parts.push(`Compétences comportementales : ${metier.competencesComportementales.join(', ')}`);
  }
  if (metier.competencesNumeriques?.length) {
    parts.push(`Compétences numériques : ${metier.competencesNumeriques.join(', ')}`);
  }
  if (metier.environnementSecteurs?.length) {
    parts.push(`Secteurs : ${metier.environnementSecteurs.join(', ')}`);
  }

  return parts.join('\n');
}

function loadJson(filePath, fallback) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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
  // data.data est un tableau d'objets { embedding, index }
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('❌ VOYAGE_API_KEY manquante. Lance avec : node --env-file=.env generateEmbeddings.js');
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ Fichier introuvable : ${INPUT_FILE} (lance d'abord checkData.js)`);
    process.exit(1);
  }

  const metiers = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`📋 ${metiers.length} métiers à vectoriser.`);

  // Reprise sur erreur : on garde les résultats déjà obtenus
  let results = loadJson(OUTPUT_FILE, []);
  const alreadyDone = new Set(results.map((r) => r.url));

  const remaining = metiers.filter((m) => !alreadyDone.has(m.url));
  console.log(`🔄 ${remaining.length} métiers restants (${alreadyDone.size} déjà faits).`);

  if (remaining.length === 0) {
    console.log('✅ Rien à faire, tout est déjà vectorisé.');
    return;
  }

  const remainingTexts = remaining.map(buildText);
  const batches = buildDynamicBatches(remaining, remainingTexts);
  console.log(`📦 ${batches.length} batches dynamiques (~${MAX_TOKENS_PER_BATCH} tokens max chacun).`);
  console.log(`⏱️  Temps estimé : ~${Math.ceil((batches.length * REQUEST_INTERVAL_MS) / 60000)} minutes.\n`);

  console.log('⏳ Pause de 65s avant de démarrer (pour repartir sur un quota propre après les tentatives précédentes)...');
  await sleep(65000);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const texts = batch.map((b) => b.text);

    console.log(`  → Batch ${i + 1}/${batches.length} (${batch.length} métiers, ~${texts.reduce((s, t) => s + estimateTokens(t), 0)} tokens estimés)...`);

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
            domaine: metier.domaine || metier.domaineGrand,
            domaineProfessionnel: metier.domaineProfessionnel,
            text: texts[idx],
            embedding: embeddings[idx],
          });
        });
        success = true;
        saveJson(OUTPUT_FILE, results);
      } catch (err) {
        const isRateLimit = err.message.includes('429');
        console.error(`  ⚠️ Erreur (essai ${attempt}/5)${isRateLimit ? ' [rate limit]' : ''}:`, err.message.slice(0, 150));
        await sleep(isRateLimit ? RATE_LIMIT_COOLDOWN_MS : 3000);
      }
    }

    if (!success) {
      console.error(`  ❌ Échec définitif sur ce batch après 5 essais, on continue avec le suivant.`);
    }

    // Respecte l'espacement même après un succès rapide
    await sleep(REQUEST_INTERVAL_MS);
  }

  saveJson(OUTPUT_FILE, results);
  console.log(`\n✅ Terminé ! ${results.length} embeddings sauvegardés dans ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
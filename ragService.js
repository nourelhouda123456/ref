/**
 * Moteur RAG RTMC : les réponses et recommandations restent toujours reliées
 * à une fiche officielle (code + URL RTMC). Aucun fine-tuning n'est requis.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const METIERS_FILE = path.join(DATA_DIR, 'metiers_with_salaries.json');
const EMBEDDINGS_FILE = path.join(DATA_DIR, 'metiers_embeddings.json');
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite';

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const metiers = loadJson(METIERS_FILE);
const metiersByUrl = new Map(metiers.map((m) => [m.url, m]));
const embeddings = fs.existsSync(EMBEDDINGS_FILE) ? loadJson(EMBEDDINGS_FILE) : [];

function normalize(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokens(text) {
  return [...new Set(normalize(text).match(/[a-z0-9]{2,}/g) || [])];
}

function cosine(a, b) {
  let dot = 0, a2 = 0, b2 = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; a2 += a[i] * a[i]; b2 += b[i] * b[i];
  }
  return dot / (Math.sqrt(a2) * Math.sqrt(b2) || 1);
}

function documentText(m) {
  return [m.titre, m.code, m.domaineGrand, m.domaineProfessionnel, m.resume,
    m.definition, ...(m.appellations || []), ...(m.competencesTechniquesSavoirFaire || []),
    ...(m.competencesTechniquesSavoir || []), ...(m.competencesComportementales || []),
    ...(m.competencesNumeriques || []), ...(m.environnementSecteurs || [])].filter(Boolean).join(' ');
}

function lexicalSearch(query, limit) {
  const queryTokens = tokens(query);
  return metiers.map((metier) => {
    const docTokens = new Set(tokens(documentText(metier)));
    const titleTokens = new Set(tokens(`${metier.titre} ${(metier.appellations || []).join(' ')}`));
    const matches = queryTokens.filter((token) => docTokens.has(token));
    // Le titre et les appellations sont volontairement surpondérés : une question
    // qui nomme « développeur informatique » doit retrouver cette fiche avant
    // un métier qui partage seulement le mot « informatique ».
    const titleMatches = queryTokens.filter((token) => titleTokens.has(token));
    const exactTitle = normalize(query).includes(normalize(metier.titre));
    const score = (matches.length + (titleMatches.length * 3) + (exactTitle ? 8 : 0))
      / Math.max(queryTokens.length + 8, 1);
    return { metier, score, matches };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

async function embedQuery(query) {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: [query], model: VOYAGE_MODEL, input_type: 'query' }),
  });
  if (!response.ok) throw new Error(`Embedding query impossible (${response.status}).`);
  const body = await response.json();
  return body.data[0].embedding;
}

async function search(query, limit = 5) {
  if (!query || !query.trim()) throw new Error('La question ou le profil CV est requis.');
  const vector = await embedQuery(query);
  if (!vector || embeddings.length === 0) return lexicalSearch(query, limit);

  return embeddings.map((item) => ({
    metier: metiersByUrl.get(item.url), score: cosine(vector, item.embedding), matches: [],
  })).filter((r) => r.metier).sort((a, b) => b.score - a.score).slice(0, limit);
}

function reference(metier, score) {
  return {
    code: metier.code,
    titre: metier.titre,
    domaine: metier.domaineGrand,
    url: metier.url,
    pertinence: Math.max(0, Math.min(100, Math.round(score * 100))),
    salary: metier.salary || null,
  };
}

// Réponse extractive : les faits exposés proviennent de la fiche, sans invention d'un LLM.
function answerFromMetier(question, metier) {
  const q = normalize(question);
  if (/competence|savoir-faire|qualification|qualite/.test(q)) {
    const skills = [...(metier.competencesTechniquesSavoirFaire || []), ...(metier.competencesTechniquesSavoir || []), ...(metier.competencesComportementales || [])];
    return skills.length ? skills.join('; ') : metier.definition;
  }
  if (/formation|diplome|acced|acces|devenir|etud/.test(q)) return metier.accesEmploi || metier.definition;
  if (/secteur|ou travailler|entreprise|environnement/.test(q)) return (metier.environnementSecteurs || []).join('; ') || metier.definition;
  if (/numerique|informatique/.test(q) && (metier.competencesNumeriques || []).length) return metier.competencesNumeriques.join('; ');
  return metier.definition || metier.resume;
}

async function ask(question) {
  const results = await search(question, 3);
  if (!results.length) return { answer: 'Aucune fiche RTMC suffisamment pertinente n’a été trouvée.', sources: [], mode: 'lexical' };
  const best = results[0].metier;
  return {
    answer: answerFromMetier(question, best),
    sources: results.map(({ metier, score }) => reference(metier, score)),
    mode: process.env.VOYAGE_API_KEY && embeddings.length ? 'semantic' : 'lexical',
  };
}

async function recommend(cvText, limit = 5) {
  const results = await search(cvText, limit);
  return {
    recommendations: results.map(({ metier, score, matches }) => ({
      ...reference(metier, score),
      raison: matches.length
        ? `Mots clés du profil retrouvés dans la fiche : ${matches.slice(0, 8).join(', ')}.`
        : `Compatibilité sémantique entre le profil et les compétences de la fiche RTMC.`,
      competencesPrincipales: (metier.competencesTechniquesSavoirFaire || []).slice(0, 5),
    })),
    mode: process.env.VOYAGE_API_KEY && embeddings.length ? 'semantic' : 'lexical',
  };
}

function getSimilarMetiers(url, limit = 5) {
  if (!url) return [];
  const target = embeddings.find((e) => e.url === url);
  if (!target || embeddings.length === 0) {
    const job = metiers.find((m) => m.url === url);
    if (!job) return [];
    return metiers
      .filter((m) => m.url !== url && m.domaineGrand === job.domaineGrand)
      .slice(0, limit)
      .map((m) => reference(m, 0.7));
  }

  return embeddings
    .map((item) => ({
      metier: metiersByUrl.get(item.url),
      score: cosine(target.embedding, item.embedding),
    }))
    .filter((r) => r.metier && r.metier.url !== url)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ metier, score }) => reference(metier, score));
}

module.exports = { ask, recommend, metiersCount: metiers.length, metiers, getSimilarMetiers };


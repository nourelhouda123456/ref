/**
 * Moteur RAG RTMC : les réponses et recommandations restent toujours reliées
 * à une fiche officielle (code + URL RTMC). Aucun fine-tuning n'est requis.
 *
 * Les données sont chargées depuis MongoDB au démarrage (via init()).
 */
const { connectDB, getMetiersCollection, getEmbeddingsCollection } = require('./db');

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite';

// Données chargées en mémoire depuis MongoDB (cache)
let metiers = [];
let metiersByUrl = new Map();
let embeddings = [];

/**
 * Initialise le service RAG : se connecte à MongoDB et charge les données en mémoire.
 * Doit être appelé avant toute utilisation des fonctions ask/recommend/etc.
 */
async function init() {
  await connectDB();

  const metiersCol = getMetiersCollection();
  metiers = await metiersCol.find({}).toArray();
  metiersByUrl = new Map(metiers.map((m) => [m.url, m]));
  console.log(`📚 ${metiers.length} fiches métiers chargées depuis MongoDB`);

  const embeddingsCol = getEmbeddingsCollection();
  embeddings = await embeddingsCol.find({}).toArray();
  console.log(`🧠 ${embeddings.length} embeddings chargés depuis MongoDB`);
}

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
  // Gestion du salaire
  if (/salaire|remuneration|rémunération|pay|earn/.test(q)) {
    if (!metier.salary) return `Aucune donnée de salaire n'est disponible pour ${metier.titre}.`;
    
    // Si le salaire est un objet structuré (min, max, avg, currency, period)
    if (typeof metier.salary === 'object' && metier.salary.salaryAvg) {
      return `Le salaire moyen de ${metier.titre} est d'environ ${metier.salary.salaryAvg} ${metier.salary.currency} / ${metier.salary.period} (fourchette : ${metier.salary.salaryMin} - ${metier.salary.salaryMax} ${metier.salary.currency}).`;
    }
    
    // Si le salaire est une simple chaîne
    return `Le salaire moyen de ${metier.titre} est ${metier.salary}.`;
  }
  return metier.definition || metier.resume;
}

async function ask(question) {
  // Simple greeting handling – if the user just says hello, respond with the welcome message.
  if (/^\s*(bonjour|salut|bonsoir|hello|hi)\b/i.test(question)) {
    return { answer: '👋 Bonjour ! Posez-moi une question sur les métiers, les compétences, les formations…', sources: [], mode: 'lexical' };
  }

  const results = await search(question, 3);
  if (!results.length) return { answer: 'Je n\'ai pas trouvé de fiche RTMC correspondant à votre requête. Pouvez-vous reformuler ?', sources: [], mode: 'lexical' };
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

module.exports = { init, ask, recommend, metiersCount: () => metiers.length, metiers: () => metiers, getSimilarMetiers };

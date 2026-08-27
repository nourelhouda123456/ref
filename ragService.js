/**
 * Moteur RAG Multi-Référentiel : RTMC (Tunisie) + ESCO (Europe)
 * Les réponses et recommandations restent toujours reliées
 * à une fiche officielle (code + URL).
 *
 * Les données sont chargées depuis MongoDB au démarrage (via init()).
 */
const { connectDB, getMetiersCollection, getEmbeddingsCollection, getEscoCollection } = require('./db');

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4-lite';

// Données chargées en mémoire depuis MongoDB (cache)
let rtmcMetiers = [];
let escoMetiers = [];
let metiers = []; // Ensemble combiné RTMC + ESCO
let metiersByUrl = new Map();
let embeddings = [];

/**
 * Initialise le service RAG : se connecte à MongoDB et charge les données en mémoire.
 * Charge à la fois les fiches RTMC et ESCO.
 */
async function init() {
  await connectDB();

  // 1. Charger les fiches RTMC
  const metiersCol = getMetiersCollection();
  rtmcMetiers = (await metiersCol.find({}).toArray()).map(m => ({
    ...m,
    source: m.source || 'rtmc',
    domaineGrand: m.domaineGrand || m.domaine || 'RTMC (Tunisie)'
  }));
  console.log(`📚 ${rtmcMetiers.length} fiches métiers RTMC chargées depuis MongoDB`);

  // 2. Charger les fiches ESCO
  try {
    const escoCol = getEscoCollection();
    escoMetiers = (await escoCol.find({}).toArray()).map(m => ({
      ...m,
      source: 'esco',
      domaineGrand: m.domaineGrand || 'ESCO (Europe)'
    }));
    console.log(`🇪🇺 ${escoMetiers.length} fiches métiers ESCO chargées depuis MongoDB`);
  } catch (err) {
    console.log('⚠️ Collection ESCO non disponible ou vide.');
    escoMetiers = [];
  }

  // 3. Fusionner les deux référentiels
  metiers = [...rtmcMetiers, ...escoMetiers];
  metiersByUrl = new Map(metiers.map((m) => [m.url, m]));
  console.log(`🌐 Total fiches actives : ${metiers.length} (RTMC: ${rtmcMetiers.length}, ESCO: ${escoMetiers.length})`);

  // 4. Charger les embeddings
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
  return [
    m.titre, m.code, m.domaineGrand, m.domaineProfessionnel, m.resume,
    m.definition, ...(m.appellations || []),
    ...(m.competencesTechniquesSavoirFaire || m.essentialSkills || []),
    ...(m.competencesTechniquesSavoir || m.optionalSkills || []),
    ...(m.competencesComportementales || []),
    ...(m.competencesNumeriques || []),
    ...(m.environnementSecteurs || [])
  ].filter(Boolean).join(' ');
}

function lexicalSearch(query, limit) {
  const queryTokens = tokens(query);
  return metiers.map((metier) => {
    const docTokens = new Set(tokens(documentText(metier)));
    const titleTokens = new Set(tokens(`${metier.titre} ${(metier.appellations || []).join(' ')}`));
    const matches = queryTokens.filter((token) => docTokens.has(token));
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
  
  // 1. Recherche lexicale sur l'ensemble complet (RTMC + ESCO : 3 468 fiches)
  const lexicalResults = lexicalSearch(query, limit * 6);
  const lexicalMap = new Map(lexicalResults.map(r => [r.metier.url, r]));

  // 2. Recherche sémantique si clé présente et embeddings disponibles
  const vector = await embedQuery(query).catch(() => null);
  const semanticMap = new Map();
  if (vector && embeddings.length > 0) {
    for (const item of embeddings) {
      const metier = metiersByUrl.get(item.url);
      if (metier) {
        const score = cosine(vector, item.embedding);
        semanticMap.set(item.url, score);
      }
    }
  }

  // 3. Fusion et score hybride pour chaque métier candidat
  const candidateUrls = new Set([...lexicalMap.keys(), ...semanticMap.keys()]);
  const ranked = [];

  for (const url of candidateUrls) {
    const metier = metiersByUrl.get(url);
    if (!metier) continue;

    const lexItem = lexicalMap.get(url);
    const lexScore = lexItem ? lexItem.score : 0;
    const semScore = semanticMap.get(url) || 0;
    const matches = lexItem ? lexItem.matches : [];

    let finalScore = 0;
    if (semScore > 0 && lexScore > 0) {
      // Les deux moteurs confirment la pertinence
      finalScore = (semScore * 0.45) + (lexScore * 0.55);
    } else if (semScore > 0) {
      finalScore = semScore * 0.8;
    } else {
      finalScore = lexScore;
    }

    if (finalScore > 0.05) {
      ranked.push({ metier, score: finalScore, matches });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

function reference(metier, score) {
  const isEsco = metier.source === 'esco' || metier.uri?.includes('esco');
  return {
    code: metier.code,
    titre: metier.titre,
    domaine: metier.domaineGrand || metier.domaine,
    url: metier.url,
    pertinence: Math.max(0, Math.min(100, Math.round(score * 100))),
    salary: metier.salary || null,
    source: isEsco ? 'esco' : 'rtmc',
  };
}

// Réponse extractive : les faits exposés proviennent de la fiche officielle
function answerFromMetier(question, metier) {
  const q = normalize(question);
  const isEsco = metier.source === 'esco' || metier.uri?.includes('esco');

  if (/competence|savoir-faire|qualification|qualite|skill/.test(q)) {
    const skills = [
      ...(metier.competencesTechniquesSavoirFaire || metier.essentialSkills || []),
      ...(metier.competencesTechniquesSavoir || metier.optionalSkills || []),
      ...(metier.competencesComportementales || [])
    ];
    return skills.length ? skills.join('; ') : (metier.definition || metier.resume);
  }
  if (/formation|diplome|acced|acces|devenir|etud/.test(q)) {
    if (isEsco) {
      return metier.accesEmploi || `Fiche ESCO (Référentiel Européen) : ${metier.definition || metier.resume}`;
    }
    return metier.accesEmploi || metier.definition || metier.resume;
  }
  if (/secteur|ou travailler|entreprise|environnement/.test(q)) {
    return (metier.environnementSecteurs || []).join('; ') || metier.domaineProfessionnel || metier.definition;
  }
  if (/numerique|informatique/.test(q) && (metier.competencesNumeriques || []).length) {
    return metier.competencesNumeriques.join('; ');
  }
  // Gestion du salaire
  if (/salaire|remuneration|rémunération|pay|earn/.test(q)) {
    if (isEsco) {
      return `Le référentiel européen ESCO ne contient pas de grille salariale locale pour le métier de ${metier.titre}.`;
    }
    if (!metier.salary) return `Aucune donnée de salaire n'est disponible pour ${metier.titre}.`;
    
    if (typeof metier.salary === 'object' && metier.salary.salaryAvg) {
      return `Le salaire moyen de ${metier.titre} est d'environ ${metier.salary.salaryAvg} ${metier.salary.currency} / ${metier.salary.period} (fourchette : ${metier.salary.salaryMin} - ${metier.salary.salaryMax} ${metier.salary.currency}).`;
    }
    return `Le salaire moyen de ${metier.titre} est ${metier.salary}.`;
  }
  return metier.definition || metier.resume;
}

async function ask(question) {
  if (/^\s*(bonjour|salut|bonsoir|hello|hi)\b/i.test(question)) {
    return { answer: '👋 Bonjour ! Posez-moi une question sur les métiers, les compétences (RTMC ou ESCO), les formations…', sources: [], mode: 'lexical' };
  }

  const results = await search(question, 3);
  if (!results.length) return { answer: 'Je n\'ai pas trouvé de fiche RTMC ou ESCO correspondant à votre requête. Pouvez-vous reformuler ?', sources: [], mode: 'lexical' };
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
        ? `Mots clés du profil retrouvés : ${matches.slice(0, 8).join(', ')}.`
        : `Compatibilité avec le référentiel ${metier.source === 'esco' ? 'européen (ESCO)' : 'tunisien (RTMC)'}.`,
      competencesPrincipales: (metier.competencesTechniquesSavoirFaire || metier.essentialSkills || []).slice(0, 5),
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
      .filter((m) => m.url !== url && (m.domaineGrand === job.domaineGrand || m.source === job.source))
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

function analyzeTransferability(sourceUrl, targetUrl) {
  const findJob = (key) => {
    if (!key) return null;
    const k = String(key).trim().toLowerCase();
    return metiers.find(m => 
      (m.url && m.url.toLowerCase() === k) ||
      (m.code && m.code.toLowerCase() === k) ||
      (m.titre && m.titre.toLowerCase() === k) ||
      (m.url && m.url.toLowerCase().includes(k))
    );
  };

  const sourceJob = findJob(sourceUrl);
  const targetJob = findJob(targetUrl);

  if (!sourceJob || !targetJob) {
    throw new Error('Métier source ou cible introuvable.');
  }

  const getSkills = (m) => {
    const list = [
      ...(m.competencesTechniquesSavoirFaire || m.essentialSkills || []),
      ...(m.competencesTechniquesSavoir || m.optionalSkills || []),
      ...(m.competencesComportementales || []),
      ...(m.competencesNumeriques || [])
    ];
    return Array.from(new Set(list.filter(Boolean).map(s => s.trim())));
  };

  const sourceSkills = getSkills(sourceJob);
  const targetSkills = getSkills(targetJob);

  const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const acquired = [];
  const missing = [];

  const normSourceSkills = sourceSkills.map(s => ({ raw: s, norm: normalize(s) }));

  targetSkills.forEach(tSkill => {
    const normT = normalize(tSkill);
    const match = normSourceSkills.find(s => s.norm === normT || s.norm.includes(normT) || normT.includes(s.norm));
    if (match) {
      acquired.push(tSkill);
    } else {
      missing.push(tSkill);
    }
  });

  let matchPercentage = 0;
  if (targetSkills.length > 0) {
    matchPercentage = Math.round((acquired.length / targetSkills.length) * 100);
  } else if (sourceJob.domaineGrand === targetJob.domaineGrand) {
    matchPercentage = 75;
  } else {
    matchPercentage = 50;
  }

  if (sourceJob.domaineGrand === targetJob.domaineGrand && matchPercentage < 90) {
    matchPercentage = Math.min(100, matchPercentage + 15);
  }

  let effort = 'Faible (Facile)';
  let effortClass = 'easy';
  if (matchPercentage < 40) {
    effort = 'Élevé (Reconversion complète)';
    effortClass = 'hard';
  } else if (matchPercentage < 75) {
    effort = 'Moyen (Formation complémentaire)';
    effortClass = 'medium';
  }

  return {
    sourceJob: {
      code: sourceJob.code,
      titre: sourceJob.titre,
      source: sourceJob.source || 'rtmc',
      domaineGrand: sourceJob.domaineGrand,
      url: sourceJob.url
    },
    targetJob: {
      code: targetJob.code,
      titre: targetJob.titre,
      source: targetJob.source || 'rtmc',
      domaineGrand: targetJob.domaineGrand,
      url: targetJob.url
    },
    matchPercentage,
    effort,
    effortClass,
    totalTargetSkills: targetSkills.length,
    acquiredSkills: acquired,
    missingSkills: missing
  };
}

module.exports = {
  init,
  ask,
  recommend,
  metiersCount: () => metiers.length,
  metiers: () => metiers,
  rtmcCount: () => rtmcMetiers.length,
  escoCount: () => escoMetiers.length,
  getSimilarMetiers,
  analyzeTransferability
};

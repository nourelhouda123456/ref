/**
 * Moteur RAG Multi-Référentiel : RTMC (Tunisie) + ESCO (Europe)
 * Les réponses et recommandations restent toujours reliées
 * à une fiche officielle (code + URL).
 *
 * Les données sont chargées depuis MongoDB au démarrage (via init()).
 */
const fs = require('fs');
const path = require('path');
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
  try {
    await connectDB();
  } catch (err) {
    console.log('⚠️ MongoDB non disponible, utilisation des fichiers de secours locaux.');
  }

  // 1. Charger les fiches RTMC (exclure les métiers explicitement désactivés)
  try {
    const metiersCol = getMetiersCollection();
    if (metiersCol) {
      rtmcMetiers = (await metiersCol.find({ active: { $ne: false } }).toArray()).map(m => ({
        ...m,
        source: m.source || 'rtmc',
        domaineGrand: m.domaineGrand || m.domaine || 'RTMC (Tunisie)'
      }));
    }
  } catch (err) {
    rtmcMetiers = [];
  }

  if (rtmcMetiers.length === 0) {
    const localRtmcPath = path.join(__dirname, 'data', 'metiers_with_salaries.json');
    const fallbackPath = fs.existsSync(localRtmcPath) ? localRtmcPath : path.join(__dirname, 'data', 'metiers.json');
    if (fs.existsSync(fallbackPath)) {
      console.log(`📁 Chargement RTMC depuis fichier local (${path.basename(fallbackPath)})...`);
      rtmcMetiers = JSON.parse(fs.readFileSync(fallbackPath, 'utf8')).map(m => ({
        ...m,
        source: 'rtmc',
        domaineGrand: m.domaineGrand || m.domaine || 'RTMC (Tunisie)'
      }));
    }
  }
  console.log(`📚 ${rtmcMetiers.length} fiches métiers RTMC chargées`);

  // 2. Charger les fiches ESCO (exclure les métiers explicitement désactivés)
  try {
    const escoCol = getEscoCollection();
    if (escoCol) {
      escoMetiers = (await escoCol.find({ active: { $ne: false } }).toArray()).map(m => ({
        ...m,
        source: 'esco',
        domaineGrand: m.domaineGrand || 'ESCO (Europe)'
      }));
    }
  } catch (err) {
    escoMetiers = [];
  }

  if (escoMetiers.length === 0) {
    const localEscoPath = path.join(__dirname, 'data', 'esco_occupations.json');
    if (fs.existsSync(localEscoPath)) {
      console.log(`📁 Chargement ESCO depuis fichier local (esco_occupations.json)...`);
      escoMetiers = JSON.parse(fs.readFileSync(localEscoPath, 'utf8')).map(m => ({
        ...m,
        source: 'esco',
        domaineGrand: m.domaineGrand || 'ESCO (Europe)'
      }));
    }
  }
  console.log(`🇪🇺 ${escoMetiers.length} fiches métiers ESCO chargées`);

  // 3. Fusionner les deux référentiels
  metiers = [...rtmcMetiers, ...escoMetiers];
  metiersByUrl = new Map(metiers.map((m) => [m.url, m]));
  console.log(`🌐 Total fiches actives : ${metiers.length} (RTMC: ${rtmcMetiers.length}, ESCO: ${escoMetiers.length})`);

  // 4. Charger les embeddings
  try {
    const embeddingsCol = getEmbeddingsCollection();
    if (embeddingsCol) {
      embeddings = await embeddingsCol.find({}).toArray();
    }
  } catch (err) {
    embeddings = [];
  }

  if (embeddings.length === 0) {
    const localEmbPath = path.join(__dirname, 'data', 'metiers_embeddings.json');
    if (fs.existsSync(localEmbPath)) {
      console.log(`📁 Chargement Embeddings depuis fichier local...`);
      embeddings = JSON.parse(fs.readFileSync(localEmbPath, 'utf8'));
    }
  }
  console.log(`🧠 ${embeddings.length} embeddings chargés`);
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
  // Gestion du salaire & niveaux de séniorité
  if (/salaire|remuneration|rémunération|pay|earn|gagne|combien|junior|senior|débutant|expert/.test(q)) {
    try {
      const career = calculateCareerAndSalary(metier.url);
      const lvlKey = /expert|lead|manager/.test(q) ? 'expert' :
                     /senior/.test(q) ? 'senior' :
                     /confirme|intermediaire/.test(q) ? 'confirme' :
                     /debutant|stage/.test(q) ? 'debutant' :
                     /junior/.test(q) ? 'junior' : null;
      
      if (lvlKey && career.levels[lvlKey]) {
        const lvl = career.levels[lvlKey];
        return `Pour le niveau **${lvl.label}** (${lvl.experience}), le salaire estimé pour **${metier.titre}** est de **${lvl.salaryMin.toLocaleString()} à ${lvl.salaryMax.toLocaleString()} ${career.currency} / ${career.period}** (moyenne : ${lvl.salaryAvg.toLocaleString()} ${career.currency}). Responsabilités : ${lvl.responsibilities}`;
      }

      return `Grille salariale pour **${metier.titre}** (${career.isEsco ? 'Référentiel Européen ESCO' : 'Référentiel Tunisien RTMC'}) :\n` +
        `• 🌱 Débutant (0-1 an) : ${career.levels.debutant.salaryMin.toLocaleString()} - ${career.levels.debutant.salaryMax.toLocaleString()} ${career.currency}\n` +
        `• ⚡ Junior (1-3 ans) : ${career.levels.junior.salaryMin.toLocaleString()} - ${career.levels.junior.salaryMax.toLocaleString()} ${career.currency}\n` +
        `• ⭐ Confirmé (3-5 ans) : ${career.levels.confirme.salaryMin.toLocaleString()} - ${career.levels.confirme.salaryMax.toLocaleString()} ${career.currency}\n` +
        `• 🚀 Senior (5-8 ans) : ${career.levels.senior.salaryMin.toLocaleString()} - ${career.levels.senior.salaryMax.toLocaleString()} ${career.currency}\n` +
        `• 👑 Expert / Lead (8+ ans) : ${career.levels.expert.salaryMin.toLocaleString()} - ${career.levels.expert.salaryMax.toLocaleString()} ${career.currency}`;
    } catch {
      // Fallback
    }

    if (isEsco) {
      return `Le salaire moyen européen pour ${metier.titre} est estimé entre 32 000 et 65 000 EUR brut / an selon la séniorité et le pays.`;
    }
    if (!metier.salary) return `Le salaire moyen de ${metier.titre} est estimé entre 1 200 et 2 500 TND / mois selon l'expérience.`;
    
    if (typeof metier.salary === 'object' && metier.salary.salaryAvg) {
      return `Le salaire de ${metier.titre} est d'environ ${metier.salary.salaryAvg} ${metier.salary.currency} / ${metier.salary.period} (fourchette : ${metier.salary.salaryMin} - ${metier.salary.salaryMax} ${metier.salary.currency}).`;
    }
    return `Le salaire moyen de ${metier.titre} est ${metier.salary}.`;
  }
  return metier.definition || metier.resume;
}

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-1212';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Génération de réponse fluide et intelligente via LLM (Grok xAI, Groq, OpenAI)
 * en lui fournissant le contexte exact extrait des référentiels RTMC & ESCO.
 */
async function generateWithGrok(question, candidates) {
  const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!grokKey && !groqKey && !openaiKey) return null;

  try {
    const contextData = candidates.map(({ metier, score }) => {
      const isEsco = metier.source === 'esco';
      let salaryInfo = 'Non spécifié';
      try {
        const c = calculateCareerAndSalary(metier.url);
        salaryInfo = `Débutant: ${c.levels.debutant.salaryMin}-${c.levels.debutant.salaryMax} ${c.currency}, Junior: ${c.levels.junior.salaryMin}-${c.levels.junior.salaryMax} ${c.currency}, Senior: ${c.levels.senior.salaryMin}-${c.levels.senior.salaryMax} ${c.currency}, Expert: ${c.levels.expert.salaryMin}-${c.levels.expert.salaryMax} ${c.currency}`;
      } catch {}

      return `--- FICHE RÉFÉRENTIEL : ${metier.titre} (Code : ${metier.code || 'N/A'}, Référentiel : ${isEsco ? 'ESCO Europe' : 'RTMC Tunisie'}) ---
Domaine : ${metier.domaineGrand || metier.domaine || ''}
Définition/Résumé : ${metier.definition || metier.resume || ''}
Accès/Formation : ${metier.accesEmploi || 'N/A'}
Savoir-faire clés : ${(metier.competencesTechniquesSavoirFaire || metier.essentialSkills || []).slice(0, 10).join(', ')}
Connaissances : ${(metier.competencesTechniquesSavoir || metier.optionalSkills || []).slice(0, 8).join(', ')}
Soft Skills : ${(metier.competencesComportementales || []).slice(0, 6).join(', ')}
Compétences Numériques : ${(metier.competencesNumeriques || []).join(', ')}
Grille Salariale par Séniorité : ${salaryInfo}
`;
    }).join('\n\n');

    const prompt = `Tu es un conseiller carrière IA. Réponds de manière COURTE, SIMPLE et NATURELLE (2-4 phrases maximum).

RÈGLES STRICTES :
1. Réponds en français conversationnel simple (pas de tableaux, pas de formatage complexe)
2. Pour les salaires : donne UNIQUEMENT les fourchettes principales (junior et senior suffisent)
3. Maximum 3-4 lignes de texte
4. Pas de "Conseil pratique", pas de listes à puces longues
5. Va droit au but

Exemple de bonne réponse :
"Pour un développeur en Europe, le salaire junior se situe entre 30 000 et 44 000 EUR/an. Un profil senior peut atteindre 54 000 à 79 000 EUR/an selon l'expérience et le pays."

CONTEXTE :
${contextData}

QUESTION :
${question}`;

    const messages = [
      { role: 'system', content: 'Tu es un conseiller carrière. Réponds de manière courte et naturelle en 2-4 phrases maximum.' },
      { role: 'user', content: prompt }
    ];

    let apiUrl = GROK_API_URL;
    let apiKey = grokKey;
    let modelName = GROK_MODEL;

    if (grokKey) {
      apiUrl = GROK_API_URL;
      apiKey = grokKey;
      modelName = process.env.GROK_MODEL || 'grok-2-1212';
    } else if (groqKey) {
      apiUrl = GROQ_API_URL;
      apiKey = groqKey;
      modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    } else if (openaiKey) {
      apiUrl = OPENAI_API_URL;
      apiKey = openaiKey;
      modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages,
        model: modelName,
        temperature: 0.7,
        max_tokens: 200
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️ LLM API Error (${res.status}):`, errText);
      return null;
    }

    const data = await res.json();
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
  } catch (err) {
    console.warn('⚠️ Erreur appel LLM API:', err.message);
    return null;
  }
}

async function ask(question) {
  // Détection élargie des salutations (avec variantes: hi, hiii, heyy, etc.)
  if (/^\s*(bonjour|salut|bonsoir|hello|he+y+|hi+)\s*[!?.]?\s*$/i.test(question)) {
    return { answer: '👋 Bonjour ! Posez-moi une question sur les métiers, les compétences, les niveaux de séniorité (junior/senior) et les salaires RTMC & ESCO.', sources: [], mode: 'greeting' };
  }

  const results = await search(question, 3);
  if (!results.length) return { answer: 'Je n\'ai pas trouvé de fiche RTMC ou ESCO correspondant à votre requête. Pouvez-vous reformuler ?', sources: [], mode: 'lexical' };
  
  // 1. Tenter la génération intelligente via Grok
  const grokAnswer = await generateWithGrok(question, results);
  
  // 2. Si Grok a répondu, l'utiliser ; sinon fallback vers moteur local
  const finalAnswer = grokAnswer || answerFromMetier(question, results[0].metier);
  const activeMode = grokAnswer ? 'grok-ia' : (process.env.VOYAGE_API_KEY && embeddings.length ? 'semantic' : 'lexical');

  return {
    answer: finalAnswer,
    sources: results.map(({ metier, score }) => reference(metier, score)),
    mode: activeMode,
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

/**
 * Moteur Intelligent de Niveaux de Séniorité & Salaires Prédictifs
 * Détermine les 5 échelons (Débutant, Junior, Confirmé, Senior, Expert)
 * avec fourchettes de salaires ajustées, responsabilités, compétences cibles et roadmap IA.
 */
function calculateCareerAndSalary(jobUrlOrCode, targetLevel = 'junior') {
  const findJob = (key) => {
    if (!key) return null;
    const k = String(key).trim().toLowerCase();
    return metiers.find(m => 
      (m.url && m.url.toLowerCase() === k) ||
      (m.code && m.code.toLowerCase() === k) ||
      (m.titre && m.titre.toLowerCase() === k) ||
      (m.url && m.url.toLowerCase().includes(k)) ||
      (m.titre && m.titre.toLowerCase().includes(k))
    );
  };

  const job = findJob(jobUrlOrCode);
  if (!job) {
    throw new Error('Fiche métier introuvable.');
  }

  const isEsco = job.source === 'esco' || (job.uri && job.uri.includes('esco')) || (job.code && job.code.startsWith('ESCO'));
  
  // 1. Détermination du salaire médian de référence (Junior / base)
  let baseMin = 1000;
  let baseMax = 1800;
  let currency = isEsco ? 'EUR' : 'TND';
  let period = isEsco ? 'an' : 'mois';

  if (!isEsco) {
    // RTMC : utiliser la donnée réelle du JSON si présente
    if (job.salary && job.salary.salaryMin && job.salary.salaryMax) {
      baseMin = job.salary.salaryMin;
      baseMax = job.salary.salaryMax;
    } else {
      const codeFirst = (job.code || '').charAt(0).toUpperCase();
      const domain = (job.domaineGrand || job.domaine || '').toLowerCase();
      
      if (codeFirst === 'M' || domain.includes('informatique') || domain.includes('numérique')) {
        baseMin = 1400; baseMax = 2500;
      } else if (codeFirst === 'I' || domain.includes('ingénierie') || domain.includes('industrie')) {
        baseMin = 1300; baseMax = 2200;
      } else if (codeFirst === 'J' || domain.includes('santé')) {
        baseMin = 1200; baseMax = 2100;
      } else if (codeFirst === 'C' || domain.includes('banque') || domain.includes('finance')) {
        baseMin = 1300; baseMax = 2300;
      } else if (codeFirst === 'A' || domain.includes('agriculture')) {
        baseMin = 750; baseMax = 1200;
      } else if (codeFirst === 'F' || domain.includes('btp') || domain.includes('construction')) {
        baseMin = 950; baseMax = 1650;
      } else {
        baseMin = 900; baseMax = 1600;
      }
    }
  } else {
    // ESCO : Référentiel Européen (Brut annuel EUR)
    const title = (job.titre || '').toLowerCase();
    const domain = (job.domaineGrand || job.domaine || '').toLowerCase();
    if (title.includes('developer') || title.includes('ingénieur') || title.includes('engineer') || title.includes('architect') || title.includes('software') || title.includes('data')) {
      baseMin = 38000; baseMax = 52000;
    } else if (title.includes('manager') || title.includes('directeur') || title.includes('lead') || title.includes('consultant')) {
      baseMin = 45000; baseMax = 62000;
    } else if (title.includes('médecin') || title.includes('doctor') || title.includes('nurse') || domain.includes('santé')) {
      baseMin = 40000; baseMax = 58000;
    } else if (title.includes('ouvrier') || title.includes('technician') || title.includes('technicien')) {
      baseMin = 26000; baseMax = 36000;
    } else {
      baseMin = 30000; baseMax = 44000;
    }
  }

  const baseAvg = Math.round((baseMin + baseMax) / 2);

  // 2. Grille des 5 Niveaux de Séniorité
  const levelConfigs = [
    {
      id: 'debutant',
      label: 'Débutant / Stage',
      icon: '🌱',
      color: '#10b981',
      badgeClass: 'level-debutant',
      experience: '0 – 1 an',
      multiplier: 0.80,
      role: 'Exécution guidée, intégration opérationnelle et maîtrise des outils socles.',
      responsibilities: 'Réalisation des tâches sous supervision directe, application rigoureuse des procédures et apprentissage actif.',
      growthBonus: '+0% (Palier de départ)',
      nextLevelTarget: 'Acquérir l\'autonomie complète sur les tâches courantes sans validation continue.'
    },
    {
      id: 'junior',
      label: 'Junior',
      icon: '⚡',
      color: '#477CA8',
      badgeClass: 'level-junior',
      experience: '1 – 3 ans',
      multiplier: 1.00,
      role: 'Autonomie opérationnelle sur les missions clés et respect des délais.',
      responsibilities: 'Prise en charge de dossiers complets, collaboration étroite avec l\'équipe, premiers diagnostics autonomes.',
      growthBonus: '+25% par rapport au Débutant',
      nextLevelTarget: 'Résoudre des cas complexes, maîtriser les compétences transverses et optimiser les processus.'
    },
    {
      id: 'confirme',
      label: 'Confirmé (Intermédiaire)',
      icon: '⭐',
      color: '#8b5cf6',
      badgeClass: 'level-confirme',
      experience: '3 – 5 ans',
      multiplier: 1.35,
      role: 'Maîtrise approfondie, efficacité démontrée et gestion des imprévus.',
      responsibilities: 'Résolution de problèmes avancés, garantie de la qualité des livrables, participation à l\'amélioration continue.',
      growthBonus: '+35% par rapport au Junior',
      nextLevelTarget: 'Développer le leadership technique, encadrer des profils plus juniors et piloter des projets critiques.'
    },
    {
      id: 'senior',
      label: 'Senior',
      icon: '🚀',
      color: '#f59e0b',
      badgeClass: 'level-senior',
      experience: '5 – 8 ans',
      multiplier: 1.80,
      role: 'Expertise reconnue, mentorat, prise de décision technique et organisationnelle.',
      responsibilities: 'Mentorat des équipes, arbitrage sur les choix techniques majeurs, interface avec les parties prenantes.',
      growthBonus: '+33% par rapport au Confirmé (+80% vs Junior)',
      nextLevelTarget: 'Acquérir une posture stratégique, diriger des départements ou des architectures d\'envergure.'
    },
    {
      id: 'expert',
      label: 'Expert / Lead / Manager',
      icon: '👑',
      color: '#ef4444',
      badgeClass: 'level-expert',
      experience: '8+ ans',
      multiplier: 2.40,
      role: 'Vision stratégique, leadership, innovation et gouvernance globale.',
      responsibilities: 'Définition de la stratégie, direction technique et humaine, pilotage des investissements et innovation de rupture.',
      growthBonus: '+33% par rapport au Senior (+140% vs Junior)',
      nextLevelTarget: 'Direction générale, entrepreneuriat ou conseil de haut niveau.'
    }
  ];

  // Calcul des salaires pour chaque échelon
  const levels = {};
  levelConfigs.forEach(cfg => {
    const min = Math.round(baseMin * cfg.multiplier);
    const max = Math.round(baseMax * cfg.multiplier);
    const avg = Math.round((min + max) / 2);
    
    // Découpage des compétences attendues pour ce palier
    const allSkills = [
      ...(job.competencesTechniquesSavoirFaire || job.essentialSkills || []),
      ...(job.competencesTechniquesSavoir || job.optionalSkills || []),
      ...(job.competencesComportementales || []),
      ...(job.competencesNumeriques || [])
    ].filter(Boolean);

    let prioritySkills = [];
    if (cfg.id === 'debutant') {
      prioritySkills = (job.competencesTechniquesSavoir || job.optionalSkills || allSkills).slice(0, 4);
    } else if (cfg.id === 'junior') {
      prioritySkills = (job.competencesTechniquesSavoirFaire || job.essentialSkills || allSkills).slice(0, 5);
    } else if (cfg.id === 'confirme') {
      prioritySkills = (job.competencesTechniquesSavoirFaire || allSkills).slice(2, 8);
    } else if (cfg.id === 'senior') {
      prioritySkills = [
        ...(job.competencesComportementales || ['Leadership', 'Résolution de problèmes complexes', 'Gestion d\'équipe']),
        ...(job.competencesTechniquesSavoirFaire || allSkills).slice(0, 4)
      ].slice(0, 6);
    } else {
      prioritySkills = [
        ...(job.competencesComportementales || ['Vision stratégique', 'Management', 'Négociation']),
        ...(job.competencesNumeriques || []),
        ...(job.competencesTechniquesSavoirFaire || allSkills).slice(0, 3)
      ].slice(0, 6);
    }

    levels[cfg.id] = {
      ...cfg,
      salaryMin: min,
      salaryMax: max,
      salaryAvg: avg,
      monthlyEquivalent: isEsco ? Math.round(avg / 12) : avg,
      annualEquivalent: isEsco ? avg : Math.round(avg * 12),
      prioritySkills
    };
  });

  const selected = levels[targetLevel] || levels.junior;

  // Conseil IA stratégique pour le métier
  const aiTips = [
    `Pour accélérer votre passage au niveau supérieur en tant que ${job.titre}, ciblez en priorité : ${selected.prioritySkills.slice(0, 3).join(', ') || 'les compétences de leadership et d\'autonomie'}.`,
    `Sur le marché ${isEsco ? 'européen (ESCO)' : 'tunisien (RTMC)'}, les profils justifiant d'une certification ou de réalisations concrètes négocient jusqu'à 20% au-dessus de la fourchette moyenne.`
  ];

  return {
    job: {
      code: job.code,
      titre: job.titre,
      source: isEsco ? 'esco' : 'rtmc',
      domaineGrand: job.domaineGrand,
      url: job.url
    },
    currency,
    period,
    isEsco,
    selectedLevel: selected,
    levels,
    levelList: Object.values(levels),
    aiTips
  };
}

/**
 * Recharge le cache en mémoire depuis MongoDB.
 * Appelé après chaque mutation CRUD admin pour garder le moteur RAG synchronisé.
 */
async function refreshCache() {
  try {
    await init();
  } catch (err) {
    console.warn('⚠️ refreshCache : impossible de recharger les données :', err.message);
  }
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
  analyzeTransferability,
  calculateCareerAndSalary,
  refreshCache,
};


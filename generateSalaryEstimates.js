/**
 * Générateur d'estimations salariales intelligentes pour les métiers RTMC
 * --------------------------------------------------------------------------
 * Ce script analyse chaque métier (compétences, qualifications, secteur) et
 * génère une estimation de salaire basée sur des données réelles de l'INS 2022
 * et des enquêtes salariales tunisiennes.
 *
 * SOURCES DES DONNÉES :
 * - Enquête INS 2022 "Emploi et Salaires auprès des Entreprises"
 * - Paylab.com Tunisie (enquêtes salariales par secteur)
 * - Managers.tn / La Tribune (grille des salaires par secteur)
 *
 * LANCEMENT :
 *   node generateSalaryEstimates.js
 *
 * SORTIE :
 *   data/metiers_with_salaries.json → métiers enrichis avec estimations salariales
 */

const fs = require('fs');
const path = require('path');

// ---------- CONFIGURATION ----------
const CONFIG = {
  inputFile: path.join(__dirname, 'data', 'metiers_clean.json'),
  outputFile: path.join(__dirname, 'data', 'metiers_with_salaries.json'),
  reportFile: path.join(__dirname, 'data', 'rapport_salaires.txt'),
};

// ---------- DONNÉES SALARIALES DE RÉFÉRENCE (INS 2022) ----------
// Source : Institut National de la Statistique, Enquête 2022

const SALARY_DATA = {
  // Catégories professionnelles (INS 2022)
  categories: {
    cadre: { min: 1138, max: 3258, avg: 2198 },
    intermediaire: { min: 765, max: 2304, avg: 1535 },
    employe: { min: 682, max: 1857, avg: 1270 },
    ouvrier: { min: 579, max: 1112, avg: 846 },
  },

  // Secteurs d'activité avec leurs multiplicateurs (basé sur INS 2022)
  secteurs: {
    // Secteurs les mieux rémunérés
    'finance': { multiplier: 1.35, keywords: ['banque', 'assurance', 'finance', 'crédit', 'investissement'] },
    'immobilier': { multiplier: 1.25, keywords: ['immobilier', 'patrimoine', 'foncier'] },
    'extractif': { multiplier: 1.20, keywords: ['mine', 'extraction', 'pétrole', 'gaz'] },
    'tic': { multiplier: 1.15, keywords: ['informatique', 'numérique', 'développement', 'logiciel', 'système', 'réseau', 'data', 'web', 'programmation', 'digital', 'technologie'] },
    
    // Secteurs moyennement rémunérés
    'industrie': { multiplier: 1.05, keywords: ['industrie', 'manufacture', 'production', 'fabrication', 'usine'] },
    'commerce': { multiplier: 0.95, keywords: ['commerce', 'vente', 'distribution', 'retail', 'magasin'] },
    'transport': { multiplier: 0.92, keywords: ['transport', 'logistique', 'livraison', 'chauffeur'] },
    
    // Secteurs les moins rémunérés
    'hotellerie': { multiplier: 0.88, keywords: ['hôtel', 'restauration', 'tourisme', 'cuisine', 'serveur'] },
    'construction': { multiplier: 0.85, keywords: ['construction', 'bâtiment', 'travaux', 'maçon', 'chantier'] },
    'enseignement': { multiplier: 0.82, keywords: ['enseignement', 'éducation', 'formation', 'professeur', 'formateur'] },
    'agriculture': { multiplier: 0.78, keywords: ['agricole', 'agriculture', 'élevage', 'pêche', 'rural', 'exploitation'] },
    'energie': { multiplier: 0.80, keywords: ['électricité', 'énergie', 'eau', 'distribution'] },
  },

  // Mots-clés de compétences qui augmentent le salaire
  competencesBonus: {
    management: { bonus: 200, keywords: ['management', 'gestion équipe', 'encadrement', 'supervision', 'direction', 'coordination'] },
    expertise: { bonus: 180, keywords: ['expert', 'expertise', 'spécialisé', 'conseil', 'audit'] },
    langues: { bonus: 120, keywords: ['anglais', 'français', 'allemand', 'langues étrangères', 'bilingue'] },
    numerique_avance: { bonus: 150, keywords: ['programmation', 'développement', 'data science', 'intelligence artificielle', 'machine learning', 'blockchain'] },
    certification: { bonus: 100, keywords: ['certifié', 'certification', 'agrément', 'habilitation'] },
  },

  // Niveau de formation requis
  formation: {
    doctorat: { multiplier: 1.40, keywords: ['doctorat', 'phd', 'bac+8'] },
    master: { multiplier: 1.25, keywords: ['master', 'diplôme ingénieur', 'bac+5', 'ingénieur'] },
    licence: { multiplier: 1.10, keywords: ['licence', 'bac+3', 'bachelor'] },
    bts: { multiplier: 1.00, keywords: ['bts', 'bac+2', 'technicien supérieur'] },
    bac: { multiplier: 0.90, keywords: ['bac', 'baccalauréat'] },
    cap: { multiplier: 0.85, keywords: ['cap', 'btp', 'cep', 'cfp'] },
    sans: { multiplier: 0.80, keywords: ['sans diplôme', 'expérience professionnelle'] },
  },
};

// ---------- UTILITAIRES ----------
function normalize(text = '') {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- DÉTECTION DE CATÉGORIE PROFESSIONNELLE ----------
function detectCategory(metier) {
  const text = normalize([
    metier.titre,
    metier.definition,
    metier.accesEmploi,
    ...(metier.competencesTechniquesSavoirFaire || []),
  ].join(' '));

  // Mots-clés pour identifier la catégorie
  if (/directeur|chef|manager|responsable|coordinateur|superviseur|cadre|expert/.test(text)) {
    return 'cadre';
  }
  if (/technicien|assistant|agent de maitrise|coordinateur|animateur/.test(text)) {
    return 'intermediaire';
  }
  if (/employe|secretaire|administratif|assistant|charge de/.test(text)) {
    return 'employe';
  }
  // Par défaut : ouvrier (travail manuel, exécution)
  return 'ouvrier';
}

// ---------- DÉTECTION DE SECTEUR ----------
function detectSecteur(metier) {
  const text = normalize([
    metier.titre,
    metier.domaineGrand,
    metier.domaineProfessionnel,
    metier.definition,
    ...(metier.environnementSecteurs || []),
  ].join(' '));

  let bestMatch = null;
  let maxScore = 0;

  for (const [secteur, data] of Object.entries(SALARY_DATA.secteurs)) {
    let score = 0;
    for (const keyword of data.keywords) {
      if (text.includes(normalize(keyword))) {
        score += 1;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = secteur;
    }
  }

  return bestMatch || 'industrie'; // défaut
}

// ---------- CALCUL DES BONUS DE COMPÉTENCES ----------
function calculateCompetencesBonus(metier) {
  const text = normalize([
    metier.definition,
    ...(metier.competencesTechniquesSavoirFaire || []),
    ...(metier.competencesTechniquesSavoir || []),
    ...(metier.competencesComportementales || []),
    ...(metier.competencesNumeriques || []),
  ].join(' '));

  let totalBonus = 0;
  const appliedBonuses = [];

  for (const [bonusName, bonusData] of Object.entries(SALARY_DATA.competencesBonus)) {
    for (const keyword of bonusData.keywords) {
      if (text.includes(normalize(keyword))) {
        totalBonus += bonusData.bonus;
        appliedBonuses.push(bonusName);
        break; // un seul bonus par catégorie
      }
    }
  }

  // Bonus pour nombre élevé de compétences techniques
  const nbCompetences = (metier.competencesTechniquesSavoirFaire || []).length +
                        (metier.competencesTechniquesSavoir || []).length +
                        (metier.competencesNumeriques || []).length;
  
  if (nbCompetences > 25) {
    totalBonus += 150;
    appliedBonuses.push('competences_nombreuses');
  } else if (nbCompetences > 15) {
    totalBonus += 80;
    appliedBonuses.push('competences_moyennes');
  }

  return { totalBonus, appliedBonuses };
}

// ---------- DÉTECTION NIVEAU DE FORMATION ----------
function detectFormation(metier) {
  const text = normalize(metier.accesEmploi || '');

  // Ordre d'importance (du plus élevé au moins élevé)
  for (const [niveau, data] of Object.entries(SALARY_DATA.formation)) {
    for (const keyword of data.keywords) {
      if (text.includes(normalize(keyword))) {
        return { niveau, multiplier: data.multiplier };
      }
    }
  }

  return { niveau: 'bac', multiplier: 0.90 }; // défaut
}

// ---------- ESTIMATION DU SALAIRE ----------
function estimateSalary(metier) {
  // 1. Catégorie professionnelle de base
  const category = detectCategory(metier);
  const baseSalary = SALARY_DATA.categories[category];

  // 2. Secteur d'activité (multiplicateur)
  const secteur = detectSecteur(metier);
  const secteurMultiplier = SALARY_DATA.secteurs[secteur].multiplier;

  // 3. Niveau de formation (multiplicateur)
  const formation = detectFormation(metier);

  // 4. Bonus de compétences
  const { totalBonus, appliedBonuses } = calculateCompetencesBonus(metier);

  // 5. Calcul final
  const salaryMin = Math.round((baseSalary.min * secteurMultiplier * formation.multiplier) + (totalBonus * 0.5));
  const salaryMax = Math.round((baseSalary.max * secteurMultiplier * formation.multiplier) + totalBonus);
  const salaryAvg = Math.round((salaryMin + salaryMax) / 2);

  // Assurer que min < max
  const finalMin = Math.min(salaryMin, salaryMax);
  const finalMax = Math.max(salaryMin, salaryMax);

  return {
    salaryMin: finalMin,
    salaryMax: finalMax,
    salaryAvg: salaryAvg,
    currency: 'TND',
    period: 'mensuel',
    metadata: {
      category,
      secteur,
      formationNiveau: formation.niveau,
      formationMultiplier: formation.multiplier,
      secteurMultiplier,
      totalBonus,
      appliedBonuses,
      baseSalaryRange: `${baseSalary.min}-${baseSalary.max}`,
    },
  };
}

// ---------- MAIN ----------
async function main() {
  console.log('🚀 Génération des estimations salariales...\n');

  const metiers = loadJson(CONFIG.inputFile);
  console.log(`📊 ${metiers.length} métiers à traiter.\n`);

  const statistics = {
    total: metiers.length,
    byCategory: {},
    bySecteur: {},
    avgSalaryByCategory: {},
    avgSalaryBySecteur: {},
  };

  // Enrichissement de chaque métier avec estimation salariale
  const metiersWithSalaries = metiers.map((metier, index) => {
    const salary = estimateSalary(metier);
    
    // Statistiques
    const cat = salary.metadata.category;
    const sec = salary.metadata.secteur;
    
    statistics.byCategory[cat] = (statistics.byCategory[cat] || 0) + 1;
    statistics.bySecteur[sec] = (statistics.bySecteur[sec] || 0) + 1;
    
    if (!statistics.avgSalaryByCategory[cat]) {
      statistics.avgSalaryByCategory[cat] = { sum: 0, count: 0 };
    }
    statistics.avgSalaryByCategory[cat].sum += salary.salaryAvg;
    statistics.avgSalaryByCategory[cat].count += 1;
    
    if (!statistics.avgSalaryBySecteur[sec]) {
      statistics.avgSalaryBySecteur[sec] = { sum: 0, count: 0 };
    }
    statistics.avgSalaryBySecteur[sec].sum += salary.salaryAvg;
    statistics.avgSalaryBySecteur[sec].count += 1;

    if ((index + 1) % 50 === 0) {
      console.log(`  Traité ${index + 1}/${metiers.length} métiers...`);
    }

    return {
      ...metier,
      salary,
    };
  });

  // Calcul des moyennes
  const avgByCategory = {};
  const avgBySecteur = {};
  
  for (const cat in statistics.avgSalaryByCategory) {
    const data = statistics.avgSalaryByCategory[cat];
    avgByCategory[cat] = Math.round(data.sum / data.count);
  }
  for (const sec in statistics.avgSalaryBySecteur) {
    const data = statistics.avgSalaryBySecteur[sec];
    avgBySecteur[sec] = Math.round(data.sum / data.count);
  }
  
  statistics.avgSalaryByCategory = avgByCategory;
  statistics.avgSalaryBySecteur = avgBySecteur;

  // Sauvegarde du fichier enrichi
  saveJson(CONFIG.outputFile, metiersWithSalaries);
  console.log(`\n✅ Fichier généré : ${CONFIG.outputFile}`);

  // Génération du rapport
  const report = generateReport(statistics, metiersWithSalaries);
  fs.writeFileSync(CONFIG.reportFile, report, 'utf8');
  console.log(`📄 Rapport généré : ${CONFIG.reportFile}\n`);

  console.log('📊 STATISTIQUES :');
  console.log(`\nRépartition par catégorie :`);
  for (const [cat, count] of Object.entries(statistics.byCategory)) {
    console.log(`  ${cat.padEnd(15)} : ${count.toString().padStart(3)} métiers (avg: ${statistics.avgSalaryByCategory[cat]} TND)`);
  }
  
  console.log(`\nRépartition par secteur :`);
  for (const [sec, count] of Object.entries(statistics.bySecteur)) {
    console.log(`  ${sec.padEnd(15)} : ${count.toString().padStart(3)} métiers (avg: ${statistics.avgSalaryBySecteur[sec]} TND)`);
  }

  console.log('\n✨ Terminé !');
}

function generateReport(stats, metiers) {
  let report = '═══════════════════════════════════════════════════════════════\n';
  report += '  RAPPORT D\'ESTIMATION SALARIALE - MÉTIERS RTMC\n';
  report += '═══════════════════════════════════════════════════════════════\n';
  report += `Date de génération : ${new Date().toLocaleString('fr-TN')}\n`;
  report += `Nombre total de métiers : ${stats.total}\n\n`;

  report += '───────────────────────────────────────────────────────────────\n';
  report += '1. RÉPARTITION PAR CATÉGORIE PROFESSIONNELLE\n';
  report += '───────────────────────────────────────────────────────────────\n\n';
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    const avg = stats.avgSalaryByCategory[cat];
    report += `${cat.toUpperCase().padEnd(20)} : ${count.toString().padStart(3)} métiers (${pct.padStart(5)}%)\n`;
    report += `  Salaire moyen estimé : ${avg} TND/mois\n\n`;
  }

  report += '───────────────────────────────────────────────────────────────\n';
  report += '2. RÉPARTITION PAR SECTEUR D\'ACTIVITÉ\n';
  report += '───────────────────────────────────────────────────────────────\n\n';
  
  const secteursSorted = Object.entries(stats.bySecteur).sort((a, b) => 
    stats.avgSalaryBySecteur[b[0]] - stats.avgSalaryBySecteur[a[0]]
  );
  
  for (const [sec, count] of secteursSorted) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    const avg = stats.avgSalaryBySecteur[sec];
    report += `${sec.toUpperCase().padEnd(20)} : ${count.toString().padStart(3)} métiers (${pct.padStart(5)}%)\n`;
    report += `  Salaire moyen estimé : ${avg} TND/mois\n\n`;
  }

  report += '───────────────────────────────────────────────────────────────\n';
  report += '3. TOP 10 MÉTIERS LES MIEUX RÉMUNÉRÉS\n';
  report += '───────────────────────────────────────────────────────────────\n\n';
  
  const top10 = [...metiers]
    .sort((a, b) => b.salary.salaryMax - a.salary.salaryMax)
    .slice(0, 10);
  
  top10.forEach((m, i) => {
    report += `${(i + 1).toString().padStart(2)}. ${m.titre}\n`;
    report += `    Code: ${m.code} | ${m.salary.salaryMin}-${m.salary.salaryMax} TND/mois\n`;
    report += `    Catégorie: ${m.salary.metadata.category} | Secteur: ${m.salary.metadata.secteur}\n\n`;
  });

  report += '───────────────────────────────────────────────────────────────\n';
  report += '4. MÉTHODOLOGIE\n';
  report += '───────────────────────────────────────────────────────────────\n\n';
  report += 'Les estimations salariales sont calculées selon les critères suivants :\n\n';
  report += '• Catégorie professionnelle (cadre, intermédiaire, employé, ouvrier)\n';
  report += '  basée sur les données INS 2022\n\n';
  report += '• Secteur d\'activité avec multiplicateurs spécifiques\n';
  report += '  (finance: +35%, TIC: +15%, agriculture: -22%, etc.)\n\n';
  report += '• Niveau de formation requis\n';
  report += '  (doctorat: +40%, master/ingénieur: +25%, licence: +10%, etc.)\n\n';
  report += '• Bonus de compétences spécialisées\n';
  report += '  (management: +200 TND, expertise: +180 TND, langues: +120 TND, etc.)\n\n';
  report += '• Nombre total de compétences requises\n';
  report += '  (>25 compétences: +150 TND, >15 compétences: +80 TND)\n\n';
  report += '───────────────────────────────────────────────────────────────\n';
  report += 'SOURCES : INS 2022, Paylab.com, Managers.tn, La Tribune\n';
  report += '═══════════════════════════════════════════════════════════════\n';

  return report;
}

main().catch((err) => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});

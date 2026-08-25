/**
 * Validation et nettoyage de data/metiers.json
 * ---------------------------------------------
 * Verifie la qualite des donnees scrapees avant de passer aux embeddings :
 *   - Doublons (meme code metier ou meme URL en double)
 *   - Champs vides ou manquants (titre, definition, competences...)
 *   - Genere un rapport clair + un fichier nettoye
 *
 * LANCEMENT :
 *   node checkData.js
 *
 * SORTIE :
 *   data/metiers_clean.json -> version dedupliquee et validee
 *   data/rapport_validation.txt -> rapport lisible
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'data', 'metiers.json');
const OUTPUT_CLEAN = path.join(__dirname, 'data', 'metiers_clean.json');
const OUTPUT_REPORT = path.join(__dirname, 'data', 'rapport_validation.txt');

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Fichier introuvable : ${INPUT_FILE}`);
    process.exit(1);
  }

  const metiers = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const report = [];
  const log = (line) => {
    console.log(line);
    report.push(line);
  };

  log(`=== RAPPORT DE VALIDATION - ${new Date().toISOString()} ===\n`);
  log(`Total de fiches chargees : ${metiers.length}\n`);

  const seenUrls = new Map();
  const duplicateUrls = [];
  metiers.forEach((m, idx) => {
    if (seenUrls.has(m.url)) {
      duplicateUrls.push({ url: m.url, indices: [seenUrls.get(m.url), idx] });
    } else {
      seenUrls.set(m.url, idx);
    }
  });
  log(`Doublons par URL : ${duplicateUrls.length}`);
  if (duplicateUrls.length > 0) {
    duplicateUrls.forEach((d) => log(`   - ${d.url}`));
  }

  const seenCodes = new Map();
  const duplicateCodes = [];
  metiers.forEach((m, idx) => {
    if (!m.code) return;
    if (seenCodes.has(m.code)) {
      duplicateCodes.push({ code: m.code, indices: [seenCodes.get(m.code), idx] });
    } else {
      seenCodes.set(m.code, idx);
    }
  });
  log(`Doublons par code metier : ${duplicateCodes.length}`);
  if (duplicateCodes.length > 0) {
    duplicateCodes.forEach((d) => log(`   - ${d.code}`));
  }

  const champsACles = ['code', 'titre', 'definition', 'domaineGrand'];
  const problemes = { code: 0, titre: 0, definition: 0, domaineGrand: 0 };
  const fichesProblematiques = [];

  metiers.forEach((m, idx) => {
    const manques = [];
    champsACles.forEach((champ) => {
      if (!m[champ] || (typeof m[champ] === 'string' && m[champ].trim() === '')) {
        problemes[champ]++;
        manques.push(champ);
      }
    });
    if (manques.length > 0) {
      fichesProblematiques.push({ idx, url: m.url, titre: m.titre, manques });
    }
  });

  log(`\nChamps manquants :`);
  champsACles.forEach((champ) => {
    log(`   - ${champ} : ${problemes[champ]} fiches concernees`);
  });

  if (fichesProblematiques.length > 0) {
    log(`\nDetail des fiches avec champs manquants (max 20 affichees) :`);
    fichesProblematiques.slice(0, 20).forEach((f) => {
      log(`   - [${f.idx}] ${f.titre || '(sans titre)'} -> manque : ${f.manques.join(', ')} (${f.url})`);
    });
    if (fichesProblematiques.length > 20) {
      log(`   ... et ${fichesProblematiques.length - 20} autres.`);
    }
  }

  const sansCompetences = metiers.filter(
    (m) =>
      (!m.competencesTechniquesSavoirFaire || m.competencesTechniquesSavoirFaire.length === 0) &&
      (!m.competencesTechniquesSavoir || m.competencesTechniquesSavoir.length === 0)
  );
  log(`\nFiches sans aucune competence technique : ${sansCompetences.length}`);

  const parDomaine = {};
  metiers.forEach((m) => {
    const d = m.domaine || m.domaineGrand || 'Inconnu';
    parDomaine[d] = (parDomaine[d] || 0) + 1;
  });
  log(`\nRepartition par domaine :`);
  Object.entries(parDomaine)
    .sort((a, b) => b[1] - a[1])
    .forEach(([domaine, count]) => {
      log(`   - ${domaine} : ${count} metiers`);
    });

  const cleaned = Array.from(seenUrls.entries()).map(([, idx]) => metiers[idx]);
  fs.writeFileSync(OUTPUT_CLEAN, JSON.stringify(cleaned, null, 2), 'utf-8');

  log(`\nFichier nettoye sauvegarde : ${OUTPUT_CLEAN} (${cleaned.length} fiches uniques)`);

  fs.writeFileSync(OUTPUT_REPORT, report.join('\n'), 'utf-8');
  console.log(`\nRapport complet sauvegarde : ${OUTPUT_REPORT}`);
}

main();

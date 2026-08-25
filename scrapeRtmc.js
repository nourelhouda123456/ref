/**
 * Scraper automatisé pour rtmc.emploi.nat.tn
 * ------------------------------------------
 * Parcourt automatiquement les 15 "grands domaines" du Référentiel Tunisien
 * des Métiers et des Compétences, récupère la liste des métiers de chaque
 * domaine, puis visite chaque fiche métier pour en extraire le détail complet
 * (appellations, définition, compétences techniques/comportementales/
 * linguistiques/numériques, environnement de travail, mobilité...).
 *
 * INSTALLATION (une seule fois) :
 *   npm init -y
 *   npm install playwright
 *   npx playwright install chromium
 *
 * LANCEMENT NORMAL (scraping complet, 100% automatique) :
 *   node scrapeRtmc.js
 *
 * MODES DEBUG (optionnels, pour inspecter la structure du site) :
 *   node scrapeRtmc.js debug           → dump la page résultats du domaine TIC
 *   node scrapeRtmc.js debug-job 413   → dump une fiche métier précise (id=413)
 *
 * Le script gère :
 *   - Parcours des 15 grands domaines (Agriculture, Banque, TIC, Santé...)
 *   - Rate limiting (1.5s entre requêtes, poli envers le serveur)
 *   - Reprise sur erreur (checkpoint : relance sans re-scraper ce qui est fait)
 *   - Sauvegarde incrémentale (pas de perte si ça plante en cours de route)
 *   - Dédoublonnage (un métier listé dans 2 domaines n'est scrapé qu'une fois)
 *
 * SORTIE :
 *   data/metiers.json → liste de tous les métiers avec tous leurs détails
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ---------- CONFIGURATION ----------
const CONFIG = {
  baseUrl: 'https://rtmc.emploi.nat.tn',
  searchUrl: 'https://rtmc.emploi.nat.tn/search.php',
  outputFile: path.join(__dirname, 'data', 'metiers.json'),
  checkpointFile: path.join(__dirname, 'data', 'checkpoint.json'),
  delayBetweenRequestsMs: 1500, // pause entre chaque requête (politesse + anti-blocage)
  maxRetries: 3,
  headless: true, // mets à false pour voir le navigateur en action (debug)
};

// ---------- UTILITAIRES ----------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDataDir() {
  const dir = path.dirname(CONFIG.outputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

// ---------- MODE DEBUG : recherche par domaine (fiable) + dump du HTML ----------
async function debugDumpHtml(page) {
  console.log('🐛 MODE DEBUG activé — recherche par "grand domaine".');
  console.log(`  → Chargement de ${CONFIG.searchUrl} ...`);

  await page.goto(CONFIG.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  // 1. Cocher le radio "Par grand domaine"
  console.log('  → Sélection du mode "Par grand domaine"...');
  await page.check('#domain_r');
  await sleep(500);

  // 2. Choisir le domaine "Technologies de l'Information et de la Communication-TIC" (value="15")
  console.log('  → Sélection du domaine "TIC" (value=15)...');
  await page.selectOption('#domain_search', '15');
  await sleep(500);

  // 3. Cliquer sur le vrai bouton "Rechercher..." (pas juste Entrée)
  console.log('  → Clic sur le bouton Rechercher...');
  await page.click('button.btnprimary[type="submit"]');
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await sleep(2500);

  const html = await page.content();
  const debugDir = path.join(__dirname, 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const outPath = path.join(debugDir, 'search_page.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`✅ HTML sauvegardé dans : ${outPath}`);

  // Bonus : extraire juste la zone entre les commentaires SEARCH RESULTS SECTION
  const match = html.match(/<!--SEARCH RESULTS SECTION-->([\s\S]*?)<!--SEARCH RESULTS SECTION-->/);
  if (match) {
    const resultsOnly = match[1].trim();
    const resultsPath = path.join(debugDir, 'search_results_only.html');
    fs.writeFileSync(resultsPath, resultsOnly, 'utf-8');
    console.log(`✅ Zone résultats extraite dans : ${resultsPath} (${resultsOnly.length} caractères)`);
    if (resultsOnly.length === 0) {
      console.log('⚠️ La zone résultats est vide — la recherche n\'a peut-être pas abouti.');
    }
  } else {
    console.log('⚠️ Impossible de localiser la zone "SEARCH RESULTS SECTION" dans le HTML.');
  }

  console.log('\n👉 Ouvre "debug/search_results_only.html" et colle-moi son contenu.');
}

// ---------- MODE DEBUG JOB : dumper le HTML d'une fiche métier individuelle ----------
async function debugDumpJobPage(page, jobId) {
  const url = `${CONFIG.baseUrl}/job.php?id=${jobId}`;
  console.log(`🐛 MODE DEBUG JOB — chargement de ${url} ...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const html = await page.content();
  const debugDir = path.join(__dirname, 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const outPath = path.join(debugDir, `job_${jobId}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`✅ HTML sauvegardé dans : ${outPath}`);
  console.log('👉 Ouvre ce fichier et colle-moi son contenu (ou juste la partie contenant les infos du métier).');
}

// ---------- ÉTAPE 1 : Récupérer la liste des URLs de fiches métiers ----------
// Stratégie : boucler sur les 15 "grands domaines" du référentiel, et pour
// chacun, soumettre le formulaire de recherche par domaine (pas de pagination
// observée : tous les résultats d'un domaine s'affichent en une seule page).
const DOMAINES = [
  { id: '1', label: "Agriculture et pêche" },
  { id: '2', label: "Artisanat et façonnage d'ouvrages d'art" },
  { id: '3', label: "Banque et assurance" },
  { id: '4', label: "Commerce, vente et grande distribution" },
  { id: '5', label: "Communication, média et multimédia" },
  { id: '6', label: "Construction, bâtiment et travaux publiques" },
  { id: '7', label: "Hôtellerie, restauration et tourisme" },
  { id: '8', label: "Industrie" },
  { id: '9', label: "Installation et maintenance" },
  { id: '10', label: "Santé" },
  { id: '11', label: "Service à la personne et à la société" },
  { id: '12', label: "Arts et Spectacle" },
  { id: '13', label: "Support à l'entreprise" },
  { id: '14', label: "Transport et logistique" },
  { id: '15', label: "Technologies de l'Information et de la Communication-TIC" },
];

async function searchByDomain(page, domainId) {
  await page.goto(CONFIG.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);

  await page.check('#domain_r');
  await sleep(300);
  await page.selectOption('#domain_search', domainId);
  await sleep(300);
  await page.click('button.btnprimary[type="submit"]');
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await sleep(1500);

  // Chaque résultat : <a href="job.php?id=413" ...><strong>T1101</strong> | <span>Titre</span></a>
  const results = await page.$$eval('#search-results a[href*="job.php?id="]', (anchors) =>
    anchors.map((a) => {
      const href = a.getAttribute('href');
      const codeEl = a.querySelector('strong');
      const titleEl = a.querySelector('span.defaultcolor');
      return {
        href,
        code: codeEl ? codeEl.textContent.trim() : null,
        titre: titleEl ? titleEl.textContent.trim() : null,
      };
    })
  );

  return results;
}

async function collectAllMetierLinks(page) {
  const allResults = [];

  console.log('🔍 Collecte des métiers par grand domaine (15 domaines)...');

  for (const domaine of DOMAINES) {
    console.log(`  → Domaine ${domaine.id}: ${domaine.label}`);
    try {
      const results = await searchByDomain(page, domaine.id);
      results.forEach((r) => {
        allResults.push({
          ...r,
          url: `${CONFIG.baseUrl}/${r.href}`,
          domaine: domaine.label,
          domaineId: domaine.id,
        });
      });
      console.log(`     ${results.length} métiers trouvés.`);
    } catch (err) {
      console.error(`     ⚠️ Erreur sur le domaine ${domaine.id}:`, err.message);
    }
    await sleep(CONFIG.delayBetweenRequestsMs);
  }

  // Dédoublonnage par URL (un métier pourrait apparaître dans 2 domaines)
  const seen = new Set();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`✅ ${deduped.length} liens de fiches métiers trouvés (${allResults.length} avant dédoublonnage).`);
  return deduped;
}

// ---------- ÉTAPE 2 : Extraire les données d'une fiche métier ----------
async function scrapeMetierFiche(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);

  const data = await page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

    // Code (ex: "T1101") et titre (ex: "Développeur informatique")
    const code = clean(document.querySelector('.heading-title span.defaultcolor')?.textContent) || null;
    const titre = clean(document.querySelector('.heading-title h3.orange')?.textContent) || null;

    // Paragraphe d'intro : "appartient au grand domaine X, domaine professionnel Y"
    const introP = document.querySelector('p.bottom10.text-justify');
    let domaineGrand = null;
    let domaineProfessionnel = null;
    if (introP) {
      const strongs = introP.querySelectorAll('strong');
      domaineGrand = strongs[0] ? clean(strongs[0].textContent) : null;
      domaineProfessionnel = strongs[1] ? clean(strongs[1].textContent) : null;
    }

    // Résumé (le <p class="text-justify"> juste après l'intro)
    const resumeEl = introP?.nextElementSibling;
    const resume = resumeEl && resumeEl.tagName === 'P' ? clean(resumeEl.textContent) : null;

    // Sections type "h3.orange" suivi d'un ou plusieurs div.defaultcolor consécutifs
    // (Appellations, Définition, Accès à l'emploi métier, Habilitations...)
    const sections = {};
    document.querySelectorAll('h3.orange').forEach((h3) => {
      const label = clean(h3.textContent);
      let el = h3.nextElementSibling;
      const texts = [];
      while (el && el.classList && el.classList.contains('defaultcolor')) {
        texts.push(clean(el.textContent));
        el = el.nextElementSibling;
      }
      if (texts.length) sections[label] = texts;
    });

    // Accordéons : Compétences Techniques (Savoir Faire / Savoir), Comportementales (Savoir Être),
    // Linguistiques (niveaux), Numériques, Environnements (Structures/Secteurs/Conditions), Mobilité
    const accordions = {};
    document.querySelectorAll('.card-header a.card-link').forEach((link) => {
      const label = clean(link.textContent);
      const targetId = link.getAttribute('href')?.replace('#', '');
      const body = targetId ? document.getElementById(targetId) : null;
      const items = body
        ? Array.from(body.querySelectorAll('.card-body span.defaultcolor')).map((s) => clean(s.textContent))
        : [];
      if (items.length) accordions[label] = items;
    });

    return {
      code,
      titre,
      domaineGrand,
      domaineProfessionnel,
      resume,
      appellations: sections['Appellations'] || [],
      definition: sections['Définition']?.[0] || null,
      accesEmploi: sections["Accès à l'emploi métier"]?.[0] || null,
      habilitations: sections['Habilitations'] || [],
      competencesTechniquesSavoirFaire: accordions['Savoir Faire'] || [],
      competencesTechniquesSavoir: accordions['Savoir'] || [],
      competencesComportementales: accordions['Savoir Etre'] || [],
      languesBasique: accordions['Niveau Basique'] || [],
      languesIntermediaire: accordions['Niveau Intermédiaire'] || [],
      languesAvance: accordions['Niveau Avancé'] || [],
      competencesNumeriques: accordions['Numériques'] || [],
      environnementStructures: accordions['Structures'] || [],
      environnementSecteurs: accordions['Secteurs'] || [],
      environnementConditions: accordions['Conditions'] || [],
      fichesProches: accordions['Fiches Proches'] || [],
      fichesEvolution: accordions['Fiches envisageables si évolution'] || [],
    };
  });

  data.url = url;
  data.scrapedAt = new Date().toISOString();
  return data;
}

// ---------- ÉTAPE 3 : Orchestration avec reprise sur erreur ----------
async function main() {
  ensureDataDir();

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // 🐛 MODE DEBUG : lance "node scrapeRtmc.js debug" pour juste dumper le HTML
    // et arrêter là, sans essayer de scraper (utile pour inspecter la structure)
    if (process.argv.includes('debug')) {
      await debugDumpHtml(page);
      return;
    }

    if (process.argv.includes('debug-job')) {
      const jobIdIndex = process.argv.indexOf('debug-job') + 1;
      const jobId = process.argv[jobIdIndex] || '413';
      await debugDumpJobPage(page, jobId);
      return;
    }

    // Charger ou créer la liste de liens
    let checkpoint = loadJson(CONFIG.checkpointFile, { links: null, scraped: [] });

    if (!checkpoint.links || checkpoint.links.length === 0) {
      checkpoint.links = await collectAllMetierLinks(page);
      saveJson(CONFIG.checkpointFile, checkpoint);
    } else {
      console.log(`↻ Reprise : ${checkpoint.links.length} liens déjà collectés.`);
    }

    const results = loadJson(CONFIG.outputFile, []);
    const alreadyScraped = new Set(checkpoint.scraped);

    const remainingLinks = checkpoint.links.filter((link) => !alreadyScraped.has(link.url));
    console.log(`📋 ${remainingLinks.length} fiches restantes à scraper.`);

    for (let i = 0; i < remainingLinks.length; i++) {
      const linkInfo = remainingLinks[i];
      const url = linkInfo.url;
      let attempt = 0;
      let success = false;

      while (attempt < CONFIG.maxRetries && !success) {
        try {
          attempt++;
          console.log(`  [${i + 1}/${remainingLinks.length}] Scraping: ${url} (essai ${attempt})`);
          const data = await scrapeMetierFiche(page, url);
          // Fusionne les infos déjà connues (code, titre, domaine) avec les détails de la fiche
          results.push({ ...linkInfo, ...data });
          checkpoint.scraped.push(url);
          success = true;

          // Sauvegarde incrémentale toutes les 10 fiches
          if (results.length % 10 === 0) {
            saveJson(CONFIG.outputFile, results);
            saveJson(CONFIG.checkpointFile, checkpoint);
            console.log(`  💾 Sauvegarde intermédiaire (${results.length} fiches).`);
          }
        } catch (err) {
          console.error(`  ⚠️ Erreur sur ${url} (essai ${attempt}):`, err.message);
          await sleep(2000);
        }
      }

      if (!success) {
        console.error(`  ❌ Échec définitif pour ${url}, on passe à la suite.`);
      }

      await sleep(CONFIG.delayBetweenRequestsMs);
    }

    // Sauvegarde finale
    saveJson(CONFIG.outputFile, results);
    saveJson(CONFIG.checkpointFile, checkpoint);

    console.log(`\n✅ Terminé ! ${results.length} fiches métiers sauvegardées dans ${CONFIG.outputFile}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
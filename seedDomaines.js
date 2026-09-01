/**
 * Seed des domaines — extrait les domaines uniques depuis les collections
 * MongoDB (metiers + esco) et les insère dans la collection "domaines".
 * Idempotent : n'insère pas les doublons.
 *
 * Usage : npm run seed:domaines
 */
require('dotenv').config();
const { connectDB, getMetiersCollection, getEscoCollection, getDomainesCollection, closeDB } = require('./db');

// Couleurs par défaut par domaine (optionnel, sinon couleur générique)
const COULEURS = {
  'Agriculture et pêche':                         '#4caf50',
  'Artisanat et façonnage d\'ouvrages d\'art':    '#795548',
  'Arts et Spectacle':                            '#e91e63',
  'Banque et assurance':                          '#1565c0',
  'Commerce, vente et grande distribution':       '#ff9800',
  'Communication, média et multimédia':           '#9c27b0',
  'Construction, bâtiment et travaux publics':    '#f44336',
  'Hôtellerie, restauration et tourisme':         '#00bcd4',
  'Industrie':                                    '#607d8b',
  'Informatique et numérique':                    '#2196f3',
  'Installation et maintenance':                  '#ff5722',
  'Santé':                                        '#4caf50',
  'Services à la personne et à la société':       '#009688',
  'Support à l\'entreprise':                      '#3f51b5',
  'Transport et logistique':                      '#ff9800',
  'Technologies de l\'information':               '#2196f3',
};

async function seedDomaines() {
  console.log('🌱 Seed domaines en cours...');

  await connectDB();

  const rtmcCol     = getMetiersCollection();
  const escoCol     = getEscoCollection();
  const domainesCol = getDomainesCollection();

  // Récupérer tous les domaines distincts depuis les deux collections
  const [rtmcDomaines, escoDomaines] = await Promise.all([
    rtmcCol.distinct('domaineGrand'),
    escoCol.distinct('domaineGrand'),
  ]);

  const allDomaines = [...new Set([...rtmcDomaines, ...escoDomaines])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));

  console.log(`📋 ${allDomaines.length} domaines uniques trouvés.`);

  let inserted = 0;
  let skipped  = 0;

  for (const nom of allDomaines) {
    const existing = await domainesCol.findOne({
      nom: { $regex: `^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await domainesCol.insertOne({
      nom,
      description: '',
      couleur:     COULEURS[nom] || '#477CA8',
      active:      true,
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });
    inserted++;
    console.log(`  ✅ Inséré : ${nom}`);
  }

  // Créer un index unique sur le nom pour éviter les doublons futurs
  await domainesCol.createIndex({ nom: 1 }, { unique: true, collation: { locale: 'fr', strength: 2 } });

  console.log(`\n📊 Résultat : ${inserted} insérés, ${skipped} déjà existants.`);
  await closeDB();
  console.log('🌱 Seed domaines terminé.');
}

seedDomaines().catch((err) => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});

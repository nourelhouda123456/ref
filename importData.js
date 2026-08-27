/**
 * Script d'import : charge les fichiers JSON dans MongoDB.
 * Usage : node importData.js
 * À exécuter une seule fois (ou pour réinitialiser les données).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, getMetiersCollection, getEmbeddingsCollection, closeDB } = require('./db');

const DATA_DIR = path.join(__dirname, 'data');
const METIERS_FILE = path.join(DATA_DIR, 'metiers_with_salaries.json');
const EMBEDDINGS_FILE = path.join(DATA_DIR, 'metiers_embeddings.json');

async function importData() {
  await connectDB();

  // --- Import des métiers ---
  const metiersCol = getMetiersCollection();
  const metiers = JSON.parse(fs.readFileSync(METIERS_FILE, 'utf8'));
  console.log(`📂 ${metiers.length} fiches métiers lues depuis ${path.basename(METIERS_FILE)}`);

  // Supprimer les anciennes données et insérer les nouvelles
  await metiersCol.deleteMany({});
  const metiersResult = await metiersCol.insertMany(metiers);
  console.log(`✅ ${metiersResult.insertedCount} fiches métiers importées dans la collection "metiers"`);

  // Supprimer les anciens index et en créer de nouveaux
  await metiersCol.dropIndexes();
  await metiersCol.createIndex({ code: 1 }, { unique: true });
  await metiersCol.createIndex({ url: 1 }, { unique: true });
  await metiersCol.createIndex({ titre: 'text', resume: 'text', definition: 'text' });
  console.log('📇 Index créés sur metiers (code, url, text)');

  // --- Import des embeddings (RTMC + ESCO) ---
  const embeddingsCol = getEmbeddingsCollection();
  await embeddingsCol.deleteMany({});
  
  let allEmbeddings = [];
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    const rtmcEmb = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, 'utf8')).map(e => ({ ...e, source: 'rtmc' }));
    allEmbeddings.push(...rtmcEmb);
    console.log(`📂 ${rtmcEmb.length} embeddings RTMC lus depuis ${path.basename(EMBEDDINGS_FILE)}`);
  }

  const ESCO_EMBEDDINGS_FILE = path.join(DATA_DIR, 'esco_embeddings.json');
  if (fs.existsSync(ESCO_EMBEDDINGS_FILE)) {
    const escoEmb = JSON.parse(fs.readFileSync(ESCO_EMBEDDINGS_FILE, 'utf8')).map(e => ({ ...e, source: 'esco' }));
    allEmbeddings.push(...escoEmb);
    console.log(`📂 ${escoEmb.length} embeddings ESCO lus depuis ${path.basename(ESCO_EMBEDDINGS_FILE)}`);
  }

  if (allEmbeddings.length > 0) {
    const embResult = await embeddingsCol.insertMany(allEmbeddings);
    console.log(`✅ ${embResult.insertedCount} embeddings au total importés dans la collection "embeddings"`);
    await embeddingsCol.dropIndexes().catch(() => {});
    await embeddingsCol.createIndex({ url: 1 }, { unique: true });
    console.log('📇 Index créé sur embeddings (url)');
  } else {
    console.log('⚠️  Aucun fichier d\'embeddings trouvé.');
  }

  // --- Import ESCO ---
  const ESCO_FILE = path.join(DATA_DIR, 'esco_occupations.json');
  if (fs.existsSync(ESCO_FILE)) {
    const { getEscoCollection } = require('./db');
    const escoCol = getEscoCollection();
    const escoData = JSON.parse(fs.readFileSync(ESCO_FILE, 'utf8'));
    console.log(`📂 ${escoData.length} fiches ESCO lues depuis ${path.basename(ESCO_FILE)}`);

    await escoCol.deleteMany({});
    if (escoData.length > 0) {
      const escoResult = await escoCol.insertMany(escoData);
      console.log(`✅ ${escoResult.insertedCount} fiches ESCO importées dans la collection "esco"`);

      await escoCol.dropIndexes().catch(() => {});
      await escoCol.createIndex({ uri: 1 }, { unique: true });
      await escoCol.createIndex({ code: 1 });
      await escoCol.createIndex({ titre: 'text', resume: 'text' });
      console.log('📇 Index créés sur esco (uri, code, text)');
    }
  } else {
    console.log('⚠️  Fichier esco_occupations.json non trouvé (optionnel).');
  }

  await closeDB();
  console.log('\n🎉 Import terminé avec succès !');
}

importData().catch((err) => {
  console.error('❌ Erreur lors de l\'import :', err.message);
  process.exit(1);
});

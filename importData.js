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

  // --- Import des embeddings ---
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    const embeddingsCol = getEmbeddingsCollection();
    const embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, 'utf8'));
    console.log(`📂 ${embeddings.length} embeddings lus depuis ${path.basename(EMBEDDINGS_FILE)}`);

    await embeddingsCol.deleteMany({});
    const embResult = await embeddingsCol.insertMany(embeddings);
    console.log(`✅ ${embResult.insertedCount} embeddings importés dans la collection "embeddings"`);

    await embeddingsCol.createIndex({ url: 1 }, { unique: true });
    console.log('📇 Index créé sur embeddings (url)');
  } else {
    console.log('⚠️  Fichier embeddings non trouvé, collection embeddings ignorée.');
  }

  await closeDB();
  console.log('\n🎉 Import terminé avec succès !');
}

importData().catch((err) => {
  console.error('❌ Erreur lors de l\'import :', err.message);
  process.exit(1);
});

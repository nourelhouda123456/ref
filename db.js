const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'rtmc';

let client, db;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✅ Connecté à MongoDB (${DB_NAME})`);
  return db;
}

function getMetiersCollection() {
  return db.collection('metiers');
}

function getEmbeddingsCollection() {
  return db.collection('embeddings');
}

async function closeDB() {
  if (client) await client.close();
}

module.exports = { connectDB, getMetiersCollection, getEmbeddingsCollection, closeDB };

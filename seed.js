/**
 * Seed script — crée le compte administrateur dans MongoDB.
 * Usage : npm run seed
 *
 * Idempotent : utilise un upsert sur l'email pour éviter les doublons.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB, closeDB } = require('./db');

const ADMIN_EMAIL    = 'admin@gmail.com';
const ADMIN_PASSWORD = 'password123';
const ADMIN_ROLE     = 'ADMIN';
const SALT_ROUNDS    = 12;

async function seed() {
  console.log('🌱 Démarrage du seed...');

  let db;
  try {
    db = await connectDB();
  } catch (err) {
    console.error('❌ Impossible de se connecter à MongoDB :', err.message);
    process.exit(1);
  }

  const users = db.collection('users');

  // Vérifier si le compte existe déjà
  const existing = await users.findOne({ email: ADMIN_EMAIL });

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

  if (existing) {
    // Mise à jour du mot de passe et du rôle sans changer l'_id
    await users.updateOne(
      { email: ADMIN_EMAIL },
      {
        $set: {
          password: hashedPassword,
          role: ADMIN_ROLE,
          updatedAt: new Date(),
        },
      }
    );
    console.log(`✅ Compte admin mis à jour (email : ${ADMIN_EMAIL})`);
  } else {
    await users.insertOne({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: ADMIN_ROLE,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Compte admin créé (email : ${ADMIN_EMAIL})`);
  }

  await closeDB();
  console.log('🌱 Seed terminé avec succès.');
}

seed().catch((err) => {
  console.error('❌ Erreur seed :', err.message);
  process.exit(1);
});

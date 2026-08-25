# Assistant intelligent RTMC

Ce projet contient 530 fiches métiers récupérées depuis le Référentiel tunisien des métiers et des compétences (RTMC). L'assistant utilise un RAG : il cherche d'abord les fiches pertinentes, puis répond à partir de leurs données. Chaque réponse et recommandation contient le **code du métier** et l'**URL RTMC** de sa source.

## Démarrer l'API

```powershell
$env:VOYAGE_API_KEY = "votre_cle" # optionnel mais recommandé pour la recherche sémantique
node server.js
```

Sans clé Voyage AI, l'API fonctionne en recherche lexicale. Avec la clé déjà utilisée pour `data/metiers_embeddings.json`, elle crée l'embedding de la question/CV et effectue une recherche sémantique sur les 530 fiches.

## Endpoints

```powershell
Invoke-RestMethod http://localhost:3000/api/chat -Method POST -ContentType 'application/json' -Body '{"question":"Quelles compétences faut-il pour devenir développeur informatique ?"}'

Invoke-RestMethod http://localhost:3000/api/recommendations -Method POST -ContentType 'application/json' -Body '{"cvText":"Licence informatique. JavaScript, Python, SQL, développement web.", "limit":5}'
```

`/api/recommendations` doit être appelé dès que le texte du CV est extrait à l'inscription : il renvoie des suggestions immédiates, leur score, une justification et la référence RTMC. Ne conservez le CV qu'avec le consentement de la personne et protégez-le comme donnée personnelle.

## Important : métiers ≠ offres d'emploi

La source RTMC fournit les référentiels de métiers, pas des offres en cours. Pour suggérer des offres, ajoutez un second collecteur autorisé (API/flux officiel d'un site d'emploi) qui normalise chaque offre puis applique le même classement CV↔offre. Gardez toujours la source, l'URL et la date de collecte de l'offre.

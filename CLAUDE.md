# Projet maroubra (`app-maroubra`)

Écran ambiant de la famille sur la mer, le ciel, la plage et la météo de Maroubra, en anglais, pour ordinateur, tablette et téléphone.
Hébergé sur le socle kiwi-apps : Container App `maroubra` dans `cae-kiwi-apps`, servie sur `https://maroubra.apps.akakiwi.com`.

Pour créer, déployer, faire évoluer ou supprimer ce projet, utiliser la skill `/kiwi-apps`. La convention est dans `docs/projet.md` du dépôt `Leumas09/platform`. Le déploiement pas à pas est dans `docs/DEPLOY.md`, le plan et l'état du projet dans `docs/PLAN.md`.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/hub` | serveur Node (Hono) : mot de passe familial, flux temps réel, collecteurs, calculs dérivés, notifications |
| `apps/web` | app React (PWA), servie par le hub |
| `packages/sky` | éphémérides locales, vérifiées contre Skyfield + JPL DE421 |
| `packages/core` | formats partagés hub et app |
| `bench` | banc de vérification Python (modèles contre observations, marée harmonique) |
| `infra` | Bicep du projet |

Commandes : `npm test` (tous les tests), `apps/hub/scripts/demo.sh start` (hubs de démonstration hors ligne sur 8100 et 8101), `node apps/web/e2e/views.cjs <dossier>` (captures de toutes les vues).

## Règles

- Secrets acceptés par Samuel : mot de passe familial, clé de session, clé privée VAPID, uniquement comme secrets de la Container App. Jamais dans le dépôt, ni dans les tests (mot de passe de test : `test-family-password`).
- Tout en Bicep (`infra/`). Pour chaque déploiement d'infra (Bicep) : build, what-if, résumé en français, puis OK de Samuel avant d'appliquer.
- Tag `project=maroubra` sur chaque ressource, dans `rg-app-maroubra`. Ne jamais modifier le socle `rg-kiwi-apps`.
- Chaque prévision affichée a un juge extérieur (observation, référence indépendante) ; un objectif manqué reste visible dans le Track record.
- Interface en anglais ; documentation et code commentés en français, sans tiret cadratin.
- Numéro de version (demandé par Samuel le 22 novembre 2026) : un seul numéro `MAJEUR.MINEUR.CORRECTIF`, dans le `package.json` racine.
  - Affiché en bas de Settings (« Maroubra version 1.1.0 ») et dans `/health` (`release`, à côté du commit dans `version`).
  - Chaque PR vers `main` l'incrémente, puisque chaque fusion part en production : `npm version minor --no-git-tag-version` pour une fonctionnalité, `patch` pour une correction ou de la documentation, `major` seulement sur décision de Samuel.
  - La CI refuse une PR dont la version n'est pas supérieure à celle de `main`. Deux PR en parallèle : fusionner `main` dans la branche, puis réincrémenter.
  - Dans le résumé à Samuel, donner le numéro mis en production.
- Autonomie jusqu'à la production : Samuel donne les fonctionnalités, Claude fait tout le reste sans attendre de feu vert, du code à la mise en production.
  - Pull request : ouverte dès qu'un lot est terminé, testé et poussé.
  - Suivi : abonnement d'office à chaque PR ouverte (checks, relectures, commentaires) et correction de ce qui en ressort.
  - Fusion : dès que la CI est verte et qu'il n'y a ni conflit ni relecture bloquante, fusion dans `main` (commit de fusion).
  - Mise en production : la fusion déclenche le workflow `deploy` ; suivre le run jusqu'au bout, vérifier la version servie, corriger et refusionner si le déploiement échoue.
  - Seule exception : un changement d'infra (Bicep) garde la règle du what-if, du résumé en français et de l'OK de Samuel avant d'appliquer.
  - Rappelé par Samuel le 22 novembre 2026 : sans changement d'infra, ouvrir la PR, la fusionner et mettre en production se font sans lui demander son accord.

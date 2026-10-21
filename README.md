# Moitié-Moitié

PWA mobile pour un couple : tâches de la maison (chacun son tour), courses, garde-manger, rappels et notes, partagés en temps réel. Tout est en français, au tutoiement.

Stack : React 18 + Vite + TypeScript, Supabase (auth par lien magique, Postgres, Realtime, RLS), `vite-plugin-pwa`.

## Mise en route

1. **Créer un projet Supabase** (supabase.com → New project).
2. **SQL Editor** → coller et exécuter `supabase/migrations/0001_schema.sql` (tables, RLS, fonctions, temps réel).
3. **Authentication → URL Configuration** : mettre l'URL du site dans *Site URL* et l'ajouter (plus `http://localhost:5173`) aux *Redirect URLs*.
4. Optionnel : **Authentication → Email Templates** pour traduire l'e-mail du lien magique en français.
5. Copier `.env.example` en `.env` avec l'URL du projet et la clé `anon` (Settings → API).
6. `npm install` puis `npm run dev`.

## Déploiement

`npm run build` produit `dist/` (site statique, une seule page). Cloudflare Pages, Netlify ou Vercel : commande `npm run build`, dossier `dist`, variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.

Sur iPhone : Safari → Partager → « Sur l'écran d'accueil ». Sur Android : menu → « Installer l'application ».

## Comment ça marche

- **Foyer** : la première personne crée le foyer (`create_household`), ce qui génère un code de 6 caractères et trois listes (Supermarché, Pharmacie, Pour la maison). L'autre ouvre le lien `/?invite=CODE`, se connecte et rejoint (`join_household`). Deux membres maximum, couleurs **rose** et **bordeaux**.
- **Sécurité** : RLS sur toutes les tables, chacun ne lit et n'écrit que les données de son foyer (`is_member`). Création et adhésion passent uniquement par des fonctions `security definer`.
- **Temps réel** : une chaîne Supabase Realtime par foyer ; chaque insertion, modification ou suppression est appliquée tout de suite chez l'autre. Au retour sur l'app ou du réseau, tout est rechargé.
- **Tâches** : `tasks` décrit la règle (fréquence, jours, fixe / chacun son tour / ensemble). Les `task_occurrences` des 3 prochaines semaines sont générées par l'app (contrainte unique `task_id + date`, donc pas de doublons si les deux téléphones le font en même temps). Modifier une tâche recalcule les occurrences futures non faites. On peut échanger une occurrence avec l'autre.
- **Garde-manger** : chaque produit a une durée en jours et une date de dernier achat. Quand il reste ≤ 2 jours (ou 20 % de la durée), il s'ajoute automatiquement à la liste Supermarché (`is_automatic`). Cocher l'article remet le compteur à zéro.
- **Rappels** : une fois / tous les mois / tous les ans, préavis en jours, pour l'un ou les deux.
- **Notifications** : locales, tant que l'app est ouverte ou récemment utilisée (heure de rappel des tâches, échéance et préavis des rappels).

Le schéma garde des noms de colonnes en anglais ; tout ce qui est visible est en français. `task_occurrences` et `shopping_items` ont aussi un `household_id` (pour la RLS et le filtre temps réel).

## Tests

`npm test` : tests des règles de calendrier (fréquences, rotation, rappels, garde-manger).

## Aller plus loin

- **Push avec l'app fermée** : Web Push (clés VAPID) + une Edge Function Supabase planifiée (pg_cron) qui envoie les notifications.
- Génération des occurrences côté serveur (pg_cron) si l'app reste longtemps sans être ouverte.

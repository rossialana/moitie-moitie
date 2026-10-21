# Moitié-Moitié

PWA mobile pour un couple : tâches de la maison (chacun son tour), courses, garde-manger, rappels et notes, partagés en temps réel. Interface en français, au tutoiement.

**Stack** : Next.js 15 (App Router) + TypeScript + Tailwind CSS 4, Supabase (lien magique, Postgres, Realtime, RLS), Web Push (`web-push` + pg_cron).

## Écrans (barre du bas, 5 onglets)

| Onglet | Contenu |
|---|---|
| Aujourd'hui | Date, équilibre de la semaine (« Nicki · 11 / Ari · 10 »), tâches du jour avec case à cocher et initiale, carte « Bientôt fini ». Roue crantée : foyer, invitation, notifications. |
| Tâches | Liste groupée par fréquence, filtres Toutes / Les miennes / Celles de l'autre / Tour à tour, étiquette TOUR À TOUR, bouton +. Panneau « Nouvelle tâche » : nom, qui (personne 1 / personne 2 / Alterner / Ensemble), fréquence, jours, aperçu des 4 prochains tours, rappel avec interrupteur. |
| Courses | Onglets par liste, cartes « Bientôt fini » (AUTO), articles groupés par rayon et barrés une fois achetés, champ d'ajout, garde-manger. |
| Semaine | Grille du lundi au dimanche, pastilles de couleur par personne, carte de suggestion. Toucher une pastille : cocher, ou donner ce tour à l'autre. |
| Rappels | Prochain rappel mis en avant, liste avec grande date, « Notes de la maison » (wifi, mesures, téléphones). |

## Logique

- **Rotation** : l'app (et le serveur toutes les 5 min) génère les occurrences des 4 prochaines semaines. En « Alterner », chaque tour suit la personne du tour précédent : si quelqu'un donne son tour, la suite se réorganise à partir de là.
- **Équilibre** : nombre de tâches attribuées à chacun sur la semaine (les tâches « Ensemble » comptent pour les deux), en barre partagée.
- **Suggestions** : si quelqu'un a, un jour, au moins 2 tâches de plus que sa moyenne de la semaine et un autre jour sans rien, l'app propose « On passe « Repasser » à vendredi ? » avec « Oui, déplacer » / « Laisser comme ça » (le refus est partagé entre les deux).
- **Garde-manger** : à 20 % de sa durée, un produit passe dans « Bientôt fini » et s'ajoute seul à la liste Supermarché avec l'étiquette AUTO. Le cocher remet le compteur à zéro.
- **Notifications push** : récapitulatif à 8 h, rappel à l'heure de chaque tâche, préavis et échéance des rappels. Envoyées par `/api/push/send`, appelée toutes les 5 minutes par pg_cron.

## Mise en route

### 1. Supabase
1. Créer un projet (supabase.com → New project). « Automatically expose new tables » peut rester décoché : le SQL donne lui-même les droits.
2. **SQL Editor → New query** : exécuter `supabase/migrations/0001_schema.sql`, puis `supabase/migrations/0002_semaine_push_demo.sql`.
3. **Project Settings → API Keys** : copier la *publishable key* (`sb_publishable_…`) et la *secret key* (`sb_secret_…`, serveur uniquement).

### 2. Clés de notification
```bash
npx web-push generate-vapid-keys   # donne une clé publique et une clé privée
openssl rand -hex 32               # CRON_SECRET
```

### 3. Variables d'environnement

| Variable | Où | Valeur |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | `https://<projet>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | `sb_publishable_…` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | clé VAPID publique |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | `sb_secret_…` |
| `VAPID_PRIVATE_KEY` | **secret** | clé VAPID privée |
| `VAPID_SUBJECT` | serveur | `mailto:ton@email.fr` |
| `CRON_SECRET` | **secret** | la valeur générée |

Les anciens noms `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont aussi acceptés. En local : copier `.env.example` en `.env.local`, puis `npm install && npm run dev`.

### 4. Publier sur Vercel
1. vercel.com → **Add New → Project** → importer le dépôt `moitie-moitie` (Next.js est détecté).
2. Ajouter les variables ci-dessus, puis **Deploy**.
3. Netlify marche aussi tel quel (`netlify.toml` fourni) : importer le dépôt et ajouter les mêmes variables.

### 5. Après le premier déploiement
1. Supabase → **Authentication → URL Configuration** : *Site URL* = l'adresse du site ; *Redirect URLs* : ajouter `https://<site>/**`.
2. **SQL Editor** : ouvrir `supabase/cron.sql`, remplacer `https://TON-SITE` et `REMPLACER_PAR_CRON_SECRET`, exécuter. (Le cron de Vercel en offre gratuite ne passe qu'une fois par jour, d'où pg_cron.)
3. Optionnel : **Authentication → Email Templates** pour traduire l'e-mail du lien magique.

Sur iPhone, les notifications ne marchent que si l'app est ajoutée à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil », iOS 16.4+), puis activées dans le Foyer (roue crantée).

## Données d'exemple (deux personnes)

1. Les deux personnes se connectent une fois sur le site avec leur e-mail (inutile de créer un foyer).
2. SQL Editor :
   ```sql
   select public.seed_demo('email.de.nicki@exemple.fr', 'email.de.ari@exemple.fr');
   ```
3. Recharger l'app : foyer « Chez Nicki et Ari » avec 11 tâches (dont une journée chargée demain, pour voir une suggestion), 3 listes de courses, 5 produits au garde-manger, 4 rappels et 3 notes. Relancer la fonction remet les données à zéro.

## Sécurité

- RLS sur toutes les tables : chacun ne lit et n'écrit que son foyer (`is_member`). Création et adhésion au foyer passent par des fonctions `security definer` (2 personnes maximum).
- Abonnements push : chacun ne voit que ses appareils. `push_log` n'est accessible qu'au serveur.
- La clé secrète Supabase ne sert que dans `/api/push/send`, protégée par `CRON_SECRET`.

## Développement

- `npm run dev` · `npm run build` · `npm run typecheck`
- `npm test` : calendrier, rotation qui se réorganise, équilibre, suggestions, garde-manger.
- Structure : `app/` (layout, manifeste, API push), `components/` (App, store temps réel, écrans), `lib/` (logique pure, partagée client/serveur), `public/sw.js` (service worker), `supabase/` (SQL).

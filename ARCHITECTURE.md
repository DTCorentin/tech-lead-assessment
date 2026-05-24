Q3 — Architecture d'un portail unifié

1. Contexte

L'entreprise dispose de 4 applications métiers indépendantes (RH, CRM, Finance, Projets) et souhaite les fédérer sous un dashboard unifié avec un accès unique (SSO).


2. Vision globale

┌─────────────────────────────────────────────────────────────────┐
│                        Utilisateur final                         │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                    ┌────────▼────────┐
                    │   Dashboard     │  React + Vite (TSX)
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │       API Gateway           │  Auth · Rate limit · Logs
              └──┬──────┬──────┬──────┬─────┘
                 │      │      │      │
            ┌───▼──┐ ┌──▼──┐ ┌▼───┐ ┌▼──────┐
            │  RH  │ │ CRM │ │Fin.│ │Projets│  Apps indépendantes
            └──────┘ └─────┘ └────┘ └───────┘  (iframes)
                             │
              ┌──────────────▼──────────────┐
              │          Keycloak           │  SSO · RBAC · JWT · OIDC
              └─────────────────────────────┘


3. Stack Frontend — Dashboard

| Couche | Technologie |
|---|---|
| Framework UI | React 18 + TypeScript |
| Build | Vite |
| Routing | React Router v6 |
| UI | shadcn/ui + Tailwind CSS |
| HTTP | Axios + React Query |
| Tests | Vitest + Testing Library |
| Prod | Nginx |


4. SSO — Keycloak

- Open source, self-hosted — pas de dépendance SaaS, données internes non exposées
- OIDC + OAuth 2.0 — standard ouvert, compatible avec toute app moderne
- RBAC natif — gestion des rôles sans code applicatif
- Adapters officiels React, Python, Node.js

5. Flux d'authentification


Utilisateur → Dashboard → Keycloak (login)
                               ↓
                          JWT + Refresh Token
                               ↓
Dashboard → API Gateway (Bearer token) → App métier


6. Intégration des apps existantes

Les apps étant indépendantes, la stratégie retenue est l'**iframe** — aucune modification côté apps, isolation totale, déploiement indépendant.


7. Stack Backend — BFF

| Couche | Technologie |
|---|---|
| Framework | Python + FastAPI |
| Base de données | MongoDB |
| Cache | Redis |
| Auth | python-jose + Keycloak |
| Tests | Pytest + httpx |

Le BFF agrège les données des 4 apps et expose une API unifiée au dashboard. MongoDB est choisi pour sa flexibilité face à des schémas hétérogènes (RH, CRM, Finance, Projets). Redis limite les appels répétés vers les apps existantes.


8. Déploiement


Docker Compose
  ├── Dashboard (Nginx)
  ├── BFF (FastAPI)
  ├── Keycloak
  ├── API Gateway
  ├── MongoDB
  └── Redis


- CI/CD : GitHub Actions → build Docker → Docker Compose deploy
- Secrets : variables d'environnement via fichier `.env`
- Observabilité : Grafana


9. Sécurité

| Risque | Mitigation |
|---|---|
| Token interception | HTTPS + HttpOnly cookies |
| CSRF | SameSite=Strict |
| Privilege escalation | Claims JWT vérifiés côté API |
| Session hijacking | Refresh token rotation, révocation Keycloak |

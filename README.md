Test Technique — Hello Pomelo

1. Structure du projet


src/
  q1_customer_history.ts   # Q1 — Historique client
  q2_pricing_engine.ts     # Q2 — Moteur de prix
  types.ts                 # Types partagés et utilitaires
data/
  customers.json
  orders.json
  products.json
ARCHITECTURE.md            # Q3 — Architecture portail unifié
AI_USAGE.md
README.md


2. Installation

npm install


3. Utilisation

Q1 — Historique client
npx ts-node src/q1_customer_history.ts <ID_CLIENT>

npx ts-node src/q1_customer_history.ts C001   # client régulier → regroupement par semaine
npx ts-node src/q1_customer_history.ts C003   # client occasionnel → regroupement par mois


Q2 — Moteur de prix
npx ts-node src/q2_pricing_engine.ts <ID_COMMANDE>

npx ts-node src/q2_pricing_engine.ts ORD-2024-015
npx ts-node src/q2_pricing_engine.ts ORD-2024-009

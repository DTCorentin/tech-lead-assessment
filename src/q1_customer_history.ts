/**
 * Q1 — Agrégation intelligente de l'historique client
 * Usage : ts-node src/q1_customer_history.ts <ID_CLIENT>
 */

import { chargerDonnees, libelleSemaine, libelleMois, formaterPrix, formaterPourcentage, traduireStatut, formaterDate } from "./types";
import type { Commande, Produit, DonneesBrutes } from "./types";

const NOMBRE_MOIS_HISTORIQUE = 6;
const SEUIL_CLIENT_REGULIER  = 2;   // commandes/mois au-delà duquel on groupe par semaine
const SEUIL_ANOMALIE         = 0.5; // écart relatif à la moyenne client

interface LigneCommandeBase {
  idCommande: string;
  date: string;
  montant: number;
  statut: string;
  categories: string[];
  produitsInconnus: string[];
}

interface LigneCommande extends LigneCommandeBase {
  estAnomalique: boolean;
  raisonAnomalie?: string;
}

interface ResumePeriode {
  periode: string;
  nombreCommandes: number;
  montantTotal: number;
  montantMoyen: number;
  evolutionVsPrecedent: number | null;
  commandes: LigneCommande[];
}

interface RapportClient {
  nomClient: string;
  typeClient: string;
  emailClient: string;
  dateDebut: string;
  dateReference: string;
  nombreCommandesTotal: number;
  moyenneCommandesMensuelles: number;
  modeRegroupement: "hebdomadaire" | "mensuel";
  moyenneClient: number;
  periodes: ResumePeriode[];
  anomalies: LigneCommande[];
}

function construireLigne(commande: Commande, produits: Map<string, Produit>): LigneCommandeBase {
  let montant = 0;
  const produitsInconnus: string[] = [];
  const categoriesSet = new Set<string>();

  for (const article of commande.articles) {
    const produit = produits.get(article.idProduit);
    if (!produit) { produitsInconnus.push(article.idProduit); continue; }
    montant += produit.prix * article.quantite;
    produit.categories.forEach((c) => categoriesSet.add(c));
  }

  return {
    idCommande: commande.idCommande,
    date: commande.dateCommande.split("T")[0],
    montant,
    statut: traduireStatut(commande.statut),
    categories: [...categoriesSet].sort(),
    produitsInconnus,
  };
}

function detecterAnomalie(montant: number, moyenne: number): { estAnomalique: boolean; raisonAnomalie?: string } {
  if (moyenne <= 0 || montant <= 0) return { estAnomalique: false };
  const ecart = Math.abs(montant - moyenne) / moyenne;
  if (ecart <= SEUIL_ANOMALIE) return { estAnomalique: false };
  const sens = montant > moyenne ? `+${(ecart * 100).toFixed(0)}% au-dessus` : `-${(ecart * 100).toFixed(0)}% en-dessous`;
  return { estAnomalique: true, raisonAnomalie: `${sens} de la moyenne (moy. : ${formaterPrix(moyenne)})` };
}

function calculerRapport(idClient: string, donnees: DonneesBrutes): RapportClient {
  const { produits, clients, commandes } = donnees;

  const client = clients.get(idClient);
  if (!client) throw new Error(`Client "${idClient}" introuvable. IDs disponibles : ${[...clients.keys()].join(", ")}`);

  // Ancrage sur la dernière commande du dataset pour reproductibilité
  if (commandes.length === 0)
    throw new Error("Aucune commande dans le dataset.");

  const dateReference = new Date(
    commandes.reduce((max, c) => Math.max(max, new Date(c.dateCommande).getTime()), 0)
  );
  const dateDebut = new Date(dateReference);
  dateDebut.setUTCMonth(dateDebut.getUTCMonth() - NOMBRE_MOIS_HISTORIQUE);

  const commandesClient = commandes
    .map((c) => ({ commande: c, ts: new Date(c.dateCommande).getTime() }))
    .filter(({ commande: c, ts }) => c.idClient === idClient && ts >= dateDebut.getTime())
    .sort((a, b) => a.ts - b.ts)
    .map(({ commande }) => commande);

  if (commandesClient.length === 0)
    throw new Error(`Aucune commande pour ${client.nom} sur les ${NOMBRE_MOIS_HISTORIQUE} derniers mois.`);

  const commandesParMois = commandesClient.reduce((acc, c) => {
    const cle = libelleMois(new Date(c.dateCommande));
    return acc.set(cle, (acc.get(cle) ?? 0) + 1);
  }, new Map<string, number>());

  const moyenneCommandesMensuelles =
    [...commandesParMois.values()].reduce((a, b) => a + b, 0) / commandesParMois.size;
  const modeRegroupement: "hebdomadaire" | "mensuel" =
    moyenneCommandesMensuelles > SEUIL_CLIENT_REGULIER ? "hebdomadaire" : "mensuel";

  const lignesInitiales = commandesClient.map((c) => construireLigne(c, produits));
  const montantsValides = lignesInitiales.map((l) => l.montant).filter((m) => m > 0);
  const moyenneClient = montantsValides.length > 0
    ? montantsValides.reduce((a, b) => a + b, 0) / montantsValides.length
    : 0;

  const lignesEnrichies: LigneCommande[] = lignesInitiales.map((l) => ({
    ...l,
    ...detecterAnomalie(l.montant, moyenneClient),
  }));

  const lignesParPeriode = lignesEnrichies.reduce((acc, ligne) => {
    const date = new Date(ligne.date);
    const cle  = modeRegroupement === "hebdomadaire" ? libelleSemaine(date) : libelleMois(date);
    const groupe = acc.get(cle) ?? [];
    groupe.push(ligne);
    return acc.set(cle, groupe);
  }, new Map<string, LigneCommande[]>());

  const periodes = [...lignesParPeriode.keys()].sort().reduce<ResumePeriode[]>((acc, periode) => {
    const lignesPeriode = lignesParPeriode.get(periode) ?? [];
    const montantTotal  = lignesPeriode.reduce((s, l) => s + l.montant, 0);
    const montantMoyen  = montantTotal / lignesPeriode.length;
    const precedent     = acc[acc.length - 1];
    acc.push({
      periode,
      nombreCommandes: lignesPeriode.length,
      montantTotal,
      montantMoyen,
      evolutionVsPrecedent: precedent && precedent.montantTotal > 0
        ? ((montantTotal - precedent.montantTotal) / precedent.montantTotal) * 100
        : null,
      commandes: lignesPeriode,
    });
    return acc;
  }, []);

  return {
    nomClient: client.nom,
    typeClient: client.type,
    emailClient: client.email,
    dateDebut: dateDebut.toISOString().split("T")[0],
    dateReference: dateReference.toISOString().split("T")[0],
    nombreCommandesTotal: commandesClient.length,
    moyenneCommandesMensuelles,
    modeRegroupement,
    moyenneClient,
    periodes,
    anomalies: lignesEnrichies.filter((l) => l.estAnomalique),
  };
}

function afficherRapport(rapport: RapportClient): void {
  const SEP = "─".repeat(72);

  console.log("\nRAPPORT D'HISTORIQUE CLIENT");
  console.log(SEP);
  console.log(`  Client     : ${rapport.nomClient}`);
  console.log(`  Type       : ${rapport.typeClient}`);
  console.log(`  Email      : ${rapport.emailClient}`);
  console.log(`  Période    : ${rapport.dateDebut} → ${rapport.dateReference}`);
  console.log(`  Commandes  : ${rapport.nombreCommandesTotal} au total | moy. ${rapport.moyenneCommandesMensuelles.toFixed(1)}/mois`);
  console.log(`  Rythme     : ${rapport.modeRegroupement === "hebdomadaire" ? "Régulier" : "Occasionnel"} → regroupement ${rapport.modeRegroupement}`);
  console.log(`  Panier moy.: ${formaterPrix(rapport.moyenneClient)}`);

  const COL = { periode: 12, cmds: 10, total: 12, moyen: 12, evolution: 12 };

  console.log("");
  console.log(
    "Période".padEnd(COL.periode) +
    "Commandes".padEnd(COL.cmds) +
    "Total".padEnd(COL.total) +
    "Moyen".padEnd(COL.moyen) +
    "Evolution"
  );
  console.log(SEP);

  for (const entree of rapport.periodes) {
    const evolution = entree.evolutionVsPrecedent !== null
      ? formaterPourcentage(entree.evolutionVsPrecedent)
      : "(première)";
    console.log(
      entree.periode.padEnd(COL.periode) +
      String(entree.nombreCommandes).padEnd(COL.cmds) +
      formaterPrix(entree.montantTotal).padEnd(COL.total) +
      formaterPrix(entree.montantMoyen).padEnd(COL.moyen) +
      evolution
    );
  }

  console.log("\n" + SEP);
  console.log("DÉTAIL DES COMMANDES");
  console.log(SEP);
  console.log(
    "Période".padEnd(12) +
    "Commande".padEnd(16) +
    "Date".padEnd(13) +
    "Montant".padEnd(11) +
    "Statut".padEnd(14) +
    "Categories"
  );
  console.log(SEP);

  for (const entree of rapport.periodes) {
    for (const c of entree.commandes) {
      const anomalie = c.estAnomalique ? "  [ANOMALIE]" : "";
      console.log(
        entree.periode.padEnd(12) +
        c.idCommande.padEnd(16) +
        formaterDate(c.date).padEnd(13) +
        formaterPrix(c.montant).padEnd(11) +
        c.statut.padEnd(14) +
        (c.categories.join(", ") || "N/A") +
        anomalie
      );
      if (c.produitsInconnus.length > 0)
        console.log(" ".repeat(12) + `! Produits inconnus : ${c.produitsInconnus.join(", ")}`);
    }
  }

  console.log("\n" + SEP);
  if (rapport.anomalies.length > 0) {
    console.log(`ANOMALIES (${rapport.anomalies.length} commande${rapport.anomalies.length > 1 ? "s" : ""})`);
    console.log(SEP);
    console.log(
      "Commande".padEnd(20) +
      "Date".padEnd(14) +
      "Montant".padEnd(12) +
      "Ecart"
    );
    console.log(SEP);
    for (const a of rapport.anomalies) {
      console.log(
        a.idCommande.padEnd(20) +
        formaterDate(a.date).padEnd(14) +
        formaterPrix(a.montant).padEnd(12) +
        (a.raisonAnomalie ?? "")
      );
    }
  } else {
    console.log("Aucune anomalie détectée.");
  }
  console.log("");
}

const idClient = process.argv[2];
if (!idClient) {
  console.error("Usage : ts-node src/q1_customer_history.ts <ID_CLIENT>");
  process.exit(1);
}

try {
  afficherRapport(calculerRapport(idClient, chargerDonnees()));
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
}

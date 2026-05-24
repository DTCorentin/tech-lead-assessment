/**
 * Q2 — Moteur de règles avec dépendances et priorités
 * Usage : ts-node src/q2_pricing_engine.ts <ID_COMMANDE>
 */

import { chargerDonnees, formaterPrix, traduireStatut } from "./types";
import type { Commande, Produit } from "./types";

const REGLES = {
  remiseClient: { Premium: 0.10, Vip: 0.15 } as Record<string, number>,
  remisePremiereCommande: 0.05,
  seuilConditionnels: [
    { seuil: 1000, remise: 0.08 },
    { seuil: 500,  remise: 0.05 },
  ],
  taxesCategories: {
    Électronique: { taux: 0.20, code: "ELECTRONIQUE" },
    Alimentaire:  { taux: 0.055, code: "ALIMENTAIRE" },
  } as Record<string, { taux: number; code: string }>,
  seuilRemiseVolume: { quantiteMin: 3, remise: 0.10 },
  fraisLivraisonExpress: 15,
  seuilFraisTraitement:  { montantMax: 50, frais: 5 },
};

interface ApplicationRegle {
  codeRegle: string;
  description: string;
  impact: number;
  libelleImpact: string;
}

interface LigneProduit {
  nomProduit: string;
  categories: string[];
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
  tauxTaxe: number;
  montantTaxe: number;
  remiseVolume: number;
  totalLigne: number;
}

interface ResultatPrix {
  montantBrut: number;
  montantApresBase: number;
  montantFinal: number;
  lignesProduits: LigneProduit[];
  journalRegles: ApplicationRegle[];
  totalTaxes: number;
  totalRemisesVolume: number;
  remiseConditionnelle: number;
  fraisLivraisonExpress: number;
  fraisTraitement: number;
}

function obtenirTauxTaxe(categories: string[]): number {
  return Math.max(0, ...categories.map((c) => REGLES.taxesCategories[c]?.taux ?? 0));
}

// Pour chaque client+mois, identifie la commande chronologiquement la plus ancienne.
// Lookup O(1) au lieu de O(n) par appel au moteur de prix.
function precalculerPremieresCommandes(commandes: Commande[]): Set<string> {
  const premieresParCle = new Map<string, { idCommande: string; date: number }>();

  for (const c of commandes) {
    const d    = new Date(c.dateCommande);
    const cle  = `${c.idClient}|${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const ts   = d.getTime();
    const actuelle = premieresParCle.get(cle);
    if (!actuelle || ts < actuelle.date)
      premieresParCle.set(cle, { idCommande: c.idCommande, date: ts });
  }

  return new Set([...premieresParCle.values()].map((v) => v.idCommande));
}

function calculerPrix(
  commande: Commande,
  produits: Map<string, Produit>,
  premieresCommandes: Set<string>,
  typeClient: string
): ResultatPrix {
  const journal: ApplicationRegle[] = [];
  const articlesValides = commande.articles.filter((a) => produits.has(a.idProduit));
  if (articlesValides.length === 0)
    throw new Error(`Commande "${commande.idCommande}" : aucun produit valide (tous inconnus ou absents).`);

  // Étape 1 — Remises de base (sur montant brut)
  const montantBrut = articlesValides.reduce((s, a) => {
    const produit = produits.get(a.idProduit);
    return produit ? s + produit.prix * a.quantite : s;
  }, 0);
  let montantApresBase = montantBrut;

  const tauxRemiseClient = REGLES.remiseClient[typeClient as keyof typeof REGLES.remiseClient];
  if (tauxRemiseClient) {
    const remise = montantBrut * tauxRemiseClient;
    montantApresBase -= remise;
    journal.push({
      codeRegle: `BASE_${typeClient.toUpperCase()}`,
      description: `Client ${typeClient} : -${tauxRemiseClient * 100}% sur le prix brut`,
      impact: -remise,
      libelleImpact: `-${formaterPrix(remise)} (-${tauxRemiseClient * 100}%)`,
    });
  }

  if (premieresCommandes.has(commande.idCommande)) {
    const remise = montantBrut * REGLES.remisePremiereCommande;
    montantApresBase -= remise;
    journal.push({
      codeRegle: "BASE_PREMIERE_COMMANDE_MOIS",
      description: `Première commande du mois : -${REGLES.remisePremiereCommande * 100}% sur le prix brut`,
      impact: -remise,
      libelleImpact: `-${formaterPrix(remise)} (-${REGLES.remisePremiereCommande * 100}%)`,
    });
  }

  // Étape 2 — Règle conditionnelle (déterminée ici, potentiellement annulée à l'étape 4)
  const regleConditionnelle = REGLES.seuilConditionnels.find((r) => montantApresBase > r.seuil);
  let remiseConditionnelle   = regleConditionnelle ? montantApresBase * regleConditionnelle.remise : 0;

  // Étape 3 — Taxes par catégorie + comptage des quantités par catégorie
  const quantitesParCategorie = articlesValides.reduce((acc, a) => {
    const produit = produits.get(a.idProduit) as Produit;
    for (const cat of produit.categories)
      acc.set(cat, (acc.get(cat) ?? 0) + a.quantite);
    return acc;
  }, new Map<string, number>());

  const lignesProduits: LigneProduit[] = articlesValides.map((a) => {
    const produit     = produits.get(a.idProduit) as Produit;
    const sousTotal   = produit.prix * a.quantite;
    const tauxTaxe    = obtenirTauxTaxe(produit.categories);
    const montantTaxe = sousTotal * tauxTaxe;
    return {
      nomProduit: produit.nom,
      categories: produit.categories,
      quantite: a.quantite,
      prixUnitaire: produit.prix,
      sousTotal,
      tauxTaxe,
      montantTaxe,
      remiseVolume: 0,
      totalLigne: sousTotal + montantTaxe,
    };
  });

  const totalTaxes = lignesProduits.reduce((s, l) => s + l.montantTaxe, 0);

  for (const [categorie, { taux, code }] of Object.entries(REGLES.taxesCategories)) {
    const montantTaxeCategorie = lignesProduits
      .filter((l) => l.categories.includes(categorie) && l.tauxTaxe === taux)
      .reduce((s, l) => s + l.montantTaxe, 0);
    if (montantTaxeCategorie > 0)
      journal.push({
        codeRegle: `TAXE_${code}`,
        description: `Taxe produits ${categorie} : +${taux * 100}% par produit`,
        impact: montantTaxeCategorie,
        libelleImpact: `+${formaterPrix(montantTaxeCategorie)} (+${taux * 100}%)`,
      });
  }

  // Étape 4 — Seuil cumulatif (peut annuler la règle conditionnelle de l'étape 2)
  const categoriesAvecSeuil = new Set(
    [...quantitesParCategorie.entries()]
      .filter(([, qte]) => qte > REGLES.seuilRemiseVolume.quantiteMin)
      .map(([cat]) => cat)
  );

  let totalRemisesVolume = 0;
  if (categoriesAvecSeuil.size > 0) {
    for (const ligne of lignesProduits) {
      if (ligne.categories.some((c) => categoriesAvecSeuil.has(c))) {
        const remise = ligne.sousTotal * REGLES.seuilRemiseVolume.remise;
        ligne.remiseVolume = remise;
        ligne.totalLigne  -= remise;
        totalRemisesVolume += remise;
      }
    }
    journal.push({
      codeRegle: "SEUIL_CUMULATIF",
      description: `>3 produits dans [${[...categoriesAvecSeuil].join(", ")}] : -${REGLES.seuilRemiseVolume.remise * 100}% sur ces produits`,
      impact: -totalRemisesVolume,
      libelleImpact: `-${formaterPrix(totalRemisesVolume)} (-${REGLES.seuilRemiseVolume.remise * 100}%)`,
    });
  }

  const montantApresCategories = montantBrut + totalTaxes - totalRemisesVolume;

  if (regleConditionnelle?.seuil === 500 && montantApresCategories < 500) {
    journal.push({
      codeRegle: "ANNULATION_CONDITIONNELLE",
      description: "Montant après seuil cumulatif < 500€ → annulation de la règle conditionnelle >500€",
      impact: 0,
      libelleImpact: "Règle annulée",
    });
    remiseConditionnelle = 0;
  } else if (regleConditionnelle) {
    journal.push({
      codeRegle: `CONDITIONNELLE_${regleConditionnelle.seuil}`,
      description: `Montant après réductions de base > ${regleConditionnelle.seuil}€ (${formaterPrix(montantApresBase)}) : -${regleConditionnelle.remise * 100}%`,
      impact: -remiseConditionnelle,
      libelleImpact: `-${formaterPrix(remiseConditionnelle)} (-${regleConditionnelle.remise * 100}%)`,
    });
  }

  // Étape 5 — Règles finales
  let montantFinal = montantApresCategories - remiseConditionnelle;

  let fraisExpress = 0;
  if (commande.livraisonExpress) {
    fraisExpress = REGLES.fraisLivraisonExpress;
    montantFinal += fraisExpress;
    journal.push({
      codeRegle: "FINALE_LIVRAISON_EXPRESS",
      description: `Livraison express : +${fraisExpress}€ (fixe)`,
      impact: fraisExpress,
      libelleImpact: `+${formaterPrix(fraisExpress)}`,
    });
  }

  let fraisTraitement = 0;
  if (montantFinal < REGLES.seuilFraisTraitement.montantMax) {
    fraisTraitement = REGLES.seuilFraisTraitement.frais;
    montantFinal   += fraisTraitement;
    journal.push({
      codeRegle: "FINALE_FRAIS_TRAITEMENT",
      description: `Montant final < ${REGLES.seuilFraisTraitement.montantMax}€ : frais de traitement +${fraisTraitement}€`,
      impact: fraisTraitement,
      libelleImpact: `+${formaterPrix(fraisTraitement)}`,
    });
  }

  return {
    montantBrut,
    montantApresBase,
    montantFinal,
    lignesProduits,
    journalRegles: journal,
    totalTaxes,
    totalRemisesVolume,
    remiseConditionnelle,
    fraisLivraisonExpress: fraisExpress,
    fraisTraitement,
  };
}

interface ContexteAffichage {
  commande: Commande;
  nomClient: string;
  typeClient: string;
  produitsInconnus: string[];
  resultat: ResultatPrix;
}

function afficherResultat({ commande, nomClient, typeClient, produitsInconnus, resultat: r }: ContexteAffichage): void {
  const SEP = "─".repeat(72);

  console.log("\nDÉTAIL DE LA COMMANDE");
  console.log(SEP);
  console.log(`  Commande : ${commande.idCommande}`);
  console.log(`  Date     : ${commande.dateCommande.split("T")[0]}`);
  console.log(`  Client   : ${nomClient} — ${typeClient}`);
  console.log(`  Statut   : ${traduireStatut(commande.statut)}`);
  console.log(`  Express  : ${commande.livraisonExpress ? "Oui" : "Non"}`);
  if (produitsInconnus.length > 0)
    console.log(`  ! Produits inconnus (exclus) : ${produitsInconnus.join(", ")}`);

  console.log("\n" + SEP);
  console.log("LIGNES PRODUIT");
  console.log(SEP);
  console.log(
    "Produit".padEnd(28) +
    "Qté".padStart(4) +
    "P.Unit.".padStart(11) +
    "S/Total".padStart(11) +
    "Taxe".padStart(8) +
    "Rem.Vol.".padStart(10) +
    "Total".padStart(11)
  );
  console.log(SEP);

  for (const l of r.lignesProduits) {
    const taxeStr = l.tauxTaxe > 0 ? `+${(l.tauxTaxe * 100).toFixed(1)}%` : "—";
    const volStr  = l.remiseVolume > 0 ? `-${formaterPrix(l.remiseVolume)}` : "—";
    console.log(
      l.nomProduit.substring(0, 28).padEnd(28) +
      String(l.quantite).padStart(4) +
      formaterPrix(l.prixUnitaire).padStart(11) +
      formaterPrix(l.sousTotal).padStart(11) +
      taxeStr.padStart(8) +
      volStr.padStart(10) +
      formaterPrix(l.totalLigne).padStart(11)
    );
  }

  console.log(SEP);
  console.log(`Montant brut : ${formaterPrix(r.montantBrut)}`);

  console.log("\n" + SEP);
  console.log("RÈGLES APPLIQUÉES");
  console.log(SEP);
  if (r.journalRegles.length === 0) {
    console.log("Aucune règle appliquée.");
  } else {
    for (const regle of r.journalRegles) {
      const desc = regle.description.length > 50
        ? regle.description.substring(0, 47) + "..."
        : regle.description;
      console.log(desc.padEnd(52) + regle.libelleImpact);
    }
  }

  console.log("\n" + SEP);
  console.log("RÉCAPITULATIF");
  console.log(SEP);
  console.log(`Montant brut              : ${formaterPrix(r.montantBrut)}`);
  if (r.montantApresBase !== r.montantBrut)
    console.log(`Après remises de base     : ${formaterPrix(r.montantApresBase)}`);
  console.log(`+ Taxes catégories        : +${formaterPrix(r.totalTaxes)}`);
  if (r.totalRemisesVolume > 0)    console.log(`- Remises volume          : -${formaterPrix(r.totalRemisesVolume)}`);
  if (r.remiseConditionnelle > 0)  console.log(`- Remise conditionnelle   : -${formaterPrix(r.remiseConditionnelle)}`);
  if (r.fraisLivraisonExpress > 0) console.log(`+ Livraison express       : +${formaterPrix(r.fraisLivraisonExpress)}`);
  if (r.fraisTraitement > 0)       console.log(`+ Frais de traitement     : +${formaterPrix(r.fraisTraitement)}`);
  console.log(SEP);
  console.log(`PRIX FINAL                : ${formaterPrix(r.montantFinal)}`);
  console.log("");
}

const idCommande = process.argv[2];
if (!idCommande) {
  console.error("Usage : ts-node src/q2_pricing_engine.ts <ID_COMMANDE>");
  process.exit(1);
}

try {
  const donnees = chargerDonnees();
  const { produits, clients, commandes } = donnees;

  const commande = commandes.find((c) => c.idCommande === idCommande);
  if (!commande) throw new Error(`Commande "${idCommande}" introuvable.`);

  const client = clients.get(commande.idClient);
  if (!client) throw new Error(`Client "${commande.idClient}" introuvable (commande orpheline).`);

  const produitsInconnus   = commande.articles.filter((a) => !produits.has(a.idProduit)).map((a) => a.idProduit);
  const premieresCommandes = precalculerPremieresCommandes(commandes);

  afficherResultat({
    commande,
    nomClient: `${client.nom} (${client.id})`,
    typeClient: client.type,
    produitsInconnus,
    resultat: calculerPrix(commande, produits, premieresCommandes, client.type),
  });
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
}

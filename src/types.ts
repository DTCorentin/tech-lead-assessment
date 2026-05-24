import * as fs from "fs";
import * as path from "path";

export interface Produit {
  id: string;
  nom: string;
  prix: number;
  categories: string[];
}

export interface Client {
  id: string;
  nom: string;
  email: string;
  type: string; // "Standard" par défaut si absent ou vide dans le JSON source
  dateInscription: string;
}

export interface ArticleCommande {
  idProduit: string;
  quantite: number;
}

export interface Commande {
  idCommande: string;
  idClient: string;
  dateCommande: string;
  statut: string;
  livraisonExpress: boolean; // false par défaut si absent dans le JSON source
  articles: ArticleCommande[];
}

export interface DonneesBrutes {
  produits: Map<string, Produit>;
  clients: Map<string, Client>;
  commandes: Commande[];
}

const REPERTOIRE_DONNEES = path.join(__dirname, "..", "data");
const MS_PAR_JOUR = 86400000;

function chargerFichier<T>(nomFichier: string): T {
  const chemin = path.join(REPERTOIRE_DONNEES, nomFichier);
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8")) as T;
  } catch {
    throw new Error(`Impossible de lire le fichier de données : ${chemin}`);
  }
}

function normaliserTypeClient(type: string | undefined): string {
  const t = type?.trim();
  if (!t) return "Standard";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function chargerDonnees(): DonneesBrutes {
  const { products } = chargerFichier<{ products: any[] }>("products.json");
  const { customers } = chargerFichier<{ customers: any[] }>("customers.json");
  const { orders } = chargerFichier<{ orders: any[] }>("orders.json");

  const produits = new Map<string, Produit>(
    products.map((p) => [
      p.id,
      { id: p.id, nom: p.name, prix: parseFloat(String(p.price)), categories: p.categories },
    ])
  );

  const clients = new Map<string, Client>(
    customers.map((c) => [
      c.id,
      { id: c.id, nom: c.name, email: c.email, type: normaliserTypeClient(c.type), dateInscription: c.registration_date },
    ])
  );

  const commandes: Commande[] = orders.map((o: any) => ({
    idCommande: o.order_id,
    idClient: o.customer_id,
    dateCommande: o.order_date,
    statut: o.status,
    livraisonExpress: o.express_delivery ?? false,
    articles: o.items.map((i: any) => ({ idProduit: i.product_id, quantite: i.quantity })),
  }));

  return { produits, clients, commandes };
}

// Libellé semaine ISO : "2024-S28"
export function libelleSemaine(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const debutAnnee = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const semaine = Math.ceil(((tmp.getTime() - debutAnnee.getTime()) / MS_PAR_JOUR + 1) / 7);
  return `${tmp.getUTCFullYear()}-S${String(semaine).padStart(2, "0")}`;
}

// Libellé mois : "2024-07"
export function libelleMois(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const STATUTS: Record<string, string> = {
  Delivered:  "Livré",
  Processing: "En traitement",
  Shipped:    "En cours de livraison",
  Cancelled:  "Annulé",
  Pending:    "En attente",
};

export function traduireStatut(statut: string): string {
  return STATUTS[statut] ?? statut;
}

export function formaterDate(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("T")[0].split("-");
  return `${jour}/${mois}/${annee}`;
}

export function formaterPrix(montant: number): string {
  return montant.toFixed(2) + "€";
}

export function formaterPourcentage(valeur: number): string {
  return (valeur >= 0 ? "+" : "") + valeur.toFixed(1) + "%";
}

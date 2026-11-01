# Petit Commerce

Application de caisse et de gestion de stock hors-ligne, pensée pour les petits commerces (boucherie, charcuterie, traiteur...).

100 % hors-ligne, interface en français, base de données SQLite locale.

## Fonctionnalités

### 🛒 Caisse
- Ajout de produits par recherche ou scan de code-barres
- 3 modes de paiement : **Espèces**, **Carte bancaire**, **Crédit**
- Sélection du client (facultative en espèces/carte, obligatoire en crédit)
- Calcul automatique du rendu en espèces
- Contrôle du plafond de crédit avec avertissement
- Génération d'un **ticket de caisse 80mm** ou d'une **facture A4**
- Facture avec coordonnées du client et informations de l'entreprise

### 📦 Stock & Lots
- Création de lots par pesée (poids par pièce + nombre de pièces)
- Génération automatique du code-barres selon la catégorie
- **Étiquettes imprimables** avec : type de produit, poids, date de fabrication, prix et code-barres
- Regroupement par catégorie / sous-catégorie
- Affichage du poids total par groupe
- Filtre "Alertes seulement", "Masquer les épuisés"
- Journal des mouvements de stock (entrées/sorties/ventes/ajustements)
- Impression d'étiquettes à l'unité ou en lot

### 🗂 Catégories
- Gestion des catégories et sous-catégories
- Unité par défaut par catégorie
- Seuls les niveaux finaux (sans sous-catégorie) permettent de créer des lots
- Affichage en arborescence dans le stock (`Catégorie → Sous-catégorie`)

### 👥 Clients
- Fiches clients complètes (nom, téléphone, e-mail, adresse)
- Suivi des dettes à crédit
- Encaissement des remboursements
- Historique des ventes à crédit par client
- Plafond de crédit paramétrable

### ⚙️ Paramètres
- Nom du commerce, devise, message du ticket
- **Coordonnées entreprise** + **logo** pour les factures A4
- Protection par code PIN du mode Caisse
- Sauvegarde / restauration de la base de données
- Vidage de l'historique des ventes

## Prérequis

- [Node.js](https://nodejs.org/) (LTS recommandé)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

## Installation & développement

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm run tauri dev
Build pour installation
# Générer l'installateur
npm run tauri build
Les fichiers générés se trouvent dans :  
src-tauri/target/release/bundle/  
(.msi, .exe sous Windows / .AppImage, .deb sous Linux)
Données & fichiers
Fichier	Emplacement	Description
Base de données	~/.config/com.petitcommerce.app/petit-commerce.db	Toutes les ventes, stocks, clients, paramètres
Fichiers WAL/SHM	Même dossier	Fichiers temporaires SQLite (automatiques)
En cas de restauration, l'application redémarre automatiquement après remplacement de la base.
Astuces d'utilisation
- Scan rapide : depuis l'écran Caisse, utilise directement le champ "Scannez un code-barres ou tapez un nom..." avec ton lecteur de codes-barres.
- Lots vendus à la pièce : un lot pesé (ex. 1,53 kg) se vend obligatoirement en pièce entière.
- Étiquettes : à la création d'un lot, les étiquettes s'ouvrent automatiquement. Possibilité de réimprimer depuis Stock & lots ou depuis l'historique.
- Facture vs Ticket : si un client est sélectionné à l'encaissement, la fenêtre propose directement la facture A4.
- Masquer les épuisés : coché par défaut dans Stock & lots pour garder une vue plus claire.
Stack technique
- Tauri 2 (https://v2.tauri.app/) - Framework desktop (Rust + Web)
- React 19 (https://react.dev/) + TypeScript (https://www.typescriptlang.org/)
- Vite (https://vitejs.dev/) + Tailwind CSS v4 (https://tailwindcss.com/)
- SQLite (https://www.sqlite.org/) via @tauri-apps/plugin-sql
Licence
Projet à usage privé / commercial selon tes besoins.

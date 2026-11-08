# Petit Commerce - Site web commande en ligne

Site web prêt à être importé directement dans le dossier `www/` de ton hébergement OVH.

## Installation rapide

### 1) Créer la base de données
- OVH > Hébergement > Base de données MySQL
- Créer une base + un utilisateur avec tous les droits
- Ouvrir phpMyAdmin et importer `sql/schema.sql`

### 2) Configurer
Ouvre `config.php` à la racine et modifie :

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'toncompte_nomdelabase');
define('DB_USER', 'toncompte_utilisateur');
define('DB_PASS', 'ton_mot_de_passe');
define('API_TOKEN', 'GENERE_UN_TOKEN_FORT_ICI');
```

Génère un token fort, tu le réutiliseras dans ton appli Tauri.

### 3) Envoyer sur OVH
**Méthode recommandée (racine du domaine)**
1. Sélectionne TOUT le contenu du dossier `site-web/` (index.php, config.php, api/, etc.)
2. Envoie-le directement dans `www/`
3. Ouvre ton domaine : `https://ton-domaine.fr/`

**Si tu uploads le ZIP**
1. Envoie `petit-commerce-site-web.zip` dans `www/`
2. Dézippe-le depuis le gestionnaire de fichiers OVH
3. Déplace le contenu de `site-web/` à la racine de `www/` puis supprime le dossier vide

## API pour ton appli Tauri

Protégées par `?token=VOTRE_API_TOKEN`

| Endpoint | Méthode | Usage |
|---|---|---|
| `/api/sync/stock.php` | POST | Envoyer le stock depuis Tauri vers le site |
| `/api/commandes/nouvelles.php` | GET | Récupérer les commandes non importées |
| `/api/commandes/marquer.php` | POST | Marquer les commandes comme importées |

## Fonctionnement
- Les produits avec `stock_restant <= 0` sont affichés en "ÉPUISÉ" et non achetables
- Commande "À retirer en magasin" uniquement
- Synchronisation automatique entre Tauri et le site via API
- Évite les doublons grâce au flag `importe`

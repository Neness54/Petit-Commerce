-- Schema pour Petit Commerce Web
-- A importer dans phpMyAdmin / Adminer sur OVH

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

CREATE TABLE IF NOT EXISTS `produits_web` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `produit_local_id` int(11) DEFAULT NULL,
  `code_barres` varchar(64) DEFAULT NULL,
  `nom` varchar(255) NOT NULL,
  `prix` decimal(10,2) NOT NULL DEFAULT 0.00,
  `stock_restant` int(11) NOT NULL DEFAULT 0,
  `image` varchar(255) DEFAULT NULL,
  `actif` tinyint(1) NOT NULL DEFAULT 1,
  `maj_le` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_produit_local_id` (`produit_local_id`),
  KEY `idx_code_barres` (`code_barres`),
  KEY `idx_actif` (`actif`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `commandes_web` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ref` varchar(32) NOT NULL,
  `nom_client` varchar(255) NOT NULL,
  `telephone` varchar(32) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `adresse` text,
  `note` text,
  `montant_total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `mode_retrait` enum('magasin') NOT NULL DEFAULT 'magasin',
  `statut` enum('nouvelle','en_preparation','prete','recuperee','annulee') NOT NULL DEFAULT 'nouvelle',
  `importe` tinyint(1) NOT NULL DEFAULT 0,
  `importe_le` datetime DEFAULT NULL,
  `cree_le` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ref` (`ref`),
  KEY `idx_importe` (`importe`),
  KEY `idx_statut` (`statut`),
  KEY `idx_cree_le` (`cree_le`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lignes_commandes_web` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `commande_web_id` int(11) NOT NULL,
  `produit_web_id` int(11) DEFAULT NULL,
  `produit_local_id` int(11) DEFAULT NULL,
  `nom_produit` varchar(255) NOT NULL,
  `quantite` int(11) NOT NULL DEFAULT 1,
  `prix_unitaire` decimal(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_commande` (`commande_web_id`),
  KEY `idx_produit_web` (`produit_web_id`),
  CONSTRAINT `fk_ligne_commande` FOREIGN KEY (`commande_web_id`) REFERENCES `commandes_web` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

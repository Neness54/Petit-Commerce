<?php
require_once '../config.php';

header('Content-Type: application/json; charset=utf-8');

$pdo = db();
$stmt = $pdo->prepare("SELECT id, produit_local_id, code_barres, nom, prix, stock_restant, actif, maj_le FROM produits_web WHERE actif = 1 ORDER BY nom ASC");
$stmt->execute();
$produits = $stmt->fetchAll();

jsonResponse(['success' => true, 'produits' => $produits]);

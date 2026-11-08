<?php
require_once '../../config.php';

checkApiToken();

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['success' => false, 'message' => 'Méthode non autorisée'], 405);
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    jsonResponse(['success' => false, 'message' => 'Données JSON invalides'], 400);
}

try {
    $pdo->beginTransaction();
    
    $count = 0;
    foreach ($data as $item) {
        if (empty($item['produit_local_id'])) continue;
        
        $produit_local_id = intval($item['produit_local_id']);
        $code_barres = trim($item['code_barres'] ?? '') ?: null;
        $nom = trim($item['nom'] ?? '');
        $prix = floatval($item['prix'] ?? 0);
        $stock_restant = intval($item['stock_restant'] ?? 0);
        
        if ($nom === '') continue;
        
        $stmt = $pdo->prepare("SELECT id FROM produits_web WHERE produit_local_id = ?");
        $stmt->execute([$produit_local_id]);
        $exists = $stmt->fetch();
        
        if ($exists) {
            $stmt = $pdo->prepare("UPDATE produits_web SET code_barres = ?, nom = ?, prix = ?, stock_restant = ?, actif = 1 WHERE produit_local_id = ?");
            $stmt->execute([$code_barres, $nom, $prix, $stock_restant, $produit_local_id]);
        } else {
            $stmt = $pdo->prepare("INSERT INTO produits_web (produit_local_id, code_barres, nom, prix, stock_restant, actif) VALUES (?, ?, ?, ?, ?, 1)");
            $stmt->execute([$produit_local_id, $code_barres, $nom, $prix, $stock_restant]);
        }
        $count++;
    }
    
    $pdo->commit();
    jsonResponse(['success' => true, 'message' => $count . ' produit(s) synchronisé(s)']);
} catch (Exception $e) {
    $pdo->rollBack();
    jsonResponse(['success' => false, 'message' => 'Erreur: ' . $e->getMessage()], 500);
}

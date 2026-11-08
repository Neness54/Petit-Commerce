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
        $id = intval($item['web_commande_id'] ?? 0);
        if ($id <= 0) continue;
        
        $stmt = $pdo->prepare("UPDATE commandes_web SET importe = 1, importe_le = NOW(), statut = 'en_preparation' WHERE id = ? AND importe = 0");
        $stmt->execute([$id]);
        if ($stmt->rowCount() > 0) {
            $count++;
        }
    }
    
    $pdo->commit();
    jsonResponse(['success' => true, 'message' => $count . ' commande(s) marquée(s) comme importée(s)']);
} catch (Exception $e) {
    $pdo->rollBack();
    jsonResponse(['success' => false, 'message' => 'Erreur: ' . $e->getMessage()], 500);
}

<?php
require_once '../../config.php';

checkApiToken();

$pdo = db();

$stmt = $pdo->prepare("SELECT * FROM commandes_web WHERE importe = 0 ORDER BY cree_le ASC");
$stmt->execute();
$commandes = $stmt->fetchAll();

$result = [];
foreach ($commandes as $cmd) {
    $stmt2 = $pdo->prepare("SELECT * FROM lignes_commandes_web WHERE commande_web_id = ?");
    $stmt2->execute([$cmd['id']]);
    $lignes = $stmt2->fetchAll();
    
    $result[] = [
        'id' => $cmd['id'],
        'ref' => $cmd['ref'],
        'nom_client' => $cmd['nom_client'],
        'telephone' => $cmd['telephone'],
        'email' => $cmd['email'],
        'note' => $cmd['note'],
        'montant_total' => $cmd['montant_total'],
        'cree_le' => $cmd['cree_le'],
        'lignes' => $lignes
    ];
}

jsonResponse(['success' => true, 'commandes' => $result]);

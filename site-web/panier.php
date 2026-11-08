<?php
require_once 'config.php';

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    
    if ($action === 'ajouter') {
        $produit_id = intval($_POST['produit_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT * FROM produits_web WHERE id = ? AND actif = 1 AND stock_restant > 0");
        $stmt->execute([$produit_id]);
        $produit = $stmt->fetch();
        
        if ($produit) {
            if (!isset($_SESSION['panier'][$produit_id])) {
                $_SESSION['panier'][$produit_id] = [
                    'id' => $produit['id'],
                    'produit_local_id' => $produit['produit_local_id'],
                    'nom' => $produit['nom'],
                    'prix' => $produit['prix'],
                    'quantite' => 1
                ];
            } else {
                $_SESSION['panier'][$produit_id]['quantite']++;
            }
        }
        header('Location: panier.php');
        exit;
    }
    
    if ($action === 'maj') {
        $produit_id = intval($_POST['produit_id'] ?? 0);
        $quantite = intval($_POST['quantite'] ?? 0);
        if ($quantite <= 0) {
            unset($_SESSION['panier'][$produit_id]);
        } else {
            if (isset($_SESSION['panier'][$produit_id])) {
                $stmt = $pdo->prepare("SELECT stock_restant FROM produits_web WHERE id = ?");
                $stmt->execute([$produit_id]);
                $stock = $stmt->fetchColumn();
                if ($stock !== false && $quantite <= $stock) {
                    $_SESSION['panier'][$produit_id]['quantite'] = $quantite;
                }
            }
        }
        header('Location: panier.php');
        exit;
    }
    
    if ($action === 'supprimer') {
        $produit_id = intval($_POST['produit_id'] ?? 0);
        unset($_SESSION['panier'][$produit_id]);
        header('Location: panier.php');
        exit;
    }
    
    if ($action === 'vider') {
        unset($_SESSION['panier']);
        header('Location: panier.php');
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mon panier - <?php echo SITE_NAME; ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <header>
        <div class="header-container">
            <a href="index.php" class="logo"><?php echo SITE_NAME; ?></a>
            <nav class="nav">
                <a href="index.php" class="nav-link">← Retour au catalogue</a>
                <a href="panier.php" class="nav-link">
                    🛒 Panier
                    <?php $count = panierCount(); if ($count > 0): ?>
                        <span class="panier-badge"><?php echo $count; ?></span>
                    <?php endif; ?>
                </a>
            </nav>
        </div>
    </header>

    <main class="container">
        <h1 class="page-title">Mon panier</h1>

        <?php if (empty($_SESSION['panier'])): ?>
            <div class="empty-state">
                <div class="empty-state-icon">🛒</div>
                <h2 class="empty-state-title">Votre panier est vide</h2>
                <p class="empty-state-text">Ajoutez des produits depuis le catalogue</p>
                <a href="index.php" class="btn btn-primary" style="max-width: 250px; margin: 0 auto;">Voir le catalogue</a>
            </div>
        <?php else: ?>
            <table class="panier-table">
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th>Prix unitaire</th>
                        <th>Quantité</th>
                        <th>Total</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($_SESSION['panier'] as $item): ?>
                        <tr>
                            <td><strong><?php echo htmlspecialchars($item['nom']); ?></strong></td>
                            <td><?php echo number_format($item['prix'], 2, ',', ' '); ?> €</td>
                            <td>
                                <form action="panier.php" method="post" style="display: flex; gap: 0.5rem; align-items: center;">
                                    <input type="hidden" name="action" value="maj">
                                    <input type="hidden" name="produit_id" value="<?php echo $item['id']; ?>">
                                    <input type="number" name="quantite" value="<?php echo $item['quantite']; ?>" min="1" style="width: 70px; padding: 0.5rem; border: 1px solid var(--gray-300); border-radius: 6px;">
                                    <button type="submit" class="btn-secondary" style="width: auto; padding: 0.5rem 0.75rem;">OK</button>
                                </form>
                            </td>
                            <td><strong><?php echo number_format($item['prix'] * $item['quantite'], 2, ',', ' '); ?> €</strong></td>
                            <td>
                                <form action="panier.php" method="post">
                                    <input type="hidden" name="action" value="supprimer">
                                    <input type="hidden" name="produit_id" value="<?php echo $item['id']; ?>">
                                    <button type="submit" style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 1.25rem;">🗑️</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>

            <div class="panier-total">
                <div class="panier-total-row">
                    <span>Total</span>
                    <span><?php echo number_format(panierTotal(), 2, ',', ' '); ?> €</span>
                </div>
            </div>

            <div style="display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap;">
                <form action="panier.php" method="post">
                    <input type="hidden" name="action" value="vider">
                    <button type="submit" class="btn btn-secondary">Vider le panier</button>
                </form>
                <a href="commander.php" class="btn btn-primary" style="max-width: 250px;">Passer commande →</a>
            </div>
        <?php endif; ?>
    </main>

    <footer>
        <p>&copy; <?php echo date('Y'); ?> <?php echo SITE_NAME; ?> - Commande à retirer en magasin</p>
    </footer>
</body>
</html>

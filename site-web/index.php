<?php
require_once 'config.php';

$pdo = db();
$stmt = $pdo->prepare("SELECT * FROM produits_web WHERE actif = 1 ORDER BY nom ASC");
$stmt->execute();
$produits = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catalogue - <?php echo SITE_NAME; ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <header>
        <div class="header-container">
            <a href="index.php" class="logo"><?php echo SITE_NAME; ?></a>
            <nav class="nav">
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
        <h1 class="page-title">Notre catalogue</h1>

        <?php if (empty($produits)): ?>
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <h2 class="empty-state-title">Aucun produit disponible</h2>
                <p class="empty-state-text">Le catalogue est en cours de mise à jour.</p>
            </div>
        <?php else: ?>
            <div class="produits-grid">
                <?php foreach ($produits as $produit): ?>
                    <?php $epuise = $produit['stock_restant'] <= 0; ?>
                    <div class="produit-card <?php echo $epuise ? 'epuise' : ''; ?>">
                        <div class="produit-image">
                            <?php if (!empty($produit['image']) && file_exists('uploads/produits/' . $produit['image'])): ?>
                                <img src="uploads/produits/<?php echo htmlspecialchars($produit['image']); ?>" alt="<?php echo htmlspecialchars($produit['nom']); ?>">
                            <?php else: ?>
                                🛍️
                            <?php endif; ?>
                            <?php if ($epuise): ?>
                                <span class="badge-epuise">ÉPUISÉ</span>
                            <?php endif; ?>
                        </div>
                        <div class="produit-content">
                            <h2 class="produit-nom"><?php echo htmlspecialchars($produit['nom']); ?></h2>
                            <div class="produit-prix"><?php echo number_format($produit['prix'], 2, ',', ' '); ?> €</div>
                            <?php if ($epuise): ?>
                                <button class="btn btn-primary" disabled>Épuisé</button>
                            <?php else: ?>
                                <form action="panier.php" method="post">
                                    <input type="hidden" name="action" value="ajouter">
                                    <input type="hidden" name="produit_id" value="<?php echo $produit['id']; ?>">
                                    <button type="submit" class="btn btn-primary">Ajouter au panier</button>
                                </form>
                            <?php endif; ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </main>

    <footer>
        <p>&copy; <?php echo date('Y'); ?> <?php echo SITE_NAME; ?> - Commande à retirer en magasin</p>
    </footer>
</body>
</html>

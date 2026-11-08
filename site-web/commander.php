<?php
require_once 'config.php';

$pdo = db();

if (empty($_SESSION['panier'])) {
    header('Location: panier.php');
    exit;
}

$erreur = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nom = trim($_POST['nom'] ?? '');
    $telephone = trim($_POST['telephone'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $note = trim($_POST['note'] ?? '');
    
    if ($nom === '' || $telephone === '') {
        $erreur = 'Le nom et le numéro de téléphone sont obligatoires.';
    } else {
        try {
            $pdo->beginTransaction();
            
            $ref = 'CMD-' . date('Ymd') . '-' . strtoupper(substr(md5(uniqid(rand(), true)), 0, 6));
            $total = panierTotal();
            
            $stmt = $pdo->prepare("INSERT INTO commandes_web (ref, nom_client, telephone, email, note, montant_total) VALUES (?, ?, ?, ?, ?, ?)");
            $stmt->execute([$ref, $nom, $telephone, $email, $note, $total]);
            $commande_id = $pdo->lastInsertId();
            
            foreach ($_SESSION['panier'] as $item) {
                $stmt = $pdo->prepare("INSERT INTO lignes_commandes_web (commande_web_id, produit_web_id, produit_local_id, nom_produit, quantite, prix_unitaire) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute([$commande_id, $item['id'], $item['produit_local_id'], $item['nom'], $item['quantite'], $item['prix']]);
            }
            
            $pdo->commit();
            unset($_SESSION['panier']);
            header('Location: confirmation.php?ref=' . urlencode($ref));
            exit;
        } catch (Exception $e) {
            $pdo->rollBack();
            $erreur = 'Une erreur est survenue lors de l\'enregistrement de votre commande.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Passer commande - <?php echo SITE_NAME; ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <header>
        <div class="header-container">
            <a href="index.php" class="logo"><?php echo SITE_NAME; ?></a>
            <nav class="nav">
                <a href="panier.php" class="nav-link">← Retour au panier</a>
            </nav>
        </div>
    </header>

    <main class="container">
        <h1 class="page-title">Finaliser ma commande</h1>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; align-items: start;">
            <div class="card" style="max-width: 100%;">
                <?php if ($erreur): ?>
                    <div class="alert" style="background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;">
                        <?php echo htmlspecialchars($erreur); ?>
                    </div>
                <?php endif; ?>

                <form method="post">
                    <div class="form-group">
                        <label class="form-label" for="nom">Nom et prénom *</label>
                        <input type="text" id="nom" name="nom" class="form-input" required value="<?php echo htmlspecialchars($_POST['nom'] ?? ''); ?>">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="telephone">Téléphone *</label>
                        <input type="tel" id="telephone" name="telephone" class="form-input" required value="<?php echo htmlspecialchars($_POST['telephone'] ?? ''); ?>">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="email">Email (facultatif)</label>
                        <input type="email" id="email" name="email" class="form-input" value="<?php echo htmlspecialchars($_POST['email'] ?? ''); ?>">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="note">Précisions (facultatif)</label>
                        <textarea id="note" name="note" class="form-textarea" placeholder="Heure de retrait souhaitée, etc."><?php echo htmlspecialchars($_POST['note'] ?? ''); ?></textarea>
                    </div>

                    <div class="alert alert-info">
                        <strong>Mode de retrait :</strong> À retirer en magasin<br>
                        <small>Paiement à retirer directement en magasin</small>
                    </div>

                    <button type="submit" class="btn btn-primary">Confirmer ma commande</button>
                </form>
            </div>

            <div style="position: sticky; top: 100px;">
                <div class="panier-total" style="margin-bottom: 0;">
                    <h3 style="margin-bottom: 1rem; text-align: left;">Récapitulatif</h3>
                    <?php foreach ($_SESSION['panier'] as $item): ?>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem; text-align: left; font-size: 0.9rem;">
                            <span><?php echo htmlspecialchars($item['nom']); ?> x<?php echo $item['quantite']; ?></span>
                            <span><?php echo number_format($item['prix'] * $item['quantite'], 2, ',', ' '); ?> €</span>
                        </div>
                    <?php endforeach; ?>
                    <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 1rem 0;">
                    <div class="panier-total-row" style="font-size: 1.1rem;">
                        <span>Total</span>
                        <span><?php echo number_format(panierTotal(), 2, ',', ' '); ?> €</span>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <footer>
        <p>&copy; <?php echo date('Y'); ?> <?php echo SITE_NAME; ?> - Commande à retirer en magasin</p>
    </footer>
</body>
</html>

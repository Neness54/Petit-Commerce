<?php
require_once 'config.php';

$ref = $_GET['ref'] ?? '';
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Commande confirmée - <?php echo SITE_NAME; ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <header>
        <div class="header-container">
            <a href="index.php" class="logo"><?php echo SITE_NAME; ?></a>
        </div>
    </header>

    <main class="container">
        <div class="card" style="margin: 2rem auto; text-align: center; max-width: 500px;">
            <div style="font-size: 4rem; margin-bottom: 1rem;">✅</div>
            <h1 style="font-size: 1.8rem; margin-bottom: 1rem;">Commande confirmée !</h1>
            <p style="color: var(--gray-600); margin-bottom: 1.5rem;">
                Merci pour votre commande. Nous la préparons et vous l'attendrons en magasin.
            </p>
            <?php if ($ref): ?>
                <div class="alert alert-info" style="text-align: left;">
                    <strong>Référence de commande :</strong><br>
                    <span style="font-size: 1.2rem; font-weight: 700; letter-spacing: 1px;"><?php echo htmlspecialchars($ref); ?></span>
                </div>
            <?php endif; ?>
            <a href="index.php" class="btn btn-primary" style="max-width: 250px; margin: 0 auto;">Retour au catalogue</a>
        </div>
    </main>

    <footer>
        <p>&copy; <?php echo date('Y'); ?> <?php echo SITE_NAME; ?> - Commande à retirer en magasin</p>
    </footer>
</body>
</html>

<?php
session_start();

define('DB_HOST', 'localhost');
define('DB_NAME', 'TON_COMPTE_NOM_DE_BASE');
define('DB_USER', 'TON_UTILISATEUR_MYSQL');
define('DB_PASS', 'TON_MOT_DE_PASSE_MYSQL');
define('API_TOKEN', 'CHANGE_MOI_PAR_UN_TOKEN_TRES_FORT');

define('SITE_NAME', 'Petit Commerce');
define('BASE_URL', '/');

function db() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            die('Erreur de connexion à la base de données. Vérifie config.php');
        }
    }
    return $pdo;
}

function checkApiToken() {
    $token = $_GET['token'] ?? ($_SERVER['HTTP_X_API_TOKEN'] ?? '');
    if ($token === '' || $token !== API_TOKEN) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'message' => 'Token invalide']);
        exit;
    }
}

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function panierCount() {
    if (empty($_SESSION['panier'])) return 0;
    $total = 0;
    foreach ($_SESSION['panier'] as $item) {
        $total += $item['quantite'];
    }
    return $total;
}

function panierTotal() {
    if (empty($_SESSION['panier'])) return 0;
    $total = 0;
    foreach ($_SESSION['panier'] as $item) {
        $total += $item['prix'] * $item['quantite'];
    }
    return $total;
}

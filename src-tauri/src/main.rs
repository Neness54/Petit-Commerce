// Empêche la fenêtre console d'apparaître sur Windows en mode release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    petit_commerce_lib::run()
}

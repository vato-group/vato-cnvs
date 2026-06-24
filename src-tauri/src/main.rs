// Prevents an extra console window on Windows in release; keep console in dev for logs/panics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}

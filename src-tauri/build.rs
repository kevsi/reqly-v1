fn main() {
    tauri_build::build();

    // Les binaires de TEST générés par cargo n'héritent pas du manifeste
    // Windows embarqué par tauri-build pour le binaire principal. Or tao
    // importe comctl32!TaskDialogIndirect — une fonction qui n'existe que
    // dans comctl32 v6, activée uniquement par ce manifeste. Sans lui, le
    // loader Windows échoue au démarrage des tests avec
    // STATUS_ENTRYPOINT_NOT_FOUND. On embarque donc la dépendance
    // Common-Controls v6 dans les binaires de test (MSVC uniquement).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:test-manifest.manifest");
        println!("cargo:rerun-if-changed=test-manifest.manifest");
    }
}

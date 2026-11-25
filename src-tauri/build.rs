use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    tauri_build::build();

    #[cfg(windows)]
    windows_test_support()?;

    Ok(())
}

/// Integration-test binaries link the full lib, including Tauri. They do not
/// get tauri-build's application manifest, so Common Controls v6 is missing
/// and the loader cannot resolve `TaskDialogIndirect`. The GNU toolchain also
/// links `WebView2Loader.dll` dynamically; Cargo runs tests from the package
/// root, so a copy there is found by the loader.
#[cfg(windows)]
fn windows_test_support() -> Result<(), Box<dyn Error>> {
    use std::path::PathBuf;

    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").ok_or("OUT_DIR is set by Cargo")?);
    embed_test_manifest(&out_dir)?;

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        let manifest_dir = PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").ok_or("CARGO_MANIFEST_DIR is set by Cargo")?,
        );
        // Walk up to the directory named after the profile (target/debug,
        // target/release, ...), whatever depth the current layout uses.
        let profile = std::env::var("PROFILE").map_err(|_| "PROFILE is set by Cargo")?;
        let profile_os = std::ffi::OsString::from(profile.clone());
        let target_dir = out_dir
            .ancestors()
            .find(|dir| {
                dir.file_name()
                    .is_some_and(|name| name == profile_os.as_os_str())
            })
            .ok_or_else(|| {
                format!(
                    "OUT_DIR {} has no `{profile}` profile ancestor",
                    out_dir.display()
                )
            })?;
        let loader = target_dir.join("WebView2Loader.dll");
        if !loader.exists() {
            return Err(format!(
                "{} is missing; tauri-build should have copied it",
                loader.display()
            )
            .into());
        }
        copy_loader(&loader, &manifest_dir.join("WebView2Loader.dll"))?;
    }

    Ok(())
}

#[cfg(windows)]
fn embed_test_manifest(out_dir: &std::path::Path) -> Result<(), Box<dyn Error>> {
    const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

    let manifest = out_dir.join("test.manifest");
    let resource = out_dir.join("test.rc");
    std::fs::write(&manifest, MANIFEST)?;
    let manifest_path = manifest.to_string_lossy().replace('\\', "/");
    std::fs::write(&resource, format!("1 24 \"{manifest_path}\"\n"))?;

    embed_resource::compile_for_tests(&resource, embed_resource::NONE).manifest_required()?;
    Ok(())
}

#[cfg(windows)]
fn copy_loader(from: &std::path::Path, to: &std::path::Path) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(from, to)?;
    Ok(())
}

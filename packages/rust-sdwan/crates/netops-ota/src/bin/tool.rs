//! netops-ota-tool: Release imzalama anahtar çifti üretimi ve OTA binary imzalama CLI'ı.
//!
//! Kullanım:
//!   netops-ota-tool keygen <priv_out.key> <pub_out.hex>
//!   netops-ota-tool sign   <priv.key> <binary_path> <sig_out.hex>
//!   netops-ota-tool verify <pub.hex> <binary_path> <sig.hex>
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use std::fs;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("keygen") => {
            let (Some(priv_out), Some(pub_out)) = (args.get(2), args.get(3)) else {
                eprintln!("Kullanım: netops-ota-tool keygen <priv_out.key> <pub_out.hex>");
                return ExitCode::FAILURE;
            };
            let mut csprng = OsRng;
            let signing_key = SigningKey::generate(&mut csprng);
            let verifying_key = signing_key.verifying_key();

            if let Err(e) = fs::write(priv_out, hex::encode(signing_key.to_bytes())) {
                eprintln!("❌ Private key yazılamadı: {}", e);
                return ExitCode::FAILURE;
            }
            if let Err(e) = fs::write(pub_out, hex::encode(verifying_key.to_bytes())) {
                eprintln!("❌ Public key yazılamadı: {}", e);
                return ExitCode::FAILURE;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(priv_out, fs::Permissions::from_mode(0o600));
            }
            println!("✅ Anahtar çifti üretildi.");
            println!("   Private (gizli, chmod 600 kalmalı): {}", priv_out);
            println!("   Public  (agent koduna gömülecek hex): {}", hex::encode(verifying_key.to_bytes()));
            ExitCode::SUCCESS
        }
        Some("sign") => {
            let (Some(priv_path), Some(bin_path), Some(sig_out)) = (args.get(2), args.get(3), args.get(4)) else {
                eprintln!("Kullanım: netops-ota-tool sign <priv.key> <binary_path> <sig_out.hex>");
                return ExitCode::FAILURE;
            };
            let priv_hex = match fs::read_to_string(priv_path) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("❌ Private key okunamadı: {}", e);
                    return ExitCode::FAILURE;
                }
            };
            let priv_bytes: [u8; 32] = match hex::decode(priv_hex.trim()).ok().and_then(|v| v.try_into().ok()) {
                Some(b) => b,
                None => {
                    eprintln!("❌ Private key formatı geçersiz (64 hex karakter bekleniyor).");
                    return ExitCode::FAILURE;
                }
            };
            let signing_key = SigningKey::from_bytes(&priv_bytes);
            let binary_bytes = match fs::read(bin_path) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("❌ İmzalanacak binary okunamadı: {}", e);
                    return ExitCode::FAILURE;
                }
            };
            let signature = signing_key.sign(&binary_bytes);
            if let Err(e) = fs::write(sig_out, hex::encode(signature.to_bytes())) {
                eprintln!("❌ İmza dosyası yazılamadı: {}", e);
                return ExitCode::FAILURE;
            }
            println!("✅ İmzalandı: {} -> {}", bin_path, sig_out);
            ExitCode::SUCCESS
        }
        Some("verify") => {
            let (Some(pub_path), Some(bin_path), Some(sig_path)) = (args.get(2), args.get(3), args.get(4)) else {
                eprintln!("Kullanım: netops-ota-tool verify <pub.hex> <binary_path> <sig.hex>");
                return ExitCode::FAILURE;
            };
            let pub_hex = fs::read_to_string(pub_path).unwrap_or_default();
            let sig_hex = fs::read_to_string(sig_path).unwrap_or_default();
            let binary_bytes = match fs::read(bin_path) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("❌ Binary okunamadı: {}", e);
                    return ExitCode::FAILURE;
                }
            };
            let pub_bytes: [u8; 32] = match hex::decode(pub_hex.trim()).ok().and_then(|v| v.try_into().ok()) {
                Some(b) => b,
                None => {
                    eprintln!("❌ Public key formatı geçersiz.");
                    return ExitCode::FAILURE;
                }
            };
            let sig_bytes: [u8; 64] = match hex::decode(sig_hex.trim()).ok().and_then(|v| v.try_into().ok()) {
                Some(b) => b,
                None => {
                    eprintln!("❌ İmza formatı geçersiz.");
                    return ExitCode::FAILURE;
                }
            };
            let verifying_key = match VerifyingKey::from_bytes(&pub_bytes) {
                Ok(k) => k,
                Err(e) => {
                    eprintln!("❌ Public key parse edilemedi: {}", e);
                    return ExitCode::FAILURE;
                }
            };
            let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes);
            match verifying_key.verify(&binary_bytes, &signature) {
                Ok(()) => {
                    println!("✅ İmza GEÇERLİ.");
                    ExitCode::SUCCESS
                }
                Err(_) => {
                    println!("❌ İmza GEÇERSİZ.");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("netops-ota-tool <keygen|sign|verify> ...");
            ExitCode::FAILURE
        }
    }
}

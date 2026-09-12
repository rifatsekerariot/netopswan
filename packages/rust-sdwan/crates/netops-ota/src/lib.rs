use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OtaError {
    #[error("SHA-256 bütünlük doğrulaması başarısız! Beklenen: {0}, Hesaplanan: {1}")]
    IntegrityMismatch(String, String),
    #[error("Kriptografik Ed25519 imza geçersiz veya yetkisiz üretici!")]
    InvalidSignature,
    #[error("Manifest formatı geçersiz: {0}")]
    InvalidManifest(String),
    #[error("Geçersiz Semantic Versioning formatı: {0}")]
    InvalidVersion(String),
}

/// İndirilen ikili dosyanın SHA-256 hash'ini doğrular
pub fn verify_integrity(binary_bytes: &[u8], expected_sha256: &str) -> Result<(), OtaError> {
    if expected_sha256.is_empty() {
        return Ok(());
    }
    let mut hasher = Sha256::new();
    hasher.update(binary_bytes);
    let calculated = format!("{:x}", hasher.finalize());

    if calculated.eq_ignore_ascii_case(expected_sha256) {
        Ok(())
    } else {
        Err(OtaError::IntegrityMismatch(expected_sha256.to_string(), calculated))
    }
}

/// İmzalı paketin Ed25519 dijital imzasını üretici anahtarıyla doğrular
pub fn verify_ed25519_signature(
    data: &[u8],
    signature_bytes: &[u8; 64],
    public_key_bytes: &[u8; 32],
) -> Result<(), OtaError> {
    let verifying_key = VerifyingKey::from_bytes(public_key_bytes)
        .map_err(|_| OtaError::InvalidSignature)?;
    let signature = Signature::from_bytes(signature_bytes);

    verifying_key
        .verify_strict(data, &signature)
        .map_err(|_| OtaError::InvalidSignature)
}

/// Hex-encoded imza string'ini (Hub'ın OtaUpdateInfo.signature alanından gelen) ham 64
/// byte'a çözer. Uzunluk/format hatalıysa (128 hex karakter değilse, veya geçersiz hex)
/// açıkça InvalidSignature döner - agent tarafında "boş/bozuk imza = OTA reddedilir"
/// davranışının tek giriş noktası budur.
pub fn decode_hex_signature(hex_sig: &str) -> Result<[u8; 64], OtaError> {
    let bytes = hex::decode(hex_sig.trim()).map_err(|_| OtaError::InvalidSignature)?;
    bytes.try_into().map_err(|_| OtaError::InvalidSignature)
}

/// Ham 32 byte'lık public key'i hex string olarak kodlar (keygen aracı ve dokümantasyon
/// için - agent'a compile-time gömülecek TRUSTED_RELEASE_PUBKEY sabitini üretmede kullanılır).
pub fn encode_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Hex-encoded bir dizeyi (public key veya private key seed) ham byte dizisine çözer.
pub fn decode_hex_32(hex_str: &str) -> Result<[u8; 32], OtaError> {
    let bytes = hex::decode(hex_str.trim()).map_err(|_| OtaError::InvalidSignature)?;
    bytes.try_into().map_err(|_| OtaError::InvalidSignature)
}

/// Semantic Versioning (SemVer) kurallarına göre OTA yükseltme kararı verir
/// Sadece hedef sürüm mevcut sürümden kesinlikle büyükse veya force_upgrade aktifse true döner
pub fn should_upgrade_ota(current_ver_str: &str, target_ver_str: &str, force_upgrade: bool) -> Result<bool, OtaError> {
    if force_upgrade {
        return Ok(true);
    }

    let clean_current = current_ver_str.trim().trim_start_matches('v');
    let clean_target = target_ver_str.trim().trim_start_matches('v');

    let current = Version::parse(clean_current)
        .map_err(|e| OtaError::InvalidVersion(format!("Mevcut: {} ({})", current_ver_str, e)))?;
    let target = Version::parse(clean_target)
        .map_err(|e| OtaError::InvalidVersion(format!("Hedef: {} ({})", target_ver_str, e)))?;

    Ok(target > current)
}

/// İki sürüm arasında major breaking change olup olmadığını tespit eder
pub fn is_major_upgrade(current_ver_str: &str, target_ver_str: &str) -> Result<bool, OtaError> {
    let clean_current = current_ver_str.trim().trim_start_matches('v');
    let clean_target = target_ver_str.trim().trim_start_matches('v');

    let current = Version::parse(clean_current)
        .map_err(|_| OtaError::InvalidVersion(current_ver_str.into()))?;
    let target = Version::parse(clean_target)
        .map_err(|_| OtaError::InvalidVersion(target_ver_str.into()))?;

    Ok(target.major > current.major)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand_core::OsRng;

    #[test]
    fn test_ota_sha256_and_ed25519() {
        let dummy_binary = b"NetOpsWan Agent v0.5.0-musl";
        let mut hasher = Sha256::new();
        hasher.update(dummy_binary);
        let sha256_str = format!("{:x}", hasher.finalize());

        assert!(verify_integrity(dummy_binary, &sha256_str).is_ok());
        assert!(verify_integrity(dummy_binary, "yanlis-hash").is_err());

        // Ed25519 İmzalama & Doğrulama
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        let signature = signing_key.sign(dummy_binary);

        assert!(verify_ed25519_signature(dummy_binary, &signature.to_bytes(), &verifying_key.to_bytes()).is_ok());
    }

    #[test]
    fn test_ed25519_tamper_detection() {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        let original_binary = b"NetOpsWan Agent v0.5.0-genuine-release";
        let signature = signing_key.sign(original_binary);

        // 1. Doğru binary + doğru imza -> geçerli
        assert!(verify_ed25519_signature(original_binary, &signature.to_bytes(), &verifying_key.to_bytes()).is_ok());

        // 2. Binary MITM/tamper ile değiştirilmiş (imza aynı kalmış) -> reddedilmeli
        let tampered_binary = b"NetOpsWan Agent v0.5.0-malicious-tamper";
        assert!(verify_ed25519_signature(tampered_binary, &signature.to_bytes(), &verifying_key.to_bytes()).is_err());

        // 3. Yetkisiz/farklı bir anahtarla üretilmiş imza -> reddedilmeli (sahte üretici)
        let attacker_key = SigningKey::generate(&mut csprng);
        let attacker_signature = attacker_key.sign(original_binary);
        assert!(verify_ed25519_signature(original_binary, &attacker_signature.to_bytes(), &verifying_key.to_bytes()).is_err());

        // 4. Hex round-trip: Hub'ın TelemetryResponse üzerinden ilettiği string temsili
        let hex_sig = encode_hex(&signature.to_bytes());
        let decoded = decode_hex_signature(&hex_sig).expect("geçerli hex imza çözülebilmeli");
        assert_eq!(decoded, signature.to_bytes());

        // 5. Bozuk/eksik hex imza (örn. ağ kesintisiyle yarım kalmış alan) -> reddedilmeli
        assert!(decode_hex_signature("").is_err());
        assert!(decode_hex_signature("deadbeef").is_err()); // 64 byte değil
        assert!(decode_hex_signature("not-even-hex-zzzz").is_err());
    }

    #[test]
    fn test_semver_ota_decision() {
        // v0.4.9 -> v0.5.0 yükseltilmeli
        assert!(should_upgrade_ota("0.4.9", "0.5.0", false).unwrap());

        // v0.5.0 -> v0.4.9 (eski sürüme düşüş) normalde engellenmeli
        assert!(!should_upgrade_ota("0.5.0", "0.4.9", false).unwrap());

        // force_upgrade aktifse downgrade'e dahi izin verilmeli
        assert!(should_upgrade_ota("0.5.0", "0.4.9", true).unwrap());

        // Major sürüm geçiş tespiti
        assert!(is_major_upgrade("0.4.9", "1.0.0").unwrap());
        assert!(!is_major_upgrade("0.4.9", "0.5.0").unwrap());
    }
}


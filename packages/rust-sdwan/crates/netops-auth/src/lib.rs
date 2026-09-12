pub mod mtls;

use argon2::{

    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("Parola hashleme hatası: {0}")]
    HashError(String),
    #[error("Geçersiz parola veya doğrulama başarısız")]
    VerificationFailed,
    #[error("Kriptografik anahtar türetme hatası: {0}")]
    KeyDerivationError(String),
    #[error("JWT token hatası: {0}")]
    JwtError(String),
}

/// Bellekte güvenli saklanan ve iş bittiğinde otomatik sıfırlanan gizli anahtar sarmalayıcısı
#[derive(Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct ProtectedSecret(pub String);

impl ProtectedSecret {
    pub fn new(secret: impl Into<String>) -> Self {
        Self(secret.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Cihaz ve Kullanıcı için Kısa Ömürlü JWT Kimlik Bilgileri (Claims)
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DeviceClaims {
    pub sub: String,       // Device ID veya User
    pub mac: String,       // Cihazın MAC Adresi
    pub role: String,      // "edge-agent" veya "admin"
    pub exp: usize,        // UNIX epoch bitiş zamanı
    pub iat: usize,        // Oluşturulma zamanı
}

/// Parolayı güvenli Argon2id algoritmasıyla hash'ler
pub fn hash_password_argon2(password: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AuthError::HashError(e.to_string()))
}

/// Parolayı Argon2id hash ile doğrular
pub fn verify_password_argon2(password: &str, password_hash: &str) -> bool {
    if let Ok(parsed_hash) = PasswordHash::new(password_hash) {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok()
    } else {
        false
    }
}

/// Her cihaza özel benzersiz Zero-Trust Kimlik Jetonu türetir
/// Master Secret + Cihaz ID + MAC Adresi -> Benzersiz Cihaz Jetonu (HMAC-SHA256)
pub fn derive_device_token(master_secret: &str, device_id: &str, mac: &str) -> String {
    let mut mac_clean = mac.trim().to_uppercase().replace(['-', ':'], "");
    if mac_clean.is_empty() {
        mac_clean = "000000000000".to_string();
    }

    let message = format!("netopswan-device:{}:{}", device_id.trim(), mac_clean);
    
    let mut mac_ctx = match HmacSha256::new_from_slice(master_secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => {
            let fallback_key = Sha256::digest(master_secret.as_bytes());
            HmacSha256::new_from_slice(&fallback_key).expect("HMAC init with 32-byte key never fails")
        }
    };
    
    mac_ctx.update(message.as_bytes());
    let result = mac_ctx.finalize();
    hex::encode(result.into_bytes())
}

/// Cihaz Kimlik Doğrulayıcı (Constant-Time Timing Attack Korumalı subtle):
/// 1. Cihaza özel türetilmiş token doğrulaması (ct_eq)
/// 2. Geriye dönük uyumluluk: Doğrudan master secret doğrulaması (ct_eq)
pub fn verify_device_auth(
    master_secret: &str,
    device_id: &str,
    mac: &str,
    incoming_token: &str,
) -> bool {
    if master_secret.is_empty() {
        return true;
    }
    
    let incoming_trimmed = incoming_token.trim();
    if incoming_trimmed.is_empty() {
        return false;
    }

    // A) Cihaz-Özel Token Kontrolü (Device-Specific Zero-Trust Token - Constant-Time)
    let expected_token = derive_device_token(master_secret, device_id, mac);
    if incoming_trimmed.as_bytes().ct_eq(expected_token.as_bytes()).into() {
        return true;
    }

    // B) Geriye Dönük Uyumluluk (Doğrudan Master Secret - Constant-Time)
    if incoming_trimmed.as_bytes().ct_eq(master_secret.trim().as_bytes()).into() {
        return true;
    }

    false
}

/// Kısa ömürlü (Short-lived) JWT İmzalı Cihaz Jetonu Üretir
pub fn create_short_lived_device_jwt(
    master_secret: &str,
    device_id: &str,
    mac: &str,
    duration_secs: usize,
) -> Result<String, AuthError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize;

    let claims = DeviceClaims {
        sub: device_id.to_string(),
        mac: mac.to_string(),
        role: "edge-agent".to_string(),
        exp: now + duration_secs,
        iat: now,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(master_secret.as_bytes()),
    )
    .map_err(|e| AuthError::JwtError(e.to_string()))
}

/// Kısa ömürlü JWT Cihaz Jetonunu Doğrular
pub fn verify_device_jwt(
    master_secret: &str,
    token: &str,
) -> Result<DeviceClaims, AuthError> {
    let mut validation = Validation::default();
    validation.validate_exp = true;

    decode::<DeviceClaims>(
        token,
        &DecodingKey::from_secret(master_secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|e| AuthError::JwtError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2_hashing_and_verify() {
        let password = "TestOnlyPassword123!";
        let hash = hash_password_argon2(password).unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password_argon2(password, &hash));
        assert!(!verify_password_argon2("YanlisSifre", &hash));
    }

    #[test]
    fn test_device_token_derivation_and_isolation() {
        let master_secret = "NetOpsSecret-Root-2026";
        let dev1_id = "edge-F89E2882BAA8";
        let dev1_mac = "F8:9E:28:82:BA:A8";

        let dev2_id = "Netfix";
        let dev2_mac = "00:11:22:33:44:55";

        let token1 = derive_device_token(master_secret, dev1_id, dev1_mac);
        let token2 = derive_device_token(master_secret, dev2_id, dev2_mac);

        // Her cihazın token'ı benzersiz olmalı
        assert_ne!(token1, token2);
        assert_eq!(token1.len(), 64); // 32-byte hex

        // Cihaz 1 kendi token'ı ile doğrulanmalı
        assert!(verify_device_auth(master_secret, dev1_id, dev1_mac, &token1));

        // Cihaz 1, Cihaz 2'nin token'ı ile doğrulanamamalı (Cihaz İzolasyonu!)
        assert!(!verify_device_auth(master_secret, dev1_id, dev1_mac, &token2));

        // Sahte MAC ile aynı token doğrulanamamalı
        assert!(!verify_device_auth(master_secret, dev1_id, "AA:BB:CC:DD:EE:FF", &token1));

        // Master secret ile geriye dönük uyumluluk doğrulanmalı
        assert!(verify_device_auth(master_secret, dev1_id, dev1_mac, master_secret));
    }

    #[test]
    fn test_short_lived_device_jwt_lifecycle() {
        let master_secret = "UltraSecureKey-999888777666555444";
        let dev_id = "meraki-branch-01";
        let mac = "AA:BB:CC:DD:EE:01";

        // 1. JWT Üret (10 saniye geçerli)
        let token = create_short_lived_device_jwt(master_secret, dev_id, mac, 10).unwrap();
        assert!(!token.is_empty());

        // 2. JWT Doğrula
        let claims = verify_device_jwt(master_secret, &token).unwrap();
        assert_eq!(claims.sub, dev_id);
        assert_eq!(claims.mac, mac);
        assert_eq!(claims.role, "edge-agent");

        // 3. Yanlış Master Key ile Doğrulama Başarısız Olmalı
        let invalid_res = verify_device_jwt("YanlisGizliAnahtar", &token);
        assert!(invalid_res.is_err());
    }

    #[test]
    fn test_zeroize_protected_secret() {
        let mut secret = ProtectedSecret::new("super-secret-password-12345");
        assert_eq!(secret.as_str(), "super-secret-password-12345");
        secret.zeroize();
        assert_eq!(secret.as_str(), "");
    }
}


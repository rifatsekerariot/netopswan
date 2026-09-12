use rcgen::{CertificateParams, DnType, IsCa, KeyPair as RcgenKeyPair, ExtendedKeyUsagePurpose, KeyUsagePurpose, SanType};
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedCertificate {
    pub common_name: String,
    pub serial_number: String,
    pub certificate_pem: String,
    pub private_key_pem: String,
    pub fingerprint_sha256: String,
}

/// Generates a Root Certificate Authority (CA) for NetOpsWan SD-WAN
pub fn generate_root_ca(ca_name: &str) -> Result<GeneratedCertificate, String> {
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.distinguished_name.push(DnType::CommonName, ca_name);
    params.distinguished_name.push(DnType::OrganizationName, "NetOpsWan SD-WAN Mesh Security Authority");
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];

    let keypair = RcgenKeyPair::generate().map_err(|e| e.to_string())?;
    let cert = params.self_signed(&keypair).map_err(|e| e.to_string())?;

    let cert_pem = cert.pem();
    let key_pem = keypair.serialize_pem();
    let fingerprint = compute_cert_fingerprint(&cert_pem);

    let mut serial_bytes = [0u8; 16];
    getrandom::getrandom(&mut serial_bytes).map_err(|e| e.to_string())?;

    Ok(GeneratedCertificate {
        common_name: ca_name.to_string(),
        serial_number: hex::encode(serial_bytes),
        certificate_pem: cert_pem,
        private_key_pem: key_pem,
        fingerprint_sha256: fingerprint,
    })
}

/// Issues an X.509 Device Client Certificate for a specific SD-WAN Branch Agent
pub fn issue_device_certificate(
    _ca_cert_pem: &str,

    ca_key_pem: &str,
    device_id: &str,
    mac_address: &str,
) -> Result<GeneratedCertificate, String> {
    let ca_keypair = RcgenKeyPair::from_pem(ca_key_pem).map_err(|e| e.to_string())?;
    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_params.distinguished_name.push(DnType::CommonName, "NetOpsWan Root CA");
    let ca_cert = ca_params.self_signed(&ca_keypair).map_err(|e| e.to_string())?;

    let cn = format!("netops-device-{}-{}", device_id, mac_address.replace([':', '-'], ""));
    let mut device_params = CertificateParams::default();
    device_params.distinguished_name.push(DnType::CommonName, &cn);
    device_params.distinguished_name.push(DnType::OrganizationName, "NetOpsWan Branch Edge");
    device_params.subject_alt_names = vec![SanType::DnsName(cn.clone().try_into().map_err(|_| "Invalid SAN DNS")?)];
    device_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth, ExtendedKeyUsagePurpose::ServerAuth];

    let device_keypair = RcgenKeyPair::generate().map_err(|e| e.to_string())?;
    let device_cert = device_params.signed_by(&device_keypair, &ca_cert, &ca_keypair).map_err(|e| e.to_string())?;

    let cert_pem = device_cert.pem();
    let key_pem = device_keypair.serialize_pem();
    let fingerprint = compute_cert_fingerprint(&cert_pem);

    let mut serial_bytes = [0u8; 16];
    getrandom::getrandom(&mut serial_bytes).map_err(|e| e.to_string())?;

    Ok(GeneratedCertificate {
        common_name: cn,
        serial_number: hex::encode(serial_bytes),
        certificate_pem: cert_pem,
        private_key_pem: key_pem,
        fingerprint_sha256: fingerprint,
    })
}

/// Computes SHA-256 Fingerprint for an X.509 PEM Certificate
pub fn compute_cert_fingerprint(cert_pem: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cert_pem.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod mtls_tests {
    use super::*;

    #[test]
    fn test_ca_and_device_certificate_lifecycle() {
        let ca = generate_root_ca("NetOpsWan Root CA Test").expect("CA generation should succeed");
        assert!(!ca.certificate_pem.is_empty());
        assert!(!ca.private_key_pem.is_empty());
        assert_eq!(ca.fingerprint_sha256.len(), 64);

        let dev_cert = issue_device_certificate(
            &ca.certificate_pem,
            &ca.private_key_pem,
            "Netfix",
            "F8:9E:28:82:B8:70",
        ).expect("Device certificate issue should succeed");

        assert!(dev_cert.common_name.contains("Netfix"));
        assert!(!dev_cert.certificate_pem.is_empty());
        assert!(!dev_cert.private_key_pem.is_empty());
        assert_ne!(ca.fingerprint_sha256, dev_cert.fingerprint_sha256);
    }
}

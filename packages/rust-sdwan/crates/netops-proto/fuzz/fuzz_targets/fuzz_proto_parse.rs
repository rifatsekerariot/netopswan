#![no_main]

use libfuzzer_sys::fuzz_target;
use netops_proto::{
    DiagnosticCommandRequest, PeerRegistrationRequest, SecurityEvent, TelemetryReport,
};

fuzz_target!(|data: &[u8]| {
    // 1. PeerRegistrationRequest JSON fuzzing
    let _ = serde_json::from_slice::<PeerRegistrationRequest>(data);

    // 2. TelemetryReport JSON fuzzing
    let _ = serde_json::from_slice::<TelemetryReport>(data);

    // 3. SecurityEvent JSON fuzzing
    let _ = serde_json::from_slice::<SecurityEvent>(data);

    // 4. DiagnosticCommandRequest JSON fuzzing
    let _ = serde_json::from_slice::<DiagnosticCommandRequest>(data);
});

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use netops_proto::{Ipv4Subnet, LanClient, PeerRegistrationRequest, SecurityEvent, TelemetryReport};

fn bench_peer_registration(c: &mut Criterion) {
    let req = PeerRegistrationRequest {
        device_id: "Netfix".to_string(),
        serial_number: "MX64-8899-0011".to_string(),
        model: "Cisco Meraki MX64".to_string(),
        mac_address: "F8:9E:28:82:B8:70".to_string(),
        management_ip: "172.16.10.98".to_string(),
        public_key: "dAaDQ2BVvFMEGU8gvCbz1N/mOpXV7r3mxBmIqRdkjzM=".to_string(),
        local_ip_ranges: vec!["192.168.30.0/24".to_string(), "10.8.0.0/24".to_string()],
        tunnel_listen_port: 51820,
        agent_version: "v0.4.9".to_string(),
    };

    let json_str = serde_json::to_string(&req).unwrap();

    c.bench_function("peer_registration_serialize", |b| {
        b.iter(|| {
            serde_json::to_string(black_box(&req)).unwrap()
        })
    });

    c.bench_function("peer_registration_deserialize", |b| {
        b.iter(|| {
            let res: PeerRegistrationRequest = serde_json::from_str(black_box(&json_str)).unwrap();
            black_box(res)
        })
    });
}

fn bench_telemetry_report(c: &mut Criterion) {
    let mut security_events = Vec::with_capacity(100);
    for i in 0..100 {
        security_events.push(SecurityEvent {
            timestamp: 1787151237 + i,
            event_type: "DNS_QUERY".to_string(),
            src_ip: format!("192.168.30.{}", (i % 200) + 10),
            src_mac: "F8:9E:28:82:B8:70".to_string(),
            dst_ip: "1.1.1.1".to_string(),
            dst_port: 53,
            protocol: "UDP".to_string(),
            domain_query: format!("edge-node-{}.ariot.com.tr", i),
            action_taken: "PASS".to_string(),
            severity: "INFO".to_string(),
        });
    }

    let mut lan_clients = Vec::with_capacity(50);
    for i in 0..50 {
        lan_clients.push(LanClient {
            mac_address: format!("AA:BB:CC:DD:EE:{:02X}", i),
            ip_address: format!("192.168.30.{}", i + 100),
            hostname: format!("pos-terminal-{}", i),
        });
    }

    let report = TelemetryReport {
        device_id: "Netfix".to_string(),
        serial_number: "MX64-8899-0011".to_string(),
        model: "Cisco Meraki MX64".to_string(),
        mac_address: "F8:9E:28:82:B8:70".to_string(),
        management_ip: "172.16.10.98".to_string(),
        lan_ip: "192.168.30.1".to_string(),
        lan_clients,
        security_events,
        timestamp: 1787151237,
        cpu_usage_pct: 12.5,
        ram_used_mb: 128,
        ram_total_mb: 512,
        active_wan_interface: "eth0".to_string(),
        rtt_ms: 14.2,
        jitter_ms: 1.1,
        packet_loss_pct: 0.0,
        tx_bytes: 5491028,
        rx_bytes: 10492810,
        firewall_mode: "LOCKED".to_string(),
    };

    let json_bytes = serde_json::to_vec(&report).unwrap();

    c.bench_function("telemetry_report_serialize_100_events", |b| {
        b.iter(|| {
            serde_json::to_vec(black_box(&report)).unwrap()
        })
    });

    c.bench_function("telemetry_report_deserialize_100_events", |b| {
        b.iter(|| {
            let res: TelemetryReport = serde_json::from_slice(black_box(&json_bytes)).unwrap();
            black_box(res)
        })
    });
}

fn bench_subnet_math(c: &mut Criterion) {
    c.bench_function("ipv4_subnet_parse_and_math", |b| {
        b.iter(|| {
            let subnet = Ipv4Subnet::parse(black_box("172.20.0.0/16")).unwrap();
            let ip = subnet.nth_ip_with_cidr(black_box(150));
            black_box(ip)
        })
    });
}

criterion_group!(benches, bench_peer_registration, bench_telemetry_report, bench_subnet_math);
criterion_main!(benches);

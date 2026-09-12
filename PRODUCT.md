# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Network/IT operators at a single company (ARIOT) who manage that company's own fleet of branch-office network devices (retail/enterprise branches, potentially 100s of sites) from one central dashboard. This is an internal operations tool, not a multi-tenant/MSP product — one organization managing its own infrastructure.

## Product Purpose

NetOpsWan is a self-hosted SD-WAN hub-and-spoke platform: a central hub server coordinates WireGuard tunnels to edge agents running on branch routers (repurposed Cisco Meraki MX64 hardware reflashed to OpenWrt). The dashboard gives operators one place to see branch connectivity/health, and to manage DHCP/DNS, firewall/NAC (device allow/block), PKI certificates, OTA firmware rollout, and inter-branch bridging. Success means an operator can diagnose and fix a branch's network problem, or roll out a network-wide policy change, without SSHing into individual devices.

## Positioning

Independence from vendor licensing and lock-in: existing Meraki MX64 hardware is reflashed to run this platform's own agent instead of Meraki's cloud-tied firmware, eliminating per-device Meraki licensing while keeping (and in some areas exceeding, e.g. automatic zero-config camera/NVR bandwidth management, Ed25519-signed OTA) the operational quality of a commercial SD-WAN product. Full control of the source and infrastructure — nothing depends on a third-party SaaS control plane.

## Operating Context

- Branch hardware: Cisco Meraki MX64 (Broadcom BCM58625, ARMv7 Cortex-A9), reflashed to OpenWrt SNAPSHOT, running `netops-agent`.
- Central hub: a Rust (`netops-hub`) service on a Linux server (currently `sdwan.ariot.com.tr`), coordinating WireGuard peers, telemetry, and an DuckDB-backed security log engine.
- Branch LAN devices commonly include POS terminals, NVR/IP cameras, VoIP phones, and network printers — reflected directly in the DHCP quick-assign presets.
- Operators reach the system through a browser dashboard (this Next.js app) with role-gated access (admin vs. operator); some actions (device diagnostics, NAC block/unblock, LAN reconfiguration) execute live on the remote branch hardware over the WireGuard tunnel.
- Deployment/change management happens by an engineer (not end customers) directly building and pushing to the hub and to individual branch devices.

## Capabilities and Constraints

- WireGuard-based SD-WAN overlay with automatic tunnel self-healing, HA hub failover (VRRP/keepalived), and per-device rate limiting.
- Zero-touch device registration and hardware/network discovery (no manual per-branch config for MAC, WAN interface, LAN subnet).
- DHCP/DNS central management, static lease (sabit IP) assignment, per-branch or per-group bulk deployment.
- Zero-Trust NAC: block/unblock individual client devices by MAC at the branch firewall.
- PKI certificate issuance/tracking, Ed25519-signed OTA firmware updates with atomic, sandboxed rollback.
- Automatic, zero-configuration camera/NVR bandwidth policing (RTSP port-signature based, no manual IP/camera setup).
- Interbranch bridging: route one branch's LAN subnet to another's over the hub.
- Constraint: branch hardware runs OpenWrt with `apk` (not `opkg`), soft-float ARMv7, and does not have unlimited resources — agent code must stay lightweight and self-healing without human intervention when connectivity or firmware states go wrong.
- Constraint: firewall/nftables state on branch devices is regenerated from UCI on every `firewall reload`, so any ad-hoc rule the agent needs to persist must live in its own dedicated nft table, not injected into fw4's own tables.

## Brand Commitments

- Product/dashboard name: "NetOpsWan" / "NetOps WAN SD-WAN" — company: ARIOT.
- UI language: Turkish, for a Turkish-speaking network operations team.
- No existing style guide, logo system, or marketing brand voice beyond the current dashboard's own visual language (see DESIGN.md via `/impeccable document` if that's wanted next).

## Evidence on Hand

- Real production branch device observed and used as reference during development: hostname `ARIOT_SUBE`, Cisco Meraki MX64 hardware, OpenWrt 6.12.103 kernel.
- Real hub server: `sdwan.ariot.com.tr` (200.97.171.59), running the hub service under pm2 alongside the Next.js dashboard.
- No fabricated customer testimonials, case studies, or press exist and none should be invented — this is an internal ops tool with a single operating company.

## Product Principles

1. Zero-configuration by default — a new branch should register, get a tunnel, and start reporting telemetry without an operator typing per-device settings.
2. Fail-closed on security, fail-open on availability — e.g. OTA updates reject unsigned/unverified binaries outright, but a branch losing hub connectivity keeps routing local traffic and keeps retrying reconnection rather than bricking itself.
3. No blind automatic remediation for physical-link-level settings (e.g. WAN speed/duplex) — a prior live test proved this can cause outages; changes with physical-layer risk require an operator action, not a silent auto-fix.
4. Independence from any vendor's licensing or cloud control plane is a hard constraint, not a preference.
5. Match or exceed commercial SD-WAN (Meraki-class) operational quality — this is the explicit bar operators judge the platform against.

## Accessibility & Inclusion

No formal accessibility standard has been mandated for this internal tool; general good practice (focus states, contrast, keyboard operability) is followed but not yet audited against a specific standard (e.g. WCAG level). Treat as undecided rather than compliant.

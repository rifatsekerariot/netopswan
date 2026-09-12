import { NextResponse } from 'next/server';
import { isSystemConfigured, getSystemConfig } from '@/lib/config-manager';
import os from 'os';

export async function GET() {
  try {
    const configured = isSystemConfigured();
    const config = getSystemConfig();

    // Dinamik Ağ Arayüzlerini ve IP Adreslerini Keşfet (Sıfır Hardcode)
    const interfaces = os.networkInterfaces();
    const detectedIps: Array<{ iface: string; ip: string; family: string; isInternal: boolean }> = [];
    
    for (const [ifaceName, ifaceDetails] of Object.entries(interfaces)) {
      if (ifaceDetails) {
        for (const detail of ifaceDetails) {
          if (detail.family === 'IPv4' && !detail.internal) {
            detectedIps.push({
              iface: ifaceName,
              ip: detail.address,
              family: detail.family,
              isInternal: detail.internal
            });
          }
        }
      }
    }

    const defaultIp = detectedIps.length > 0 ? detectedIps[0].ip : (os.hostname() || '127.0.0.1');

    const systemInfo = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
      cpus: os.cpus().length,
      networkInterfaces: detectedIps
    };

    return NextResponse.json({
      configured,
      systemInfo,
      currentConfig: configured ? {
        adminUsername: config.adminUsername,
        externalDomain: config.externalDomain,
        externalPort: config.externalPort,
        configuredAt: config.configuredAt,
        vpnSubnet: config.vpnSubnet,
        vpnPort: config.vpnPort
      } : {
        defaultDomain: defaultIp,
        defaultPort: 443,
        defaultVpnSubnet: '10.8.0.0/24',
        defaultVpnPort: 51820
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Sistem durumu okunamadı', details: error.message }, { status: 500 });
  }
}

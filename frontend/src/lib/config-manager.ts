import fs from 'fs';
import path from 'path';

export interface NetOpsWanSystemConfig {
  isConfigured: boolean;
  configuredAt?: string;
  adminUsername: string;
  adminEmail: string;
  externalDomain: string;
  externalPort: number;
  openwispInternalUrl: string;
  openwispApiToken: string;
  sharedSecret: string;
  autoRegistration: boolean;
  vpnSubnet: string;
  vpnPort: number;
}

const CONFIG_PATH = path.join(process.cwd(), 'config', 'netopswan_system.json');
const LOCK_FILE_PATH = path.join(process.cwd(), 'config', '.configured');

const EMPTY_CONFIG: NetOpsWanSystemConfig = {
  isConfigured: false,
  adminUsername: '',
  adminEmail: '',
  externalDomain: '',
  externalPort: 8443,
  openwispInternalUrl: process.env.OPENWISP_INTERNAL_URL || 'http://127.0.0.1:8000',
  openwispApiToken: '',
  sharedSecret: '',
  autoRegistration: false,
  vpnSubnet: '10.8.0.0/24',
  vpnPort: 1194
};

export function getSystemConfig(): NetOpsWanSystemConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      return { ...EMPTY_CONFIG, ...parsed, isConfigured: fs.existsSync(LOCK_FILE_PATH) };
    }
  } catch (error) {
    console.error('Error reading system config:', error);
  }
  return { ...EMPTY_CONFIG, isConfigured: fs.existsSync(LOCK_FILE_PATH) };
}

export function saveSystemConfig(newConfig: Partial<NetOpsWanSystemConfig>): NetOpsWanSystemConfig {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const current = getSystemConfig();
  const updated: NetOpsWanSystemConfig = {
    ...current,
    ...newConfig,
    configuredAt: new Date().toISOString(),
    isConfigured: true
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  // Kilit dosyasını oluştur
  fs.writeFileSync(LOCK_FILE_PATH, `CONFIGURED_AT=${updated.configuredAt}\n`, 'utf-8');

  return updated;
}

export function isSystemConfigured(): boolean {
  return fs.existsSync(LOCK_FILE_PATH);
}

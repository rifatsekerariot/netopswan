export function validateMacAddress(mac: string): boolean {
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return macRegex.test(mac);
}

// WireGuard public/private key: 32 raw bytes, base64-encoded -> always 44 chars, ends in '='.
// Kritik: bu değerler shell komutu string interpolasyonuna (execAsync/execSync) verilmeden
// önce MUTLAKA doğrulanmalıdır - aksi halde donanımdan/Hub'dan gelen (dolayısıyla
// potansiyel olarak saldırgan kontrollü) bir değer, host üzerinde root olarak
// komut enjeksiyonuna yol açabilir.
export function validateWireguardKey(key: string): boolean {
  const keyRegex = /^[A-Za-z0-9+/]{43}=$/;
  return keyRegex.test(key);
}

export function validateIPv4(ip: string): boolean {
  const ipRegex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
  return ipRegex.test(ip);
}

export function validateCIDR(cidr: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;

  const [ip, prefix] = cidr.split('/');
  const prefixNum = parseInt(prefix);

  if (!validateIPv4(ip)) return false;
  if (prefixNum < 0 || prefixNum > 32) return false;

  return true;
}

// Zero-Hardcode: netmask'ı /24 varsayarak sabit kodlamak yerine, bir CIDR
// önekinden (0-32) dinamik olarak nokta-ondalık netmask türetir. Şubenin
// gerçek alt ağı /24 olmayan bir boyutta tanımlanmışsa (örn. /23, /25),
// donanıma her zaman 255.255.255.0 gönderen sabit kodlanmış bir değer
// yanlış/çalışmayan bir ağ yapılandırmasına yol açar.
export function prefixToNetmask(prefixLen: number): string {
  const clamped = Math.max(0, Math.min(32, Math.floor(prefixLen)));
  const mask = clamped === 0 ? 0 : (0xffffffff << (32 - clamped)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 0xff).join('.');
}

export function netmaskFromCIDR(cidr: string, fallback = '255.255.255.0'): string {
  const parts = cidr.split('/');
  if (parts.length !== 2) return fallback;
  const prefixNum = parseInt(parts[1], 10);
  if (Number.isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) return fallback;
  return prefixToNetmask(prefixNum);
}

export function validateDeviceName(name: string): boolean {
  // Şube/cihaz adları insan tarafından okunur gerçek isimlerdir (örn. "Kadıköy Şube
  // Ağ Geçidi", "ARIOT Adana Şube") - bu yüzden Unicode harfler (Türkçe karakterler
  // dahil), rakamlar, boşluk, tire, alt çizgi, parantez ve eğik çizgiye izin verilir.
  // `name` hiçbir yerde shell komutuna interpolе edilmez (yalnızca parametreli SQL ve
  // JS string işlemlerinde kullanılır - bkz. pki/route.ts'nin kendi ayrı sanitize
  // adımı), bu yüzden yalnızca alphanumeric+tire+alt çizgiye zorlamanın (eski davranış)
  // gerçek bir güvenlik faydası yoktu, sadece normal şube isimlerini reddediyordu.
  // netops_devices.name VARCHAR(128) (schema.sql) ile sınır eşleştirilmiştir.
  const nameRegex = /^[\p{L}\p{N}\s\-_().\/]{1,128}$/u;
  return nameRegex.test(name.trim());
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUsername(username: string): boolean {
  // Alphanumeric, hyphens, underscores, 3-32 chars
  const usernameRegex = /^[a-zA-Z0-9\-_]{3,32}$/;
  return usernameRegex.test(username);
}

export function sanitizeInput(input: string): string {
  // Remove SQL-dangerous characters
  return input
    .replace(/['";\\]/g, '')
    .trim()
    .substring(0, 1000); // Limit length
}

export function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

export function parseIntSafely(value: any, defaultValue: number = 0): number {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

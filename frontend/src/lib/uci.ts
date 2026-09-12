// UCI (OpenWrt Unified Configuration Interface) metin bloklarını, canlı donanımda
// güvenle çalıştırılabilecek `uci add`/`uci set` komut dizisine çevirir.
//
// GÜVENLİK: Bu modülün ürettiği her komut sonunda branch cihazında root olarak
// çalıştırılır (bkz. /api/commands/exec -> netops-agent). `parseUciBlocks` HER
// section tipini ve HER option anahtarını `\w+` (sadece harf/rakam/alt çizgi) ile
// sınırlar; hiçbir değer (`option ... 'DEĞER'`) tek tırnak, ters tık, `$`, `;`,
// `|`, `&`, `` ` `` içeremez - içeriyorsa o blok tamamen ATLANIR (sessizce
// uygulanmaz, hatalı/şüpheli veriyle asla shell'e karışmaz).
//
// NOT: Kasıtlı olarak `uci import <file>` KULLANMIYORUZ - import, hedef config
// dosyasının TAMAMINI verilenle DEĞİŞTİRİR (mevcut, bu şablonda olmayan kuralları
// SİLER). Bunun yerine mevcut DHCP/NAC akışlarıyla aynı deseni izleyerek tek tek
// `uci add` + `uci set` ile EKLEME yapıyoruz (idempotent değil ama yıkıcı da değil).

export interface UciBlock {
  type: string; // örn. "redirect", "queue", "rule"
  options: Array<[string, string]>;
}

const SAFE_TOKEN = /^[A-Za-z0-9_]+$/;
// Değerlerde: harf/rakam/nokta/tire/alt çizgi/iki nokta/eğik çizgi/boşluk/virgül
// serbest - shell'e özel anlamı olan ' " ` $ ; | & > < \ ve satır sonu YASAK.
const SAFE_VALUE = /^[A-Za-z0-9_.\-:/, ]*$/;

export function parseUciBlocks(uciContent: string): UciBlock[] {
  const blocks: UciBlock[] = [];
  const lines = uciContent.split('\n');
  let current: UciBlock | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const configMatch = line.match(/^config\s+(\S+)/);
    if (configMatch) {
      if (current) blocks.push(current);
      const type = configMatch[1].replace(/['"]/g, '');
      current = SAFE_TOKEN.test(type) ? { type, options: [] } : null;
      continue;
    }

    const optionMatch = line.match(/^(?:option|list)\s+(\S+)\s+'([^']*)'/);
    if (optionMatch && current) {
      const [, key, value] = optionMatch;
      if (SAFE_TOKEN.test(key) && SAFE_VALUE.test(value)) {
        current.options.push([key, value]);
      }
      // Güvensiz/eşleşmeyen bir satır bulunursa o TEK option atlanır, blok
      // yine de geçerli kalan diğer option'larla uygulanmaya devam eder.
    }
  }
  if (current) blocks.push(current);

  // En az bir güvenli option'ı olmayan (tamamen reddedilmiş) bloklar anlamsızdır.
  return blocks.filter((b) => b.options.length > 0);
}

// Section tipine göre hangi UCI config dosyasına ve hangi servis reload'una
// yazılacağını belirler. Bilinmeyen bir tip için `null` döner - o blok
// (yanlış dosyaya yazıp bir şeyi bozmamak için) sessizce atlanır.
const TYPE_TO_CONFIG: Record<string, { file: string; reload: string }> = {
  redirect: { file: 'firewall', reload: '/etc/init.d/firewall reload' },
  rule: { file: 'firewall', reload: '/etc/init.d/firewall reload' },
  forwarding: { file: 'firewall', reload: '/etc/init.d/firewall reload' },
  zone: { file: 'firewall', reload: '/etc/init.d/firewall reload' },
  nat: { file: 'firewall', reload: '/etc/init.d/firewall reload' },
  queue: { file: 'sqm', reload: '/etc/init.d/sqm restart' },
  host: { file: 'dhcp', reload: '/etc/init.d/dnsmasq restart' },
  domain: { file: 'dhcp', reload: '/etc/init.d/dnsmasq restart' }
};

// Ayrıştırılmış blokları, tek bir `sh -c` komutunda çalıştırılacak güvenli bir
// UCI komut dizisine çevirir. Aynı `uci_content` içinde birden fazla config
// dosyasını (örn. hem firewall hem sqm) hedefleyen bloklar olabilir - her dosya
// için ayrı `uci commit` + kendi servis reload'u üretilir.
export function buildUciApplyCommand(uciContent: string): string | null {
  const blocks = parseUciBlocks(uciContent);
  if (blocks.length === 0) return null;

  const touchedFiles = new Set<string>();
  const cmdParts: string[] = [];

  for (const block of blocks) {
    const target = TYPE_TO_CONFIG[block.type];
    if (!target) continue; // Bilinmeyen section tipi - hangi dosyaya yazılacağı belirsiz, atla

    cmdParts.push(`uci add ${target.file} ${block.type} >/dev/null`);
    for (const [key, value] of block.options) {
      cmdParts.push(`uci set ${target.file}.@${block.type}[-1].${key}='${value}'`);
    }
    touchedFiles.add(target.file);
  }

  if (cmdParts.length === 0 || touchedFiles.size === 0) return null;

  for (const file of touchedFiles) {
    cmdParts.push(`uci commit ${file}`);
  }
  for (const file of touchedFiles) {
    const reload = Object.values(TYPE_TO_CONFIG).find((t) => t.file === file)?.reload;
    if (reload) cmdParts.push(`${reload} 2>/dev/null || true`);
  }

  return cmdParts.join('; ');
}

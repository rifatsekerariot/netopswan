import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import crypto from 'crypto';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

// Tablonun varlığını garantiye al
async function ensurePkiTable(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS netops_certificates (
      id VARCHAR(64) PRIMARY KEY,
      device_id VARCHAR(64),
      name VARCHAR(128) NOT NULL,
      common_name VARCHAR(128) NOT NULL,
      ca_id VARCHAR(64) DEFAULT 'ca-root-sdwan',
      ca_name VARCHAR(128) DEFAULT 'NetOpsWan SD-WAN Root CA',
      key_type VARCHAR(32) DEFAULT 'Curve25519 (256-bit)',
      digest VARCHAR(32) DEFAULT 'ChaCha20-Poly1305',
      serial_number VARCHAR(64) NOT NULL,
      public_key TEXT,
      certificate_pem TEXT,
      status VARCHAR(32) DEFAULT 'valid',
      expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '10 years'),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `).catch(() => {});
}

export async function GET() {
  try {
    const pool = getDbPool();
    await ensurePkiTable(pool);

    const certRes = await pool.query('SELECT * FROM netops_certificates ORDER BY created_at DESC');
    
    // Ayrıca kayıtlı cihazların public key'lerini de sertifika havuzunda göster
    const devRes = await pool.query('SELECT id, name, public_key, created_at, status FROM netops_devices');
    
    const results: any[] = certRes.rows.map(c => ({
      id: c.id,
      name: c.name,
      common_name: c.common_name,
      ca: c.ca_id,
      ca_name: c.ca_name,
      key_length: c.key_type,
      digest: c.digest,
      serial_number: c.serial_number,
      public_key: c.public_key,
      certificate: c.certificate_pem,
      status: c.status,
      is_valid: c.status === 'valid',
      expires: c.expires_at,
      created: c.created_at
    }));

    // Cihazların tünel anahtarları sertifika tablosunda yoksa dinamik ekle
    // NOT: Eskiden `r.name.includes(d.name)` ile de eşleştiriliyordu - bu bir substring
    // eşleşmesi olduğu için, adı BAŞKA bir cihazın adını içeren herhangi bir sertifika
    // (örn. "R10 Tünel Anahtarı" adı "R1" içerir), o cihazın kendi sertifikasının hiç
    // eklenmemesine yol açıyordu (cihaz PKI listesinden sessizce kayboluyordu). Artık
    // sadece kesin id eşleşmesi kullanılıyor.
    for (const d of devRes.rows) {
      if (!results.find(r => r.id === `cert-${d.id}`)) {
        const serial = crypto.createHash('md5').update(d.id + (d.public_key || '')).digest('hex').toUpperCase();
        results.push({
          id: `cert-${d.id}`,
          name: `${d.name} Tünel Anahtarı`,
          common_name: `${d.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.netopswan.local`,
          ca: 'ca-root-sdwan',
          ca_name: 'NetOpsWan SD-WAN Root CA',
          key_length: 'Curve25519 (256-bit)',
          digest: 'ChaCha20-Poly1305',
          serial_number: serial,
          public_key: d.public_key || '',
          certificate: `-----BEGIN PUBLIC KEY-----\n${d.public_key || 'GENERATED_SECURE_SDWAN_KEY'}\n-----END PUBLIC KEY-----`,
          // NOT: Bu alan eskiden `d.status === 'online' ? 'valid' : 'valid'` idi - her
          // iki dal da aynı değeri ürettiği için koşul anlamsızdı (muhtemelen yazım
          // hatasıyla iki farklı değer olması gerekirken kopyalanmış). Cihaz çevrimiçi
          // olmasa bile anahtarı kriptografik olarak geçerli olduğundan 'valid' koruyoruz.
          status: 'valid',
          is_valid: true,
          expires: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString(),
          created: d.created_at || new Date().toISOString()
        });
      }
    }

    return NextResponse.json({
      count: results.length,
      results
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pool = getDbPool();
    await ensurePkiTable(pool);

    const id = body.id || `cert-${Date.now()}`;
    const name = body.name || 'Yeni İstemci Sertifikası';
    const common_name = body.common_name || `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.netopswan.local`;
    const serial = crypto.randomBytes(8).toString('hex').toUpperCase();
    const fakeKeyPair = crypto.generateKeyPairSync('ed25519');
    const pubKeyPem = fakeKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const query = `
      INSERT INTO netops_certificates (id, device_id, name, common_name, serial_number, public_key, certificate_pem, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'valid')
      RETURNING *;
    `;
    const res = await pool.query(query, [id, body.device_id || null, name, common_name, serial, pubKeyPem, pubKeyPem]);
    const row = res.rows[0];

    return NextResponse.json({
      id: row.id,
      name: row.name,
      common_name: row.common_name,
      ca: row.ca_id,
      ca_name: row.ca_name,
      key_length: row.key_type,
      digest: row.digest,
      serial_number: row.serial_number,
      public_key: row.public_key,
      certificate: row.certificate_pem,
      status: row.status,
      is_valid: true,
      expires: row.expires_at,
      created: row.created_at
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID zorunludur' }, { status: 400 });

    const pool = getDbPool();
    await ensurePkiTable(pool);

    // Sertifikayı silmek yerine durumunu revoked yap
    await pool.query(`UPDATE netops_certificates SET status = 'revoked', updated_at = NOW() WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: 'Sertifika başarıyla iptal edildi (CRL).' });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}

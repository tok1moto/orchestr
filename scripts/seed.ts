import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'orchestr'}:${process.env.POSTGRES_PASSWORD || 'orchestr'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'orchestr_dev'}`;

const pool = new Pool({
  connectionString,
});

export async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Starting database seeding...');
    await client.query('BEGIN');

    // 1. Insert 1 Seller
    const sellerResult = await client.query(`
      INSERT INTO sellers (id, name, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) 
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name, email;
    `, ['11111111-1111-1111-1111-111111111111', 'Acme Retailers', 'seller@acmeretail.com']);
    
    const seller = sellerResult.rows[0];
    console.log(`✅ Seeded Seller: ${seller.name} (${seller.id})`);

    // 2. Insert 1 Shopify Sales Channel
    const channelResult = await client.query(`
      INSERT INTO channels (id, seller_id, name, type, credentials, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) 
      DO UPDATE SET name = EXCLUDED.name, credentials = EXCLUDED.credentials
      RETURNING id, name, type;
    `, [
      '22222222-2222-2222-2222-222222222222',
      seller.id,
      'Acme Shopify Store',
      'shopify',
      JSON.stringify({ shop_domain: 'acme-retail.myshopify.com', access_token: 'shpat_test_token_123456' }),
      'active'
    ]);

    const channel = channelResult.rows[0];
    console.log(`✅ Seeded Channel: ${channel.name} [Type: ${channel.type}] (${channel.id})`);

    // 3. Insert 5 Test Products
    const productsData = [
      { title: 'Wireless Ergonomic Mouse', sku: 'PROD-MOUSE-001', price: 49.99, inventory_quantity: 150 },
      { title: 'Mechanical Gaming Keyboard', sku: 'PROD-KEYBD-002', price: 129.99, inventory_quantity: 85 },
      { title: 'UltraWide 34-inch Monitor', sku: 'PROD-MONTR-003', price: 599.99, inventory_quantity: 30 },
      { title: 'USB-C Multi-Port Hub', sku: 'PROD-HUB-004', price: 34.50, inventory_quantity: 200 },
      { title: 'Noise-Canceling Headphones', sku: 'PROD-HEADP-005', price: 199.95, inventory_quantity: 60 },
    ];

    for (const prod of productsData) {
      const prodResult = await client.query(`
        INSERT INTO products (seller_id, channel_id, title, sku, price, inventory_quantity, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
        ON CONFLICT (sku) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          price = EXCLUDED.price,
          inventory_quantity = EXCLUDED.inventory_quantity
        RETURNING id, title, sku, price, inventory_quantity;
      `, [seller.id, channel.id, prod.title, prod.sku, prod.price, prod.inventory_quantity]);

      const p = prodResult.rows[0];
      console.log(`  📦 Seeded Product: ${p.title} | SKU: ${p.sku} | Price: $${p.price} | Stock: ${p.inventory_quantity}`);
    }

    await client.query('COMMIT');
    console.log('🎉 Seeding completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed().catch(() => process.exit(1));
}

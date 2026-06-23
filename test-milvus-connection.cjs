console.log('=== Milvus Connection Test (CJS) ===');

const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

console.log('1. Reading config...');
const address = process.env.MILVUS_ADDRESS || '10.50.4.149:19530';
const token = process.env.MILVUS_TOKEN || '';

console.log(`   MILVUS_ADDRESS: ${address}`);
console.log(`   MILVUS_TOKEN: ${token ? '[SET]' : '[NOT SET]'}`);
console.log();

console.log('2. Creating MilvusClient...');
const client = new MilvusClient({
  address,
  token
});

console.log('   Client created');
console.log();

console.log('3. Testing connection (listCollections)...');

async function testConnection() {
  try {
    const response = await client.listCollections();
    console.log('   ✓ Success!');
    console.log('   Response:', JSON.stringify(response, null, 2));
    console.log();
    console.log('=== Test passed ===');
    process.exit(0);
  } catch (error) {
    console.error('   ✗ Failed!');
    console.error('   Error:', error);
    console.error('   Stack:', error.stack);
    console.error();
    console.error('=== Test failed ===');
    process.exit(1);
  }
}

testConnection();

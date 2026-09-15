import { rpc } from './src-rpc.js';

try {
  const blockchain = await rpc('getblockchaininfo');

  console.log('======================================');
  console.log('BITCOIN CORE RPC CONNECTION OK');
  console.log('======================================');

  console.log('Chain:', blockchain.chain);
  console.log('Blocks:', blockchain.blocks);
  console.log('Headers:', blockchain.headers);
  console.log('Best block:', blockchain.bestblockhash);

} catch (error) {
  console.error('RPC ERROR:');
  console.error(error.message);
  process.exit(1);
}
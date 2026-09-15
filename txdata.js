import { rpc } from './src-rpc.js';

export async function getRawTransaction(txid) {
  return await rpc('getrawtransaction', [txid, true]);
}
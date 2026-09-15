import { getAllUtxos } from './utxo.js';
import { getRawTransaction } from './txdata.js';

const utxos = await getAllUtxos();

const p2pkh = utxos.find(
  u => u.type === 'P2PKH'
);

if (!p2pkh) {
  throw new Error('Không tìm thấy P2PKH UTXO');
}

const tx = await getRawTransaction(p2pkh.txid);

console.log('');
console.log('==============================================');
console.log('PREVIOUS TRANSACTION');
console.log('==============================================');
console.log('');

console.log('TXID:', p2pkh.txid);
console.log('VOUT:', p2pkh.vout);
console.log('Amount:', p2pkh.amountBtc, 'BTC');
console.log('Confirmed:', p2pkh.confirmations);

console.log('');
console.log('Raw transaction:');
console.log(tx.hex);
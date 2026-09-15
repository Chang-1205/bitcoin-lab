import fs from 'node:fs/promises';
import { rpc } from './src-rpc.js';

try {
  console.log('');
  console.log('==============================================');
  console.log('BROADCAST SIGNED TRANSACTION');
  console.log('==============================================');
  console.log('');

  const rawTx = (
    await fs.readFile(
      './signed-tx.hex',
      'utf8'
    )
  ).trim();

  if (!rawTx) {
    throw new Error(
      'signed-tx.hex đang trống'
    );
  }

  console.log(
    'Raw transaction loaded.'
  );

  console.log(
    'Raw TX length:',
    rawTx.length,
    'hex characters'
  );

  console.log('');

  const txid = await rpc(
    'sendrawtransaction',
    [rawTx]
  );

  console.log(
    'Broadcast successful!'
  );

  console.log('');

  console.log(
    'TXID:',
    txid
  );

  console.log('');

  console.log('==============================================');
  console.log('BROADCAST COMPLETED');
  console.log('==============================================');

} catch (error) {

  console.error('');

  console.error('==============================================');
  console.error('BROADCAST ERROR');
  console.error('==============================================');

  console.error('');

  console.error(
    error.message
  );

  process.exit(1);
}
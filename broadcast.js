import fs from 'node:fs/promises';
import { rpc } from './src-rpc.js';

const RAW_TX_FILE = './signed-tx.hex';
const TXID_FILE = './signed-tx-id.txt';

try {
  console.log('');
  console.log('==============================================');
  console.log('BROADCAST SIGNED TRANSACTION');
  console.log('==============================================');
  console.log('');

  // ==========================================================
  // READ SIGNED TRANSACTION
  // ==========================================================

  const rawTx = (
    await fs.readFile(
      RAW_TX_FILE,
      'utf8'
    )
  ).trim();

  if (!rawTx) {
    throw new Error(
      'signed-tx.hex đang trống.'
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(rawTx)) {
    throw new Error(
      'signed-tx.hex không phải hexadecimal hợp lệ.'
    );
  }

  if (rawTx.length % 2 !== 0) {
    throw new Error(
      'signed-tx.hex có độ dài hex không hợp lệ.'
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

  // ==========================================================
  // BROADCAST
  // ==========================================================

  const txid = await rpc(
    'sendrawtransaction',
    [rawTx]
  );

  // ==========================================================
  // SAVE TXID
  // ==========================================================

  await fs.writeFile(
    TXID_FILE,
    `${txid}\n`,
    'utf8'
  );

  // ==========================================================
  // RESULT
  // ==========================================================

  console.log(
    'Broadcast successful!'
  );

  console.log('');

  console.log(
    'TXID:',
    txid
  );

  console.log('');

  console.log(
    'Saved:',
    TXID_FILE
  );

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'BROADCAST COMPLETED'
  );

  console.log(
    '=============================================='
  );

} catch (error) {

  console.error('');

  console.error(
    '=============================================='
  );

  console.error(
    'BROADCAST ERROR'
  );

  console.error(
    '=============================================='
  );

  console.error('');

  console.error(
    error.message
  );

  console.error('');

  process.exit(1);
}
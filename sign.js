import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';
import fs from 'node:fs/promises';

import {
  getAllUtxos,
  satsToBtc
} from './utxo.js';

import {
  network,
  keyPair,
  xOnlyPubkey,
  buildMixedDemoPsbt
} from './transaction.js';


// ============================================================
// INITIALIZE
// ============================================================

bitcoin.initEccLib(ecc);

const ECPair =
  ECPairFactory(ecc);


// ============================================================
// TAPROOT SIGNER TWEAK
//
// BIP341 key-path spending.
// ============================================================

export function tweakSigner(
  signer
) {

  let privateKey =
    signer.privateKey;


  if (!privateKey) {

    throw new Error(
      'Không có private key để ký Taproot'
    );

  }


  /*
   * Nếu public key có Y odd,
   * negate private key trước khi tweak.
   */

  if (
    signer.publicKey[0] === 3
  ) {

    privateKey =
      ecc.privateNegate(
        privateKey
      );

  }


  /*
   * TapTweak =
   * taggedHash(
   *   "TapTweak",
   *   x-only internal public key
   * )
   */

  const tweak =
    bitcoin.crypto.taggedHash(
      'TapTweak',
      signer.publicKey.subarray(
        1,
        33
      )
    );


  const tweakedPrivateKey =
    ecc.privateAdd(
      privateKey,
      tweak
    );


  if (
    !tweakedPrivateKey
  ) {

    throw new Error(
      'Taproot private key tweak thất bại'
    );

  }


  return ECPair.fromPrivateKey(
    Buffer.from(
      tweakedPrivateKey
    ),
    {
      network
    }
  );

}


// ============================================================
// SIGN ONE INPUT
// ============================================================

export function signOneInput(
  psbt,
  index,
  utxo
) {

  if (
    utxo.type === 'P2TR'
  ) {

    const tweakedSigner =
      tweakSigner(
        keyPair
      );


    psbt.signInput(
      index,
      tweakedSigner
    );


    return;

  }


  /*
   * P2PKH
   * P2SH-P2WPKH
   * P2WPKH
   *
   * đều dùng ECDSA.
   */

  psbt.signInput(
    index,
    keyPair
  );

}


// ============================================================
// SIGN ALL INPUTS
//
// Hàm này được server.js tái sử dụng.
//
// Không broadcast.
// Không tự động mine.
// Không tự động thay đổi UTXO.
// ============================================================

export function signPsbt(
  psbt,
  selectedUtxos
) {

  if (
    !Array.isArray(
      selectedUtxos
    ) ||
    selectedUtxos.length === 0
  ) {

    throw new Error(
      'Không có UTXO để ký'
    );

  }


  if (
    psbt.inputCount !==
    selectedUtxos.length
  ) {

    throw new Error(
      'Số input trong PSBT không khớp số UTXO'
    );

  }


  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'SIGNING'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  for (
    let i = 0;
    i < selectedUtxos.length;
    i++
  ) {

    const utxo =
      selectedUtxos[i];


    console.log(
      `Signing input #${i + 1}: ${utxo.type}`
    );


    signOneInput(
      psbt,
      i,
      utxo
    );


    console.log(
      '  ✓ Signature created'
    );

  }


  return psbt;

}


// ============================================================
// ECDSA SIGNATURE VALIDATOR
// ============================================================

export function ecdsaValidator(
  pubkey,
  msghash,
  signature
) {

  return ecc.verify(
    msghash,
    pubkey,
    signature
  );

}


// ============================================================
// SCHNORR SIGNATURE VALIDATOR
// ============================================================

export function schnorrValidator(
  pubkey,
  msghash,
  signature
) {

  return ecc.verifySchnorr(
    msghash,
    pubkey,
    signature
  );

}


// ============================================================
// VERIFY ALL SIGNATURES
// ============================================================

export function verifyPsbtSignatures(
  psbt,
  selectedUtxos
) {

  if (
    psbt.inputCount !==
    selectedUtxos.length
  ) {

    throw new Error(
      'PSBT input count không khớp UTXO'
    );

  }


  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'VERIFY SIGNATURES'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  for (
    let i = 0;
    i < psbt.inputCount;
    i++
  ) {

    const utxo =
      selectedUtxos[i];


    let valid;


    if (
      utxo.type === 'P2TR'
    ) {

      valid =
        psbt.validateSignaturesOfInput(
          i,
          schnorrValidator
        );

    } else {

      valid =
        psbt.validateSignaturesOfInput(
          i,
          ecdsaValidator
        );

    }


    console.log(

      `Input #${i + 1} (${utxo.type}):`,

      valid
        ? 'VALID'
        : 'INVALID'

    );


    if (!valid) {

      throw new Error(
        `Chữ ký input #${i + 1} không hợp lệ`
      );

    }

  }


  return true;

}


// ============================================================
// FINALIZE PSBT
// ============================================================

export function finalizePsbt(
  psbt
) {

  psbt.finalizeAllInputs();

  return psbt;

}


// ============================================================
// EXTRACT FINAL TRANSACTION
// ============================================================

export function extractTransaction(
  psbt
) {

  const tx =
    psbt.extractTransaction();


  return {

    tx,

    txid:
      tx.getId(),

    rawTransaction:
      tx.toHex(),

    vsize:
      tx.virtualSize(),

    weight:
      tx.weight()

  };

}


// ============================================================
// SIGN + VERIFY + FINALIZE
//
// Hàm chính cho server.js.
//
// Flow:
//
// Build PSBT
//     ↓
// Sign
//     ↓
// Verify
//     ↓
// Finalize
//     ↓
// Extract
//
// Chưa broadcast.
// ============================================================

export function signAndFinalize(
  psbt,
  selectedUtxos
) {

  signPsbt(
    psbt,
    selectedUtxos
  );


  verifyPsbtSignatures(
    psbt,
    selectedUtxos
  );


  finalizePsbt(
    psbt
  );


  return extractTransaction(
    psbt
  );

}


// ============================================================
// SAVE SIGNED TRANSACTION
// ============================================================

export async function saveSignedTransaction(
  rawTransaction,
  txid
) {

  await fs.writeFile(
    './signed-tx.hex',
    rawTransaction,
    'utf8'
  );


  await fs.writeFile(
    './signed-tx-id.txt',
    txid,
    'utf8'
  );

}


// ============================================================
// DIRECT CLI DEMO
//
// node sign.js
//
// Giữ nguyên flow Lab ban đầu.
// ============================================================

async function main() {

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'SIGN MIXED PSBT'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  // ==========================================================
  // BUILD DEMO PSBT
  // ==========================================================

  const result =
    await buildMixedDemoPsbt();


  const {
    psbt,
    selected
  } = result;


  console.log(
    'Selected inputs:'
  );

  console.log('');


  selected.forEach(
    (
      utxo,
      index
    ) => {

      console.log(

        `#${index + 1}`,

        utxo.type,

        `${utxo.txid}:${utxo.vout}`,

        `${utxo.amountBtc} BTC`

      );

    }
  );


  // ==========================================================
  // SIGN
  // ==========================================================

  signPsbt(
    psbt,
    selected
  );


  // ==========================================================
  // VERIFY
  // ==========================================================

  verifyPsbtSignatures(
    psbt,
    selected
  );


  // ==========================================================
  // FINALIZE
  // ==========================================================

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'FINALIZE PSBT'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  finalizePsbt(
    psbt
  );


  console.log(
    'All inputs finalized.'
  );


  // ==========================================================
  // EXTRACT
  // ==========================================================

  const resultTx =
    extractTransaction(
      psbt
    );


  // ==========================================================
  // SAVE
  // ==========================================================

  await saveSignedTransaction(
    resultTx.rawTransaction,
    resultTx.txid
  );


  // ==========================================================
  // DISPLAY
  // ==========================================================

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'SIGNED TRANSACTION'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  console.log(
    'TXID:'
  );

  console.log(
    resultTx.txid
  );


  console.log('');

  console.log(
    'RAW TRANSACTION:'
  );

  console.log(
    resultTx.rawTransaction
  );


  console.log('');

  console.log(
    'VSize:',
    resultTx.vsize
  );


  console.log(
    'Weight:',
    resultTx.weight
  );


  console.log('');

  console.log(
    'Saved: signed-tx.hex'
  );

  console.log(
    'Saved: signed-tx-id.txt'
  );


  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'SIGNING COMPLETED'
  );

  console.log(
    '=============================================='
  );

}


// ============================================================
// DIRECT EXECUTION CHECK
// ============================================================

const isDirectRun =
  process.argv[1] &&
  process.argv[1]
    .endsWith(
      'sign.js'
    );


if (isDirectRun) {

  main()
    .catch(
      error => {

        console.error('');

        console.error(
          '=============================================='
        );

        console.error(
          'SIGNING ERROR'
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
    );

}
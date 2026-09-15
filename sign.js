import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';
import fs from 'node:fs/promises';

import { getAllUtxos } from './utxo.js';
import { getRawTransaction } from './txdata.js';

// ============================================================
// INITIALIZE BITCOINJS
// ============================================================

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

const network = bitcoin.networks.regtest;

// ============================================================
// PRIVATE KEY
// ============================================================

const privateKeyHex = process.env.PRIVATE_KEY_HEX;

if (!privateKeyHex) {
  throw new Error(
    'Thiếu PRIVATE_KEY_HEX trong file .env'
  );
}

if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
  throw new Error(
    'PRIVATE_KEY_HEX phải là 64 ký tự hexadecimal (32 bytes)'
  );
}

// ============================================================
// CREATE KEY PAIR
// ============================================================

const keyPair = ECPair.fromPrivateKey(
  Buffer.from(privateKeyHex, 'hex'),
  {
    network
  }
);

// ============================================================
// DERIVE ADDRESS / PAYMENT TYPES
// ============================================================

// P2WPKH

const p2wpkh = bitcoin.payments.p2wpkh({
  pubkey: keyPair.publicKey,
  network
});

// P2SH-P2WPKH

const p2shP2wpkh = bitcoin.payments.p2sh({
  redeem: p2wpkh,
  network
});

// P2TR

const xOnlyPubkey =
  keyPair.publicKey.subarray(1, 33);

const p2tr = bitcoin.payments.p2tr({
  internalPubkey: xOnlyPubkey,
  network
});

// P2PKH

const p2pkh = bitcoin.payments.p2pkh({
  pubkey: keyPair.publicKey,
  network
});

// ============================================================
// CHECK ADDRESSES
// ============================================================

if (
  !p2pkh.address ||
  !p2shP2wpkh.address ||
  !p2wpkh.address ||
  !p2tr.address
) {
  throw new Error(
    'Không thể tạo đầy đủ 4 loại address'
  );
}

const addresses = {
  P2PKH: p2pkh.address,
  P2SH_P2WPKH: p2shP2wpkh.address,
  P2WPKH: p2wpkh.address,
  P2TR: p2tr.address
};

// ============================================================
// TAPROOT SIGNER TWEAK
// ============================================================

function tweakSigner(signer) {

  let privateKey = signer.privateKey;

  if (!privateKey) {
    throw new Error(
      'Không có private key để ký Taproot'
    );
  }

  /*
   * BIP341:
   *
   * Nếu public key có Y odd
   * thì negate private key trước khi tweak.
   */

  if (signer.publicKey[0] === 3) {
    privateKey = ecc.privateNegate(
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

  const tweak = bitcoin.crypto.taggedHash(
    'TapTweak',
    signer.publicKey.subarray(1, 33)
  );

  const tweakedPrivateKey =
    ecc.privateAdd(
      privateKey,
      tweak
    );

  if (!tweakedPrivateKey) {
    throw new Error(
      'Taproot private key tweak thất bại'
    );
  }

  return ECPair.fromPrivateKey(
    Buffer.from(tweakedPrivateKey),
    {
      network
    }
  );
}

// ============================================================
// SELECT 5 MIXED UTXOs
// ============================================================

function selectFiveMixedUtxos(utxos) {

  const selected = [];

  const p2pkhUtxos =
    utxos.filter(
      u => u.type === 'P2PKH'
    );

  const p2shUtxo =
    utxos.find(
      u => u.type === 'P2SH_P2WPKH'
    );

  const p2wpkhUtxo =
    utxos.find(
      u => u.type === 'P2WPKH'
    );

  const p2trUtxo =
    utxos.find(
      u => u.type === 'P2TR'
    );

  if (p2pkhUtxos.length < 2) {
    throw new Error(
      'Không đủ 2 UTXO P2PKH'
    );
  }

  if (!p2shUtxo) {
    throw new Error(
      'Không tìm thấy UTXO P2SH-P2WPKH'
    );
  }

  if (!p2wpkhUtxo) {
    throw new Error(
      'Không tìm thấy UTXO P2WPKH'
    );
  }

  if (!p2trUtxo) {
    throw new Error(
      'Không tìm thấy UTXO P2TR'
    );
  }

  /*
   * Transaction demo gồm 5 input:
   *
   * 1. P2PKH
   * 2. P2SH-P2WPKH
   * 3. P2WPKH
   * 4. P2TR
   * 5. P2PKH
   *
   * Mục đích:
   * minh họa cách xây dựng và ký
   * nhiều loại input khác nhau
   * trong cùng một transaction.
   */

  selected.push(p2pkhUtxos[0]);
  selected.push(p2shUtxo);
  selected.push(p2wpkhUtxo);
  selected.push(p2trUtxo);
  selected.push(p2pkhUtxos[1]);

  return selected;
}

// ============================================================
// ADD INPUT TO PSBT
// ============================================================

async function addInput(psbt, utxo) {

  // ==========================================================
  // P2PKH
  // ==========================================================

  if (utxo.type === 'P2PKH') {

    /*
     * Legacy P2PKH cần nonWitnessUtxo.
     *
     * nonWitnessUtxo = toàn bộ previous transaction.
     */

    const previousTx =
      await getRawTransaction(
        utxo.txid
      );

    psbt.addInput({

      hash: utxo.txid,

      index: utxo.vout,

      nonWitnessUtxo:
        Buffer.from(
          previousTx.hex,
          'hex'
        )
    });

    return;
  }

  // ==========================================================
  // P2SH-P2WPKH
  // ==========================================================

  if (utxo.type === 'P2SH_P2WPKH') {

    /*
     * P2SH-P2WPKH cần:
     *
     * 1. witnessUtxo
     * 2. redeemScript
     */

    psbt.addInput({

      hash: utxo.txid,

      index: utxo.vout,

      witnessUtxo: {

        script:
          Buffer.from(
            utxo.scriptPubKey,
            'hex'
          ),

        value:
          BigInt(
            utxo.amountSats
          )
      },

      redeemScript:
        p2wpkh.output
    });

    return;
  }

  // ==========================================================
  // P2WPKH
  // ==========================================================

  if (utxo.type === 'P2WPKH') {

    /*
     * Native SegWit P2WPKH
     *
     * Chỉ cần witnessUtxo.
     */

    psbt.addInput({

      hash: utxo.txid,

      index: utxo.vout,

      witnessUtxo: {

        script:
          Buffer.from(
            utxo.scriptPubKey,
            'hex'
          ),

        value:
          BigInt(
            utxo.amountSats
          )
      }
    });

    return;
  }

  // ==========================================================
  // P2TR
  // ==========================================================

  if (utxo.type === 'P2TR') {

    /*
     * Taproot key-path spending.
     *
     * Cần:
     *
     * 1. witnessUtxo
     * 2. tapInternalKey
     */

    psbt.addInput({

      hash: utxo.txid,

      index: utxo.vout,

      witnessUtxo: {

        script:
          Buffer.from(
            utxo.scriptPubKey,
            'hex'
          ),

        value:
          BigInt(
            utxo.amountSats
          )
      },

      tapInternalKey:
        xOnlyPubkey
    });

    return;
  }

  throw new Error(
    `Loại UTXO không được hỗ trợ: ${utxo.type}`
  );
}

// ============================================================
// MAIN PROGRAM
// ============================================================

try {

  // ==========================================================
  // LOAD UTXOs FROM BITCOIN CORE
  // ==========================================================

  const utxos =
    await getAllUtxos();

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
  // SELECT 5 UTXOs
  // ==========================================================

  const selected =
    selectFiveMixedUtxos(
      utxos
    );

  console.log(
    'Selected inputs:'
  );

  console.log('');

  selected.forEach(
    (utxo, index) => {

      console.log(

        `#${index + 1}`,

        utxo.type,

        `${utxo.txid}:${utxo.vout}`,

        `${utxo.amountBtc} BTC`

      );

    }
  );

  // ==========================================================
  // CREATE PSBT
  // ==========================================================

  const psbt =
    new bitcoin.Psbt({
      network
    });

  // ==========================================================
  // ADD ALL INPUTS
  // ==========================================================

  for (const utxo of selected) {

    await addInput(
      psbt,
      utxo
    );

  }

  // ==========================================================
  // CREATE OUTPUT
  // ==========================================================

  /*
   * Tổng input:
   *
   * 5 × 1 BTC
   * = 5 BTC
   *
   * Output:
   *
   * 4.999 BTC
   *
   * Fee:
   *
   * 0.001 BTC
   */

  const sendAmountSats =
    499_900_000;

  const destination =
    addresses.P2WPKH;

  psbt.addOutput({

    address:
      destination,

    value:
      BigInt(
        sendAmountSats
      )

  });

  // ==========================================================
  // DISPLAY PSBT INFORMATION
  // ==========================================================

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'PSBT CREATED'
  );

  console.log(
    '=============================================='
  );

  console.log('');

  console.log(
    'Input count:',
    psbt.inputCount
  );

  console.log(
    'Output count:',
    psbt.txOutputs.length
  );

  console.log('');

  console.log(
    'Destination:',
    destination
  );

  console.log(
    'Send amount:',
    sendAmountSats /
      100_000_000,
    'BTC'
  );

  const inputTotalSats =
    selected.reduce(
      (sum, utxo) =>
        sum + utxo.amountSats,
      0
    );

  console.log('');

  console.log(
    'Input total:',
    inputTotalSats /
      100_000_000,
    'BTC'
  );

  console.log(
    'Fee:',
    (
      inputTotalSats -
      sendAmountSats
    ) /
      100_000_000,
    'BTC'
  );

  // ==========================================================
  // SIGN INPUTS
  // ==========================================================

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
    i < selected.length;
    i++
  ) {

    const utxo =
      selected[i];

    console.log(
      `Signing input #${i + 1}: ${utxo.type}`
    );

    // ========================================================
    // P2TR -> SCHNORR
    // ========================================================

    if (
      utxo.type === 'P2TR'
    ) {

      const tweakedSigner =
        tweakSigner(
          keyPair
        );

      psbt.signInput(
        i,
        tweakedSigner
      );

    }

    // ========================================================
    // P2PKH / P2SH-P2WPKH / P2WPKH -> ECDSA
    // ========================================================

    else {

      psbt.signInput(
        i,
        keyPair
      );

    }

    console.log(
      '  ✓ Signature created'
    );
  }

  // ==========================================================
  // ECDSA VALIDATOR
  // ==========================================================

  const ecdsaValidator = (
    pubkey,
    msghash,
    signature
  ) => {

    return ecc.verify(
      msghash,
      pubkey,
      signature
    );

  };

  // ==========================================================
  // SCHNORR VALIDATOR
  // ==========================================================

  const schnorrValidator = (
    pubkey,
    msghash,
    signature
  ) => {

    return ecc.verifySchnorr(
      msghash,
      pubkey,
      signature
    );

  };

  // ==========================================================
  // VERIFY SIGNATURES
  // ==========================================================

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
      selected[i];

    let valid;

    // ========================================================
    // P2TR -> SCHNORR
    // ========================================================

    if (
      utxo.type === 'P2TR'
    ) {

      valid =
        psbt.validateSignaturesOfInput(
          i,
          schnorrValidator
        );

    }

    // ========================================================
    // OTHER TYPES -> ECDSA
    // ========================================================

    else {

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

  // ==========================================================
  // FINALIZE PSBT
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

  psbt.finalizeAllInputs();

  console.log(
    'All inputs finalized.'
  );

  // ==========================================================
  // EXTRACT FINAL TRANSACTION
  // ==========================================================

  const tx =
    psbt.extractTransaction();

  const txid =
    tx.getId();

  const rawTransaction =
    tx.toHex();

  // ==========================================================
  // SAVE SIGNED TRANSACTION
  // ==========================================================

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

  // ==========================================================
  // DISPLAY FINAL TRANSACTION
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
    txid
  );

  console.log('');

  console.log(
    'RAW TRANSACTION:'
  );

  console.log(
    rawTransaction
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

} catch (error) {

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
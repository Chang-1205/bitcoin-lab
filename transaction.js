import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';

import { getAllUtxos } from './utxo.js';
import { getRawTransaction } from './txdata.js';

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.regtest;

const privateKeyHex = process.env.PRIVATE_KEY_HEX;

if (!privateKeyHex) {
  throw new Error('Thiếu PRIVATE_KEY_HEX trong .env');
}

const keyPair = ECPair.fromPrivateKey(
  Buffer.from(privateKeyHex, 'hex'),
  { network }
);

const p2wpkh = bitcoin.payments.p2wpkh({
  pubkey: keyPair.publicKey,
  network
});

const p2shP2wpkh = bitcoin.payments.p2sh({
  redeem: p2wpkh,
  network
});

const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);

const p2tr = bitcoin.payments.p2tr({
  internalPubkey: xOnlyPubkey,
  network
});

const addresses = {
  P2PKH: bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network
  }).address,

  P2SH_P2WPKH: p2shP2wpkh.address,

  P2WPKH: p2wpkh.address,

  P2TR: p2tr.address
};


/*
 * Chọn đúng 5 UTXO:
 *
 * 1 P2PKH
 * 1 P2SH-P2WPKH
 * 1 P2WPKH
 * 1 P2TR
 * 1 P2PKH bổ sung
 */
function selectFiveMixedUtxos(utxos) {
  const selected = [];

  const p2pkh = utxos.filter(u => u.type === 'P2PKH');
  const p2sh = utxos.find(u => u.type === 'P2SH_P2WPKH');
  const p2wpkh = utxos.find(u => u.type === 'P2WPKH');
  const p2tr = utxos.find(u => u.type === 'P2TR');

  if (p2pkh.length < 2) {
    throw new Error('Cần ít nhất 2 UTXO P2PKH');
  }

  if (!p2sh || !p2wpkh || !p2tr) {
    throw new Error(
      'Không đủ 4 loại UTXO cần thiết'
    );
  }

  selected.push(p2pkh[0]);
  selected.push(p2sh);
  selected.push(p2wpkh);
  selected.push(p2tr);
  selected.push(p2pkh[1]);

  return selected;
}


/*
 * Tạo PSBT input theo từng loại script.
 */
async function addInput(psbt, utxo) {
  if (utxo.type === 'P2PKH') {

    /*
     * Legacy P2PKH:
     * cần full previous transaction.
     */
    const previousTx = await getRawTransaction(
      utxo.txid
    );

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(
        previousTx.hex,
        'hex'
      )
    });

    return;
  }


  if (utxo.type === 'P2SH_P2WPKH') {

    /*
     * Nested SegWit:
     * witnessUtxo + redeemScript.
     */
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,

      witnessUtxo: {
        script: Buffer.from(
          utxo.scriptPubKey,
          'hex'
        ),
        value: BigInt(utxo.amountSats)
      },

      redeemScript: p2wpkh.output
    });

    return;
  }


  if (utxo.type === 'P2WPKH') {

    /*
     * Native SegWit.
     */
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,

      witnessUtxo: {
        script: Buffer.from(
          utxo.scriptPubKey,
          'hex'
        ),
        value: BigInt(utxo.amountSats)
      }
    });

    return;
  }


  if (utxo.type === 'P2TR') {

    /*
     * Taproot key-path.
     */
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,

      witnessUtxo: {
        script: Buffer.from(
          utxo.scriptPubKey,
          'hex'
        ),
        value: BigInt(utxo.amountSats)
      },

      tapInternalKey: xOnlyPubkey
    });

    return;
  }

  throw new Error(
    `Loại UTXO không hỗ trợ: ${utxo.type}`
  );
}


const utxos = await getAllUtxos();

console.log('');
console.log('==============================================');
console.log('BUILD MIXED PSBT');
console.log('==============================================');
console.log('');

const selected = selectFiveMixedUtxos(utxos);

console.log('Selected UTXOs:');
console.log('');

selected.forEach((u, i) => {
  console.log(
    `Input #${i + 1}:`,
    u.type,
    `${u.txid}:${u.vout}`,
    `${u.amountBtc} BTC`
  );
});

console.log('');

const psbt = new bitcoin.Psbt({
  network
});

for (const utxo of selected) {
  await addInput(psbt, utxo);
}


/*
 * Demo transaction:
 *
 * 5 BTC input
 * gửi 4.999 BTC
 * phần còn lại ~ phí
 *
 * Chưa broadcast.
 */
const sendAmountSats = 4_999_000_00;

const destination = addresses.P2WPKH;

psbt.addOutput({
  address: destination,
  value: BigInt(sendAmountSats)
});

console.log('==============================================');
console.log('PSBT CREATED');
console.log('==============================================');
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
console.log('Destination:', destination);
console.log(
  'Send amount:',
  sendAmountSats / 100_000_000,
  'BTC'
);

console.log('');

console.log('PSBT Base64:');
console.log(psbt.toBase64());

console.log('');
console.log('==============================================');
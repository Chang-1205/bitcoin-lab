import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';

import {
  getAllUtxos,
  addresses,
  btcToSats,
  satsToBtc
} from './utxo.js';

import {
  getRawTransaction
} from './txdata.js';


// ============================================================
// INITIALIZE BITCOINJS
// ============================================================

bitcoin.initEccLib(ecc);

const ECPair =
  ECPairFactory(ecc);

export const network =
  bitcoin.networks.regtest;


// ============================================================
// PRIVATE KEY
// ============================================================

const privateKeyHex =
  process.env.PRIVATE_KEY_HEX;

if (!privateKeyHex) {

  throw new Error(
    'Thiếu PRIVATE_KEY_HEX trong .env'
  );

}

if (
  !/^[0-9a-fA-F]{64}$/.test(
    privateKeyHex
  )
) {

  throw new Error(
    'PRIVATE_KEY_HEX phải là 64 ký tự hexadecimal (32 bytes)'
  );

}


export const keyPair =
  ECPair.fromPrivateKey(
    Buffer.from(
      privateKeyHex,
      'hex'
    ),
    {
      network
    }
  );


// ============================================================
// DERIVE 4 ADDRESS TYPES
// ============================================================

const publicKey =
  Buffer.from(
    keyPair.publicKey
  );


export const p2pkh =
  bitcoin.payments.p2pkh({
    pubkey: publicKey,
    network
  });


export const p2wpkh =
  bitcoin.payments.p2wpkh({
    pubkey: publicKey,
    network
  });


export const p2shP2wpkh =
  bitcoin.payments.p2sh({
    redeem: p2wpkh,
    network
  });


export const xOnlyPubkey =
  publicKey.subarray(
    1,
    33
  );


export const p2tr =
  bitcoin.payments.p2tr({
    internalPubkey:
      xOnlyPubkey,
    network
  });


// ============================================================
// VERIFY ADDRESS CONSISTENCY
// ============================================================

export const derivedAddresses = {

  P2PKH:
    p2pkh.address,

  P2SH_P2WPKH:
    p2shP2wpkh.address,

  P2WPKH:
    p2wpkh.address,

  P2TR:
    p2tr.address

};


for (
  const [
    type,
    address
  ]
  of Object.entries(
    derivedAddresses
  )
) {

  if (!address) {

    throw new Error(
      `Không thể tạo address ${type}`
    );

  }

}


// ============================================================
// SELECT 5 MIXED UTXOs
//
// ĐÂY LÀ FLOW DEMO BAN ĐẦU.
// Không dùng hàm này cho giao dịch người dùng bình thường.
//
// Mục tiêu:
// 1 P2PKH
// 1 P2SH-P2WPKH
// 1 P2WPKH
// 1 P2TR
// 1 P2PKH bổ sung
// ============================================================

export function selectFiveMixedUtxos(
  utxos
) {

  const selected = [];

  const p2pkhUtxos =
    utxos.filter(
      u =>
        u.type === 'P2PKH'
    );

  const p2shUtxo =
    utxos.find(
      u =>
        u.type === 'P2SH_P2WPKH'
    );

  const p2wpkhUtxo =
    utxos.find(
      u =>
        u.type === 'P2WPKH'
    );

  const p2trUtxo =
    utxos.find(
      u =>
        u.type === 'P2TR'
    );


  if (
    p2pkhUtxos.length < 2
  ) {

    throw new Error(
      'Không đủ 2 UTXO P2PKH để tạo mixed demo'
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


  selected.push(
    p2pkhUtxos[0]
  );

  selected.push(
    p2shUtxo
  );

  selected.push(
    p2wpkhUtxo
  );

  selected.push(
    p2trUtxo
  );

  selected.push(
    p2pkhUtxos[1]
  );


  return selected;

}


// ============================================================
// GET SCRIPT PUBKEY HEX
//
// transaction.js vẫn hỗ trợ cả:
//
// scriptPubKey: "76a914..."
//
// và:
//
// scriptPubKey: {
//   hex: "76a914..."
// }
//
// utxo.js đã chuẩn hóa thành string,
// nhưng giữ helper này để transaction.js an toàn hơn.
// ============================================================

function getScriptPubKeyHex(
  utxo
) {

  if (
    typeof utxo.scriptPubKey === 'string'
  ) {

    return utxo.scriptPubKey;

  }


  if (
    utxo.scriptPubKey &&
    typeof utxo.scriptPubKey.hex === 'string'
  ) {

    return utxo.scriptPubKey.hex;

  }


  throw new Error(
    `UTXO ${utxo.txid}:${utxo.vout} thiếu scriptPubKey`
  );

}


// ============================================================
// ADD INPUT TO PSBT
// ============================================================

export async function addInput(
  psbt,
  utxo
) {

  const scriptPubKeyHex =
    getScriptPubKeyHex(
      utxo
    );


  const script =
    Buffer.from(
      scriptPubKeyHex,
      'hex'
    );


  if (
    script.length === 0
  ) {

    throw new Error(
      `UTXO ${utxo.txid}:${utxo.vout} có scriptPubKey rỗng`
    );

  }


  // ==========================================================
  // P2PKH
  //
  // Legacy P2PKH cần nonWitnessUtxo:
  // toàn bộ previous transaction.
  // ==========================================================

  if (
    utxo.type === 'P2PKH'
  ) {

    const previousTx =
      await getRawTransaction(
        utxo.txid
      );


    if (
      !previousTx ||
      !previousTx.hex
    ) {

      throw new Error(
        `Không lấy được previous transaction ${utxo.txid}`
      );

    }


    psbt.addInput({

      hash:
        utxo.txid,

      index:
        utxo.vout,

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
  //
  // Cần:
  // 1. witnessUtxo
  // 2. redeemScript = P2WPKH output script
  // ==========================================================

  if (
    utxo.type === 'P2SH_P2WPKH'
  ) {

    if (
      !p2wpkh.output
    ) {

      throw new Error(
        'Không tạo được redeemScript P2WPKH'
      );

    }


    psbt.addInput({

      hash:
        utxo.txid,

      index:
        utxo.vout,

      witnessUtxo: {

        script,

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
  //
  // Native SegWit P2WPKH chỉ cần witnessUtxo.
  // ==========================================================

  if (
    utxo.type === 'P2WPKH'
  ) {

    psbt.addInput({

      hash:
        utxo.txid,

      index:
        utxo.vout,

      witnessUtxo: {

        script,

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
  //
  // Taproot key-path spend cần:
  // 1. witnessUtxo
  // 2. tapInternalKey
  // ==========================================================

  if (
    utxo.type === 'P2TR'
  ) {

    psbt.addInput({

      hash:
        utxo.txid,

      index:
        utxo.vout,

      witnessUtxo: {

        script,

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
// CREATE PSBT FROM SELECTED UTXOs
// ============================================================

export async function createPsbtFromUtxos(
  selectedUtxos
) {

  if (
    !Array.isArray(
      selectedUtxos
    ) ||
    selectedUtxos.length === 0
  ) {

    throw new Error(
      'Danh sách UTXO được chọn đang trống'
    );

  }


  const psbt =
    new bitcoin.Psbt({
      network
    });


  for (
    const utxo
    of selectedUtxos
  ) {

    await addInput(
      psbt,
      utxo
    );

  }


  return psbt;

}


// ============================================================
// BUILD MIXED DEMO PSBT
//
// Giữ nguyên flow ban đầu:
//
// 5 inputs
// 4.999 BTC output
// 0.001 BTC fee
//
// Chưa broadcast.
// ============================================================

export async function buildMixedDemoPsbt() {

  const utxos =
    await getAllUtxos();


  const selected =
    selectFiveMixedUtxos(
      utxos
    );


  const psbt =
    await createPsbtFromUtxos(
      selected
    );


  const sendAmountSats =
    499_900_000;


  psbt.addOutput({

    address:
      derivedAddresses.P2WPKH,

    value:
      BigInt(
        sendAmountSats
      )

  });


  const inputTotalSats =
    selected.reduce(
      (
        sum,
        utxo
      ) =>
        sum +
        BigInt(
          utxo.amountSats
        ),
      0n
    );


  return {

    psbt,

    selected,

    inputTotalSats,

    sendAmountSats,

    feeSats:
      inputTotalSats -
      BigInt(
        sendAmountSats
      ),

    destination:
      derivedAddresses.P2WPKH

  };

}


// ============================================================
// BUILD USER PAYMENT PSBT
//
// Dùng cho giao dịch thực hiện từ giao diện.
//
// amountSats:
// số satoshi muốn gửi.
//
// feeSats:
// phí transaction.
//
// destination:
// address của người nhận.
//
// changeAddress:
// address của chính user để nhận change.
//
// selectedUtxos:
// UTXO đã được coinselect chọn.
// ============================================================

export async function buildPaymentPsbt({

  selectedUtxos,

  destination,

  amountSats,

  feeSats,

  changeAddress

}) {

  if (
    !Array.isArray(
      selectedUtxos
    ) ||
    selectedUtxos.length === 0
  ) {

    throw new Error(
      'Không có UTXO để tạo transaction'
    );

  }


  const amount =
    BigInt(
      amountSats
    );


  const fee =
    BigInt(
      feeSats
    );


  if (
    amount <= 0n
  ) {

    throw new Error(
      'Số tiền gửi phải lớn hơn 0'
    );

  }


  if (
    fee < 0n
  ) {

    throw new Error(
      'Phí transaction không hợp lệ'
    );

  }


  if (!destination) {

    throw new Error(
      'Thiếu địa chỉ người nhận'
    );

  }


  if (!changeAddress) {

    throw new Error(
      'Thiếu địa chỉ nhận tiền thừa'
    );

  }


  const inputTotalSats =
    selectedUtxos.reduce(
      (
        sum,
        utxo
      ) =>
        sum +
        BigInt(
          utxo.amountSats
        ),
      0n
    );


  const requiredSats =
    amount +
    fee;


  if (
    inputTotalSats <
    requiredSats
  ) {

    throw new Error(
      `Không đủ UTXO. Có ${satsToBtc(inputTotalSats)} BTC, cần ${satsToBtc(requiredSats)} BTC`
    );

  }


  const changeSats =
    inputTotalSats -
    requiredSats;


  const psbt =
    await createPsbtFromUtxos(
      selectedUtxos
    );


  // ==========================================================
  // OUTPUT: NGƯỜI NHẬN
  // ==========================================================

  psbt.addOutput({

    address:
      destination,

    value:
      amount

  });


  // ==========================================================
  // OUTPUT: CHANGE
  //
  // Nếu change >= dust:
  // tạo change output.
  //
  // Nếu nhỏ hơn dust:
  // không tạo change output.
  // Khoản này trở thành fee thực tế.
  // ==========================================================

  const DUST_SATS =
    546n;


  let actualFeeSats =
    fee;


  let actualChangeSats =
    changeSats;


  if (
    changeSats >=
    DUST_SATS
  ) {

    psbt.addOutput({

      address:
        changeAddress,

      value:
        changeSats

    });

  } else {

    actualFeeSats +=
      changeSats;

    actualChangeSats =
      0n;

  }


  return {

    psbt,

    selectedUtxos,

    inputTotalSats,

    amountSats:
      amount,

    feeSats:
      actualFeeSats,

    changeSats:
      actualChangeSats,

    destination,

    changeAddress

  };

}


// ============================================================
// DIRECT CLI DEMO
//
// node transaction.js
//
// Giữ lại để kiểm tra flow Lab ban đầu.
// ============================================================

async function main() {

  console.log('');

  console.log(
    '=============================================='
  );

  console.log(
    'BUILD MIXED PSBT'
  );

  console.log(
    '=============================================='
  );

  console.log('');


  const result =
    await buildMixedDemoPsbt();


  console.log(
    'Selected UTXOs:'
  );

  console.log('');


  result.selected.forEach(
    (
      utxo,
      index
    ) => {

      console.log(

        `Input #${index + 1}:`,

        utxo.type,

        `${utxo.txid}:${utxo.vout}`,

        `${utxo.amountBtc} BTC`

      );

    }
  );


  console.log('');


  console.log(
    'Input total:',
    satsToBtc(
      result.inputTotalSats
    ),
    'BTC'
  );


  console.log(
    'Destination:',
    result.destination
  );


  console.log(
    'Send amount:',
    satsToBtc(
      BigInt(
        result.sendAmountSats
      )
    ),
    'BTC'
  );


  console.log(
    'Fee:',
    satsToBtc(
      result.feeSats
    ),
    'BTC'
  );


  console.log('');


  console.log(
    'Input count:',
    result.psbt.inputCount
  );


  console.log(
    'Output count:',
    result.psbt.txOutputs.length
  );


  console.log('');


  console.log(
    'PSBT Base64:'
  );


  console.log(
    result.psbt.toBase64()
  );


  console.log('');


  console.log(
    '=============================================='
  );

}


const isDirectRun =
  process.argv[1] &&
  process.argv[1]
    .endsWith(
      'transaction.js'
    );


if (isDirectRun) {

  main()
    .catch(
      error => {

        console.error('');

        console.error(
          'TRANSACTION ERROR'
        );

        console.error(
          error.message
        );

        process.exit(1);

      }
    );

}
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

import 'dotenv/config';

import { rpc } from './src-rpc.js';

import {
  getAllUtxos
} from './utxo.js';

bitcoin.initEccLib(ecc);

const ECPair =
  ECPairFactory(ecc);

const network =
  bitcoin.networks.regtest;

const app =
  express();

const PORT =
  Number(
    process.env.PORT || 3000
  );

// ============================================================
// PATHS
// ============================================================

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const TXID_FILE =
  path.join(
    __dirname,
    'signed-tx-id.txt'
  );

const HISTORY_DIR =
  path.join(
    __dirname,
    'data'
  );

const HISTORY_FILE =
  path.join(
    HISTORY_DIR,
    'transaction-history.json'
  );

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
  express.json({
    limit: '100kb'
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);

// ============================================================
// PRIVATE KEY
//
// Chỉ backend được biết.
// Không gửi private key xuống frontend.
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
    'PRIVATE_KEY_HEX phải có đúng 64 ký tự hex.'
  );
}

const keyPair =
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
//
// Tất cả từ cùng một private key.
// ============================================================

const publicKey =
  Buffer.from(
    keyPair.publicKey
  );

const p2pkh =
  bitcoin.payments.p2pkh({
    pubkey: publicKey,
    network
  });

const p2wpkh =
  bitcoin.payments.p2wpkh({
    pubkey: publicKey,
    network
  });

const p2shP2wpkh =
  bitcoin.payments.p2sh({
    redeem: p2wpkh,
    network
  });

const internalXOnly =
  Buffer.from(
    publicKey.subarray(
      1,
      33
    )
  );

const p2tr =
  bitcoin.payments.p2tr({
    internalPubkey:
      internalXOnly,
    network
  });

const addresses = {
  P2PKH:
    p2pkh.address,

  P2SH_P2WPKH:
    p2shP2wpkh.address,

  P2WPKH:
    p2wpkh.address,

  P2TR:
    p2tr.address
};

console.log('');
console.log(
  '=============================================='
);
console.log(
  'BITCOIN LAB ADDRESSES'
);
console.log(
  '=============================================='
);

console.log(
  'P2PKH:        ',
  addresses.P2PKH
);

console.log(
  'P2SH-P2WPKH:  ',
  addresses.P2SH_P2WPKH
);

console.log(
  'P2WPKH:       ',
  addresses.P2WPKH
);

console.log(
  'P2TR:         ',
  addresses.P2TR
);

console.log(
  '=============================================='
);
console.log('');

// ============================================================
// TXID CUỐI CÙNG
// ============================================================

let lastTxid = null;

if (
  fs.existsSync(
    TXID_FILE
  )
) {
  const saved =
    fs.readFileSync(
      TXID_FILE,
      'utf8'
    ).trim();

  if (saved) {
    lastTxid =
      saved;
  }
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_FEE_SATS =
  100_000;

const DUST_SATS =
  546;

// ============================================================
// HISTORY STORAGE
// ============================================================

function ensureHistoryFile() {

  if (
    !fs.existsSync(
      HISTORY_DIR
    )
  ) {
    fs.mkdirSync(
      HISTORY_DIR,
      {
        recursive: true
      }
    );
  }

  if (
    !fs.existsSync(
      HISTORY_FILE
    )
  ) {
    fs.writeFileSync(
      HISTORY_FILE,
      '[]\n',
      'utf8'
    );
  }

}

function readHistory() {

  ensureHistoryFile();

  try {

    const text =
      fs.readFileSync(
        HISTORY_FILE,
        'utf8'
      ).trim();

    if (!text) {
      return [];
    }

    const data =
      JSON.parse(
        text
      );

    return Array.isArray(data)
      ? data
      : [];

  } catch {

    return [];

  }

}

function writeHistory(
  history
) {

  ensureHistoryFile();

  fs.writeFileSync(
    HISTORY_FILE,
    `${JSON.stringify(
      history,
      null,
      2
    )}\n`,
    'utf8'
  );

}

function addHistory(
  entry
) {

  const history =
    readHistory();

  history.unshift(
    entry
  );

  if (
    history.length >
    100
  ) {
    history.length =
      100;
  }

  writeHistory(
    history
  );

  return entry;

}

// ============================================================
// HELPER: BTC -> SATS
// ============================================================

function btcToSats(
  value
) {

  const text =
    String(
      value ?? ''
    ).trim();

  if (
    !/^\d+(\.\d{1,8})?$/.test(
      text
    )
  ) {
    throw new Error(
      'Số BTC không hợp lệ. Tối đa 8 chữ số thập phân.'
    );
  }

  const [
    wholePart,
    fractionPart = ''
  ] =
    text.split('.');

  const whole =
    Number(
      wholePart
    );

  if (
    !Number.isSafeInteger(
      whole
    )
  ) {
    throw new Error(
      'Số BTC quá lớn.'
    );
  }

  const fraction =
    Number(
      (
        fractionPart +
        '00000000'
      ).slice(
        0,
        8
      )
    );

  const sats =
    whole *
      100_000_000 +
    fraction;

  if (
    !Number.isSafeInteger(
      sats
    )
  ) {
    throw new Error(
      'Số lượng quá lớn.'
    );
  }

  return sats;

}

// ============================================================
// HELPER: SATS -> BTC
// ============================================================

function satsToBtc(
  sats
) {

  return (
    Number(
      sats
    ) /
    100_000_000
  ).toFixed(8);

}

// ============================================================
// HELPER: EXTRACT SCRIPT PUBKEY HEX
//
// Bitcoin Core / scantxoutset có thể trả scriptPubKey
// theo các dạng khác nhau tùy phiên bản:
//
// 1. string
// 2. { hex: "..." }
// 3. { script: "..." }
//
// Hàm này chuẩn hóa tất cả về hex.
// ============================================================

function extractScriptPubKeyHex(
  scriptPubKey
) {

  if (
    typeof scriptPubKey ===
    'string'
  ) {

    const value =
      scriptPubKey.trim();

    if (
      /^[0-9a-fA-F]+$/.test(
        value
      ) &&
      value.length % 2 === 0
    ) {
      return value;
    }

  }

  if (
    scriptPubKey &&
    typeof scriptPubKey ===
      'object'
  ) {

    if (
      typeof scriptPubKey.hex ===
      'string'
    ) {

      const value =
        scriptPubKey.hex.trim();

      if (
        /^[0-9a-fA-F]+$/.test(
          value
        ) &&
        value.length % 2 === 0
      ) {
        return value;
      }

    }

    if (
      typeof scriptPubKey.script ===
      'string'
    ) {

      const value =
        scriptPubKey.script.trim();

      if (
        /^[0-9a-fA-F]+$/.test(
          value
        ) &&
        value.length % 2 === 0
      ) {
        return value;
      }

    }

  }

  return null;

}

// ============================================================
// HELPER: GET EXACT SCRIPT PUBKEY FROM PREVIOUS TX
//
// Đây là phần quan trọng sửa lỗi:
//
// "UTXO xxx:vout thiếu scriptPubKey.hex"
//
// Nếu scantxoutset không trả .hex,
// lấy transaction gốc bằng getrawtransaction,
// sau đó lấy:
//
// tx.vout[vout].scriptPubKey.hex
//
// Đây là script chính xác của UTXO.
// ============================================================

async function getExactUtxoScriptHex(
  utxo
) {

  // ----------------------------------------------------------
  // Bước 1: thử dữ liệu đã có
  // ----------------------------------------------------------

  const directHex =
    extractScriptPubKeyHex(
      utxo.scriptPubKey
    );

  if (directHex) {
    return directHex;
  }

  // ----------------------------------------------------------
  // Bước 2: lấy previous transaction
  // ----------------------------------------------------------

  const tx =
    await rpc(
      'getrawtransaction',
      [
        utxo.txid,
        true
      ]
    );

  if (
    !tx ||
    !Array.isArray(
      tx.vout
    )
  ) {
    throw new Error(
      `Không đọc được transaction ${utxo.txid}`
    );
  }

  const voutIndex =
    Number(
      utxo.vout
    );

  const output =
    tx.vout.find(
      item =>
        Number(
          item.n
        ) ===
        voutIndex
    );

  if (!output) {
    throw new Error(
      `Không tìm thấy vout ${voutIndex} trong transaction ${utxo.txid}`
    );
  }

  const scriptHex =
    extractScriptPubKeyHex(
      output.scriptPubKey
    );

  if (!scriptHex) {
    throw new Error(
      `Không lấy được scriptPubKey.hex của UTXO ${utxo.txid}:${utxo.vout}`
    );
  }

  return scriptHex;

}

// ============================================================
// HELPER: NORMALIZE SCRIPT PUBKEY
// ============================================================

async function normalizeUtxoScript(
  utxo
) {

  const scriptHex =
    await getExactUtxoScriptHex(
      utxo
    );

  return {
    ...utxo,

    scriptPubKey: {
      hex:
        scriptHex
    }
  };

}

// ============================================================
// HELPER: NORMALIZE UTXO
// ============================================================

function normalizeUtxo(
  utxo
) {

  const scriptHex =
    extractScriptPubKeyHex(
      utxo.scriptPubKey
    );

  return {

    type:
      utxo.type,

    address:
      utxo.address,

    txid:
      utxo.txid,

    vout:
      Number(
        utxo.vout
      ),

    amountSats:
      Number(
        utxo.amountSats
      ),

    amountBtc:
      satsToBtc(
        utxo.amountSats
      ),

    confirmations:
      Number(
        utxo.confirmations ??
        0
      ),

    height:
      utxo.height,

    scriptPubKey:
      scriptHex
        ? {
            hex:
              scriptHex
          }
        : utxo.scriptPubKey

  };

}

// ============================================================
// MINIMUM INPUT COIN SELECTION
//
// Ưu tiên:
// 1. Ít input nhất.
// 2. Nếu cùng số input -> change nhỏ nhất.
// ============================================================

function selectMinimalUtxos(
  utxos,
  targetSats
) {

  const sorted =
    [...utxos]
      .map(
        normalizeUtxo
      )
      .sort(
        (
          a,
          b
        ) =>
          b.amountSats -
          a.amountSats
      );

  let best =
    null;

  function isBetter(
    candidate
  ) {

    if (!best) {
      return true;
    }

    if (
      candidate.length !==
      best.length
    ) {
      return (
        candidate.length <
        best.length
      );
    }

    const candidateTotal =
      candidate.reduce(
        (
          sum,
          u
        ) =>
          sum +
          u.amountSats,
        0
      );

    const bestTotal =
      best.reduce(
        (
          sum,
          u
        ) =>
          sum +
          u.amountSats,
        0
      );

    return (
      candidateTotal -
        targetSats <
      bestTotal -
        targetSats
    );

  }

  function search(
    index,
    selected,
    total
  ) {

    if (
      total >=
      targetSats
    ) {

      if (
        isBetter(
          selected
        )
      ) {
        best = [
          ...selected
        ];
      }

      return;

    }

    if (
      index >=
      sorted.length
    ) {
      return;
    }

    if (
      best &&
      selected.length >=
        best.length
    ) {
      return;
    }

    // --------------------------------------------------------
    // Chọn UTXO
    // --------------------------------------------------------

    search(
      index + 1,

      [
        ...selected,
        sorted[index]
      ],

      total +
        sorted[index]
          .amountSats
    );

    // --------------------------------------------------------
    // Không chọn UTXO
    // --------------------------------------------------------

    search(
      index + 1,
      selected,
      total
    );

  }

  search(
    0,
    [],
    0
  );

  if (!best) {
    throw new Error(
      `Không đủ UTXO để thực hiện giao dịch. Cần ${satsToBtc(
        targetSats
      )} BTC.`
    );
  }

  return best;

}

// ============================================================
// 5 INPUT MIXED DEMO
//
// 1 P2PKH
// 1 P2SH-P2WPKH
// 1 P2WPKH
// 1 P2TR
// + 1 input bổ sung
// ============================================================

function selectMixedFiveUtxos(
  utxos,
  targetSats
) {

  const normalized =
    utxos.map(
      normalizeUtxo
    );

  const typeOrder = [
    'P2PKH',
    'P2SH_P2WPKH',
    'P2WPKH',
    'P2TR'
  ];

  const selected =
    [];

  for (
    const type
    of typeOrder
  ) {

    const candidates =
      normalized
        .filter(
          u =>
            u.type ===
            type
        )
        .sort(
          (
            a,
            b
          ) =>
            b.amountSats -
            a.amountSats
        );

    if (
      candidates.length ===
      0
    ) {
      throw new Error(
        `Không còn UTXO loại ${type}. Không thể tạo demo 5 input hỗn hợp.`
      );
    }

    selected.push(
      candidates[0]
    );

  }

  const selectedIds =
    new Set(
      selected.map(
        u =>
          `${u.txid}:${u.vout}`
      )
    );

  const remaining =
    normalized
      .filter(
        u =>
          !selectedIds.has(
            `${u.txid}:${u.vout}`
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          b.amountSats -
          a.amountSats
      );

  while (
    selected.length <
      5 &&
    remaining.length >
      0
  ) {

    selected.push(
      remaining.shift()
    );

  }

  if (
    selected.length <
    5
  ) {
    throw new Error(
      'Không còn đủ 5 UTXO để thực hiện demo 5 input.'
    );
  }

  const total =
    selected.reduce(
      (
        sum,
        u
      ) =>
        sum +
        u.amountSats,
      0
    );

  if (
    total <
    targetSats
  ) {
    throw new Error(
      `5 UTXO hỗn hợp chỉ có ${satsToBtc(
        total
      )} BTC, không đủ ${satsToBtc(
        targetSats
      )} BTC.`
    );
  }

  return selected;

}

// ============================================================
// CREATE TRANSACTION PLAN
// ============================================================

function makeTransactionPlan(
  utxos,
  amountSats,
  feeSats,
  mode
) {

  const targetSats =
    amountSats +
    feeSats;

  let selected;

  if (
    mode ===
    'mixed5'
  ) {

    selected =
      selectMixedFiveUtxos(
        utxos,
        targetSats
      );

  } else {

    selected =
      selectMinimalUtxos(
        utxos,
        targetSats
      );

  }

  const inputTotal =
    selected.reduce(
      (
        sum,
        u
      ) =>
        sum +
        u.amountSats,
      0
    );

  let changeSats =
    inputTotal -
    amountSats -
    feeSats;

  let actualFeeSats =
    feeSats;

  if (
    changeSats > 0 &&
    changeSats <
      DUST_SATS
  ) {

    actualFeeSats +=
      changeSats;

    changeSats =
      0;

  }

  return {

    mode:
      mode ===
      'mixed5'
        ? 'mixed5'
        : 'minimal',

    amountSats,

    amountBtc:
      satsToBtc(
        amountSats
      ),

    feeSats:
      actualFeeSats,

    feeBtc:
      satsToBtc(
        actualFeeSats
      ),

    inputTotalSats:
      inputTotal,

    inputTotalBtc:
      satsToBtc(
        inputTotal
      ),

    changeSats,

    changeBtc:
      satsToBtc(
        changeSats
      ),

    selectedCount:
      selected.length,

    selected:
      selected.map(
        normalizeUtxo
      ),

    inputTypes: [
      ...new Set(
        selected.map(
          u =>
            u.type
        )
      )
    ]

  };

}

// ============================================================
// VALIDATE REGTEST ADDRESS
// ============================================================

function validateDestination(
  destination
) {

  if (!destination) {

    throw new Error(
      'Thiếu địa chỉ người nhận.'
    );

  }

  try {

    bitcoin.address
      .toOutputScript(
        destination,
        network
      );

  } catch {

    throw new Error(
      'Địa chỉ không hợp lệ hoặc không phải địa chỉ Bitcoin Regtest.'
    );

  }

  return destination;

}

// ============================================================
// TAPROOT TWEAKED SIGNER
// ============================================================

function getTaprootSigner() {

  if (
    !keyPair.privateKey
  ) {

    throw new Error(
      'Không lấy được private key từ keyPair.'
    );

  }

  const internalPrivateKey =
    Buffer.from(
      keyPair.privateKey
    );

  const xOnlyPubkey =
    Buffer.from(
      keyPair.publicKey.subarray(
        1,
        33
      )
    );

  const tweakHash =
    bitcoin.crypto.taggedHash(
      'TapTweak',
      xOnlyPubkey
    );

  let privateKey =
    internalPrivateKey;

  if (
    keyPair.publicKey[0] ===
    0x03
  ) {

    privateKey =
      Buffer.from(
        ecc.privateNegate(
          privateKey
        )
      );

  }

  const tweakedPrivateKey =
    ecc.privateAdd(
      privateKey,
      tweakHash
    );

  if (
    !tweakedPrivateKey
  ) {

    throw new Error(
      'Không thể tạo Taproot tweaked private key.'
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
// BUILD + SIGN TRANSACTION
//
// P2PKH:
//   nonWitnessUtxo
//
// P2SH-P2WPKH:
//   witnessUtxo + redeemScript
//
// P2WPKH:
//   witnessUtxo
//
// P2TR:
//   witnessUtxo + tapInternalKey
// ============================================================

async function buildAndSignTransaction(
  plan,
  destination
) {

  const psbt =
    new bitcoin.Psbt({
      network
    });

  // ==========================================================
  // INPUTS
  // ==========================================================

  for (
    const utxo
    of plan.selected
  ) {

    // --------------------------------------------------------
    // LẤY SCRIPT PUBKEY CHÍNH XÁC
    //
    // Không còn phụ thuộc cứng vào
    // utxo.scriptPubKey.hex.
    // --------------------------------------------------------

    const scriptHex =
      await getExactUtxoScriptHex(
        utxo
      );

    if (
      !scriptHex
    ) {

      throw new Error(
        `UTXO ${utxo.txid}:${utxo.vout} không có scriptPubKey hợp lệ.`
      );

    }

    const script =
      Buffer.from(
        scriptHex,
        'hex'
      );

    // --------------------------------------------------------
    // P2PKH
    // --------------------------------------------------------

    if (
      utxo.type ===
      'P2PKH'
    ) {

      const rawPrevTx =
        await rpc(
          'getrawtransaction',
          [
            utxo.txid,
            false
          ]
        );

      if (
        typeof rawPrevTx !==
        'string' ||
        !rawPrevTx
      ) {

        throw new Error(
          `Không lấy được raw transaction ${utxo.txid}`
        );

      }

      psbt.addInput({

        hash:
          utxo.txid,

        index:
          Number(
            utxo.vout
          ),

        nonWitnessUtxo:
          Buffer.from(
            rawPrevTx,
            'hex'
          )

      });

    }

    // --------------------------------------------------------
    // P2SH-P2WPKH
    // --------------------------------------------------------

    else if (
      utxo.type ===
      'P2SH_P2WPKH'
    ) {

      if (
        !p2wpkh.output
      ) {

        throw new Error(
          'Không tạo được redeemScript P2WPKH.'
        );

      }

      psbt.addInput({

        hash:
          utxo.txid,

        index:
          Number(
            utxo.vout
          ),

        witnessUtxo: {

          script,

          value:
            BigInt(
              utxo.amountSats
            )

        },

        redeemScript:
          Buffer.from(
            p2wpkh.output
          )

      });

    }

    // --------------------------------------------------------
    // P2WPKH
    // --------------------------------------------------------

    else if (
      utxo.type ===
      'P2WPKH'
    ) {

      psbt.addInput({

        hash:
          utxo.txid,

        index:
          Number(
            utxo.vout
          ),

        witnessUtxo: {

          script,

          value:
            BigInt(
              utxo.amountSats
            )

        }

      });

    }

    // --------------------------------------------------------
    // P2TR
    // --------------------------------------------------------

    else if (
      utxo.type ===
      'P2TR'
    ) {

      psbt.addInput({

        hash:
          utxo.txid,

        index:
          Number(
            utxo.vout
          ),

        witnessUtxo: {

          script,

          value:
            BigInt(
              utxo.amountSats
            )

        },

        tapInternalKey:
          internalXOnly

      });

    }

    else {

      throw new Error(
        `Loại UTXO không được hỗ trợ: ${utxo.type}`
      );

    }

  }

  // ==========================================================
  // OUTPUT: RECIPIENT
  // ==========================================================

  psbt.addOutput({

    address:
      destination,

    value:
      BigInt(
        plan.amountSats
      )

  });

  // ==========================================================
  // OUTPUT: CHANGE
  // ==========================================================

  if (
    plan.changeSats >
    0
  ) {

    psbt.addOutput({

      address:
        addresses.P2WPKH,

      value:
        BigInt(
          plan.changeSats
        )

    });

  }

  // ==========================================================
  // SIGN
  // ==========================================================

  const taprootSigner =
    getTaprootSigner();

  for (
    let i = 0;
    i <
    plan.selected.length;
    i++
  ) {

    const utxo =
      plan.selected[i];

    if (
      utxo.type ===
      'P2TR'
    ) {

      psbt.signInput(
        i,
        taprootSigner
      );

    } else {

      psbt.signInput(
        i,
        keyPair
      );

    }

  }

  // ==========================================================
  // FINALIZE
  // ==========================================================

  psbt.finalizeAllInputs();

  const tx =
    psbt.extractTransaction();

  const rawTx =
    tx.toHex();

  const txid =
    tx.getId();

  return {

    txid,

    rawTx,

    signedInputs:
      plan.selected.length

  };

}

// ============================================================
// API: STATUS
// ============================================================

app.get(
  '/api/status',
  async (
    req,
    res
  ) => {

    try {

      const info =
        await rpc(
          'getblockchaininfo'
        );

      res.json({

        success:
          true,

        chain:
          info.chain,

        blocks:
          info.blocks,

        headers:
          info.headers,

        bestblockhash:
          info.bestblockhash,

        initialblockdownload:
          info.initialblockdownload

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: ADDRESSES
// ============================================================

app.get(
  '/api/addresses',
  (
    req,
    res
  ) => {

    res.json({

      success:
        true,

      addresses

    });

  }
);

// ============================================================
// API: BALANCE
// ============================================================

app.get(
  '/api/balance',
  async (
    req,
    res
  ) => {

    try {

      const utxos =
        await getAllUtxos();

      const byType = {

        P2PKH:
          0,

        P2SH_P2WPKH:
          0,

        P2WPKH:
          0,

        P2TR:
          0

      };

      let totalSats =
        0;

      for (
        const utxo
        of utxos
      ) {

        const sats =
          Number(
            utxo.amountSats
          );

        totalSats +=
          sats;

        if (
          Object.prototype
            .hasOwnProperty
            .call(
              byType,
              utxo.type
            )
        ) {

          byType[
            utxo.type
          ] +=
            sats;

        }

      }

      let minerBalance =
        null;

      try {

        minerBalance =
          await rpc(
            'getbalance'
          );

      } catch {

        minerBalance =
          null;

      }

      res.json({

        success:
          true,

        myWallet: {

          P2PKH:
            satsToBtc(
              byType.P2PKH
            ),

          P2SH_P2WPKH:
            satsToBtc(
              byType.P2SH_P2WPKH
            ),

          P2WPKH:
            satsToBtc(
              byType.P2WPKH
            ),

          P2TR:
            satsToBtc(
              byType.P2TR
            ),

          totalBtc:
            satsToBtc(
              totalSats
            ),

          totalSats,

          utxoCount:
            utxos.length

        },

        faucet: {

          minerBalanceBtc:
            minerBalance ===
            null
              ? null
              : Number(
                  minerBalance
                ).toFixed(8)

        }

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: UTXOS
// ============================================================

app.get(
  '/api/utxos',
  async (
    req,
    res
  ) => {

    try {

      const raw =
        await getAllUtxos();

      const utxos =
        raw.map(
          normalizeUtxo
        );

      const totalSats =
        utxos.reduce(
          (
            sum,
            u
          ) =>
            sum +
            u.amountSats,
          0
        );

      res.json({

        success:
          true,

        totalSats,

        totalBtc:
          satsToBtc(
            totalSats
          ),

        count:
          utxos.length,

        utxos

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: LATEST TRANSACTION
// ============================================================

app.get(
  '/api/transaction',
  async (
    req,
    res
  ) => {

    try {

      if (!lastTxid) {

        return res.json({

          success:
            true,

          transaction:
            null

        });

      }

      const decoded =
        await rpc(
          'getrawtransaction',
          [
            lastTxid,
            true
          ]
        );

      res.json({

        success:
          true,

        transaction:
          decoded

      });

    } catch (
      error
    ) {

      res.status(
        404
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: TRANSACTION DETAIL
// ============================================================

app.get(
  '/api/transactions/:txid',
  async (
    req,
    res
  ) => {

    try {

      const txid =
        req.params.txid;

      if (
        !/^[0-9a-fA-F]{64}$/.test(
          txid
        )
      ) {

        throw new Error(
          'TXID không hợp lệ.'
        );

      }

      const tx =
        await rpc(
          'getrawtransaction',
          [
            txid,
            true
          ]
        );

      res.json({

        success:
          true,

        transaction:
          tx

      });

    } catch (
      error
    ) {

      res.status(
        404
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: TRANSACTION HISTORY
//
// Lịch sử thao tác từ Web App.
//
// Không dùng listtransactions của miner làm
// lịch sử chính của Lab Wallet.
// ============================================================

app.get(
  '/api/transactions',
  async (
    req,
    res
  ) => {

    try {

      const count =
        Math.min(
          Math.max(
            Number(
              req.query.count ||
              30
            ),
            1
          ),
          100
        );

      const history =
        readHistory()
          .slice(
            0,
            count
          );

      const enriched =
        [];

      for (
        const item
        of history
      ) {

        const copy = {
          ...item
        };

        if (
          item.txid
        ) {

          try {

            const tx =
              await rpc(
                'getrawtransaction',
                [
                  item.txid,
                  true
                ]
              );

            copy.confirmations =
              Number(
                tx.confirmations ||
                0
              );

            copy.blockhash =
              tx.blockhash ||
              null;

            if (
              tx.confirmations >
              0
            ) {

              copy.status =
                'confirmed';

            } else {

              copy.status =
                'broadcast';

            }

          } catch {

            // Giữ trạng thái cũ
            // nếu transaction chưa được chainstate nhận.

          }

        }

        enriched.push(
          copy
        );

      }

      res.json({

        success:
          true,

        transactions:
          enriched

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: PREVIEW TRANSACTION
// ============================================================

app.post(
  '/api/transaction/preview',
  async (
    req,
    res
  ) => {

    try {

      const {
        destination,
        amountBtc,
        feeSats,
        mode
      } = req.body;

      const validDestination =
        validateDestination(
          String(
            destination ||
            ''
          ).trim()
        );

      const amountSats =
        btcToSats(
          amountBtc
        );

      if (
        amountSats <=
        0
      ) {

        throw new Error(
          'Số lượng BTC phải lớn hơn 0.'
        );

      }

      const actualFeeSats =
        feeSats ===
          undefined ||
        feeSats === ''
          ? DEFAULT_FEE_SATS
          : Number(
              feeSats
            );

      if (
        !Number.isSafeInteger(
          actualFeeSats
        ) ||
        actualFeeSats <
          0
      ) {

        throw new Error(
          'Fee phải là số nguyên satoshi hợp lệ.'
        );

      }

      const utxos =
        await getAllUtxos();

      const plan =
        makeTransactionPlan(
          utxos,
          amountSats,
          actualFeeSats,
          mode
        );

      res.json({

        success:
          true,

        destination:
          validDestination,

        ...plan

      });

    } catch (
      error
    ) {

      res.status(
        400
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: SEND TRANSACTION
//
// Flow:
//
// 1. Scan UTXO
// 2. Coin selection
// 3. Build PSBT
// 4. Sign bằng bitcoinjs-lib
// 5. Finalize
// 6. Broadcast
// 7. Save TXID
// 8. Save history
// ============================================================

app.post(
  '/api/transaction/send',
  async (
    req,
    res
  ) => {

    let historyEntry =
      null;

    try {

      const {
        destination,
        amountBtc,
        feeSats,
        mode
      } = req.body;

      const validDestination =
        validateDestination(
          String(
            destination ||
            ''
          ).trim()
        );

      const amountSats =
        btcToSats(
          amountBtc
        );

      if (
        amountSats <=
        0
      ) {

        throw new Error(
          'Số lượng BTC phải lớn hơn 0.'
        );

      }

      const actualFeeSats =
        feeSats ===
          undefined ||
        feeSats === ''
          ? DEFAULT_FEE_SATS
          : Number(
              feeSats
            );

      if (
        !Number.isSafeInteger(
          actualFeeSats
        ) ||
        actualFeeSats <
          0
      ) {

        throw new Error(
          'Fee phải là số nguyên satoshi hợp lệ.'
        );

      }

      // --------------------------------------------------------
      // SCAN UTXO
      // --------------------------------------------------------

      const utxos =
        await getAllUtxos();

      // --------------------------------------------------------
      // COIN SELECTION
      // --------------------------------------------------------

      const plan =
        makeTransactionPlan(
          utxos,
          amountSats,
          actualFeeSats,
          mode
        );

      // --------------------------------------------------------
      // HISTORY ENTRY
      // --------------------------------------------------------

      historyEntry = {

        id:
          `${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`,

        createdAt:
          new Date().toISOString(),

        status:
          'pending',

        destination:
          validDestination,

        amountBtc:
          plan.amountBtc,

        feeBtc:
          plan.feeBtc,

        changeBtc:
          plan.changeBtc,

        selectedCount:
          plan.selectedCount,

        signedInputs:
          0,

        inputTypes:
          plan.inputTypes,

        mode:
          plan.mode,

        txid:
          null,

        confirmations:
          0,

        error:
          null

      };

      addHistory(
        historyEntry
      );

      // --------------------------------------------------------
      // BUILD + SIGN
      // --------------------------------------------------------

      const signed =
        await buildAndSignTransaction(
          plan,
          validDestination
        );

      // --------------------------------------------------------
      // UPDATE SIGNED INPUT COUNT
      // --------------------------------------------------------

      historyEntry.signedInputs =
        signed.signedInputs;

      // --------------------------------------------------------
      // BROADCAST
      // --------------------------------------------------------

      const broadcastTxid =
        await rpc(
          'sendrawtransaction',
          [
            signed.rawTx
          ]
        );

      // --------------------------------------------------------
      // SAVE TXID
      // --------------------------------------------------------

      lastTxid =
        broadcastTxid;

      fs.writeFileSync(
        TXID_FILE,
        `${broadcastTxid}\n`,
        'utf8'
      );

      // --------------------------------------------------------
      // UPDATE HISTORY
      // --------------------------------------------------------

      historyEntry.txid =
        broadcastTxid;

      historyEntry.status =
        'broadcast';

      historyEntry.broadcastAt =
        new Date().toISOString();

      historyEntry.error =
        null;

      const history =
        readHistory();

      const index =
        history.findIndex(
          item =>
            item.id ===
            historyEntry.id
        );

      if (
        index >=
        0
      ) {

        history[index] =
          historyEntry;

        writeHistory(
          history
        );

      } else {

        addHistory(
          historyEntry
        );

      }

      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      res.json({

        success:
          true,

        txid:
          broadcastTxid,

        destination:
          validDestination,

        amountBtc:
          plan.amountBtc,

        feeBtc:
          plan.feeBtc,

        changeBtc:
          plan.changeBtc,

        selectedCount:
          plan.selectedCount,

        signedInputs:
          signed.signedInputs,

        inputTypes:
          plan.inputTypes,

        selected:
          plan.selected,

        status:
          'broadcast'

      });

    } catch (
      error
    ) {

      // --------------------------------------------------------
      // SAVE FAILED TRANSACTION
      // --------------------------------------------------------

      if (
        historyEntry
      ) {

        historyEntry.status =
          'failed';

        historyEntry.error =
          error.message;

        historyEntry.failedAt =
          new Date().toISOString();

        const history =
          readHistory();

        const index =
          history.findIndex(
            item =>
              item.id ===
              historyEntry.id
          );

        if (
          index >=
          0
        ) {

          history[index] =
            historyEntry;

          writeHistory(
            history
          );

        }

      } else {

        addHistory({

          id:
            `${Date.now()}-${Math.random()
              .toString(16)
              .slice(2)}`,

          createdAt:
            new Date().toISOString(),

          status:
            'failed',

          destination:
            req.body?.destination ||
            null,

          amountBtc:
            req.body?.amountBtc ||
            null,

          feeBtc:
            null,

          changeBtc:
            null,

          selectedCount:
            0,

          signedInputs:
            0,

          inputTypes:
            [],

          mode:
            req.body?.mode ||
            'minimal',

          txid:
            null,

          confirmations:
            0,

          error:
            error.message

        });

      }

      res.status(
        400
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: FAUCET
//
// Miner wallet -> 1 trong 4 address.
//
// Không tự mine.
//
// Sau faucet:
//   /api/mine
// ============================================================

app.post(
  '/api/faucet',
  async (
    req,
    res
  ) => {

    try {

      const {
        type,
        amountBtc
      } = req.body;

      if (
        !Object.prototype
          .hasOwnProperty
          .call(
            addresses,
            type
          )
      ) {

        throw new Error(
          'Loại address faucet không hợp lệ.'
        );

      }

      const amountSats =
        btcToSats(
          amountBtc
        );

      if (
        amountSats <=
        0
      ) {

        throw new Error(
          'Số lượng faucet phải lớn hơn 0.'
        );

      }

      const amount =
        satsToBtc(
          amountSats
        );

      const txid =
        await rpc(
          'sendtoaddress',
          [
            addresses[type],
            Number(
              amount
            )
          ]
        );

      res.json({

        success:
          true,

        txid,

        type,

        address:
          addresses[type],

        amountBtc:
          amount,

        status:
          'broadcast',

        message:
          'Faucet đã được broadcast. Hãy Mine 1 block để xác nhận.'

      });

    } catch (
      error
    ) {

      res.status(
        400
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: MINE 1 BLOCK
//
// Dùng để xác nhận faucet / transaction.
// ============================================================

app.post(
  '/api/mine',
  async (
    req,
    res
  ) => {

    try {

      const miningAddress =
        await rpc(
          'getnewaddress',
          [
            '',
            'bech32'
          ]
        );

      const blocks =
        await rpc(
          'generatetoaddress',
          [
            1,
            miningAddress
          ]
        );

      res.json({

        success:
          true,

        blocks,

        miningAddress,

        message:
          'Đã mine 1 block thành công.'

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: RESET / REFRESH
//
// Không reset blockchain.
//
// Chỉ đọc:
// - blockchain
// - UTXO
// - history
// - TX cuối cùng
// ============================================================

app.post(
  '/api/reset',
  async (
    req,
    res
  ) => {

    try {

      const [
        blockchainInfo,
        utxos
      ] =
        await Promise.all([

          rpc(
            'getblockchaininfo'
          ),

          getAllUtxos()

        ]);

      let latestTransaction =
        null;

      if (
        lastTxid
      ) {

        try {

          latestTransaction =
            await rpc(
              'getrawtransaction',
              [
                lastTxid,
                true
              ]
            );

        } catch {

          latestTransaction =
            null;

        }

      }

      const balanceSats =
        utxos.reduce(
          (
            sum,
            u
          ) =>
            sum +
            Number(
              u.amountSats
            ),
          0
        );

      res.json({

        success:
          true,

        blockchain: {

          chain:
            blockchainInfo.chain,

          blocks:
            blockchainInfo.blocks,

          headers:
            blockchainInfo.headers,

          bestblockhash:
            blockchainInfo.bestblockhash

        },

        utxoCount:
          utxos.length,

        balanceBtc:
          satsToBtc(
            balanceSats
          ),

        latestTransaction,

        history:
          readHistory()

      });

    } catch (
      error
    ) {

      res.status(
        500
      ).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);

// ============================================================
// API: HEALTH CHECK
// ============================================================

app.get(
  '/api/health',
  async (
    req,
    res
  ) => {

    try {

      const info =
        await rpc(
          'getblockchaininfo'
        );

      res.json({

        success:
          true,

        server:
          'ok',

        bitcoinCore:
          'ok',

        chain:
          info.chain,

        blocks:
          info.blocks

      });

    } catch (
      error
    ) {

      res.status(
        503
      ).json({

        success:
          false,

        server:
          'ok',

        bitcoinCore:
          'error',

        error:
          error.message

      });

    }

  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  () => {

    console.log('');

    console.log(
      '=============================================='
    );

    console.log(
      'BITCOIN REGTEST WEB APP'
    );

    console.log(
      '=============================================='
    );

    console.log(
      `Server running at http://localhost:${PORT}`
    );

    console.log(
      `History file: ${HISTORY_FILE}`
    );

    console.log(
      '=============================================='
    );

    console.log('');

  }
);
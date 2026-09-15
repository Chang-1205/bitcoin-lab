import express from 'express';
import fs from 'node:fs';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';

import { rpc } from './src-rpc.js';
import { getAllUtxos } from './utxo.js';

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.regtest;

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

// ============================================================
// PRIVATE KEY - CHỈ SERVER ĐƯỢC BIẾT
// ============================================================

const privateKeyHex = process.env.PRIVATE_KEY_HEX;

if (!privateKeyHex) {
  throw new Error('Thiếu PRIVATE_KEY_HEX trong .env');
}

if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
  throw new Error('PRIVATE_KEY_HEX phải có đúng 64 ký tự hex');
}

const keyPair = ECPair.fromPrivateKey(
  Buffer.from(privateKeyHex, 'hex'),
  { network }
);

// ============================================================
// DERIVE 4 ADDRESS TYPES TỪ CÙNG 1 PRIVATE KEY
// ============================================================

const publicKey = Buffer.from(keyPair.publicKey);

const p2pkh = bitcoin.payments.p2pkh({
  pubkey: publicKey,
  network
});

const p2wpkh = bitcoin.payments.p2wpkh({
  pubkey: publicKey,
  network
});

const p2shP2wpkh = bitcoin.payments.p2sh({
  redeem: p2wpkh,
  network
});

const internalXOnly = publicKey.subarray(1, 33);

const p2tr = bitcoin.payments.p2tr({
  internalPubkey: internalXOnly,
  network
});

const addresses = {
  P2PKH: p2pkh.address,
  P2SH_P2WPKH: p2shP2wpkh.address,
  P2WPKH: p2wpkh.address,
  P2TR: p2tr.address
};

console.log('\n=== BITCOIN LAB ADDRESSES ===');
console.log('P2PKH:        ', addresses.P2PKH);
console.log('P2SH-P2WPKH:  ', addresses.P2SH_P2WPKH);
console.log('P2WPKH:       ', addresses.P2WPKH);
console.log('P2TR:         ', addresses.P2TR);
console.log('==============================\n');

// ============================================================
// FILE LƯU TXID CUỐI CÙNG
// ============================================================

const TXID_FILE = new URL('./signed-tx-id.txt', import.meta.url);

let lastTxid = null;

if (fs.existsSync(TXID_FILE)) {
  const saved = fs.readFileSync(TXID_FILE, 'utf8').trim();

  if (saved) {
    lastTxid = saved;
  }
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_FEE_SATS = 100_000;
const DUST_SATS = 546;

// ============================================================
// HELPER: BTC -> SATS
// ============================================================

function btcToSats(value) {
  const text = String(value ?? '').trim();

  if (!/^\d+(\.\d{1,8})?$/.test(text)) {
    throw new Error(
      'Số BTC không hợp lệ. Tối đa 8 chữ số thập phân.'
    );
  }

  const [wholePart, fractionPart = ''] = text.split('.');

  const whole = Number(wholePart);

  if (!Number.isSafeInteger(whole)) {
    throw new Error('Số BTC quá lớn.');
  }

  const fraction = Number(
    (fractionPart + '00000000').slice(0, 8)
  );

  const sats = whole * 100_000_000 + fraction;

  if (!Number.isSafeInteger(sats)) {
    throw new Error('Số lượng quá lớn.');
  }

  return sats;
}

// ============================================================
// HELPER: SATS -> BTC
// ============================================================

function satsToBtc(sats) {
  return (Number(sats) / 100_000_000).toFixed(8);
}

// ============================================================
// HELPER: FORMAT UTXO
// ============================================================

function normalizeUtxo(utxo) {
  return {
    type: utxo.type,
    address: utxo.address,
    txid: utxo.txid,
    vout: utxo.vout,
    amountSats: Number(utxo.amountSats),
    amountBtc: satsToBtc(utxo.amountSats),
    confirmations: Number(utxo.confirmations ?? 0),
    height: utxo.height,
    scriptPubKey: utxo.scriptPubKey
  };
}

// ============================================================
// MINIMUM INPUT COIN SELECTION
//
// Ưu tiên:
// 1. Ít UTXO nhất
// 2. Nếu cùng số input -> change nhỏ nhất
// ============================================================

function selectMinimalUtxos(utxos, targetSats) {
  const sorted = [...utxos]
    .map(normalizeUtxo)
    .sort((a, b) => b.amountSats - a.amountSats);

  let best = null;

  function isBetter(candidate) {
    if (!best) {
      return true;
    }

    if (candidate.length !== best.length) {
      return candidate.length < best.length;
    }

    const candidateTotal = candidate.reduce(
      (sum, u) => sum + u.amountSats,
      0
    );

    const bestTotal = best.reduce(
      (sum, u) => sum + u.amountSats,
      0
    );

    return (
      candidateTotal - targetSats <
      bestTotal - targetSats
    );
  }

  function search(index, selected, total) {
    if (total >= targetSats) {
      if (isBetter(selected)) {
        best = [...selected];
      }

      return;
    }

    if (index >= sorted.length) {
      return;
    }

    if (
      best &&
      selected.length >= best.length
    ) {
      return;
    }

    // Chọn UTXO hiện tại
    search(
      index + 1,
      [...selected, sorted[index]],
      total + sorted[index].amountSats
    );

    // Không chọn UTXO hiện tại
    search(
      index + 1,
      selected,
      total
    );
  }

  search(0, [], 0);

  if (!best) {
    throw new Error(
      `Không đủ UTXO để thực hiện giao dịch. Cần ${satsToBtc(targetSats)} BTC.`
    );
  }

  return best;
}

// ============================================================
// 5 INPUT MIXED DEMO
//
// Chọn ít nhất 1 UTXO của mỗi loại.
// Sau đó thêm input cho đủ 5.
// ============================================================

function selectMixedFiveUtxos(utxos, targetSats) {
  const normalized = utxos.map(normalizeUtxo);

  const typeOrder = [
    'P2PKH',
    'P2SH_P2WPKH',
    'P2WPKH',
    'P2TR'
  ];

  const selected = [];

  for (const type of typeOrder) {
    const candidates = normalized
      .filter(u => u.type === type)
      .sort((a, b) => b.amountSats - a.amountSats);

    if (candidates.length === 0) {
      throw new Error(
        `Không còn UTXO loại ${type}. Không thể tạo demo 5 input hỗn hợp.`
      );
    }

    selected.push(candidates[0]);
  }

  const selectedIds = new Set(
    selected.map(u => `${u.txid}:${u.vout}`)
  );

  const remaining = normalized
    .filter(
      u => !selectedIds.has(`${u.txid}:${u.vout}`)
    )
    .sort((a, b) => b.amountSats - a.amountSats);

  while (
    selected.length < 5 &&
    remaining.length > 0
  ) {
    selected.push(remaining.shift());
  }

  if (selected.length < 5) {
    throw new Error(
      'Không còn đủ 5 UTXO để thực hiện demo 5 input.'
    );
  }

  const total = selected.reduce(
    (sum, u) => sum + u.amountSats,
    0
  );

  if (total < targetSats) {
    throw new Error(
      `5 UTXO hỗn hợp chỉ có ${satsToBtc(total)} BTC, không đủ ${satsToBtc(targetSats)} BTC.`
    );
  }

  return selected;
}

// ============================================================
// TẠO PLAN GIAO DỊCH
// ============================================================

function makeTransactionPlan(
  utxos,
  amountSats,
  feeSats,
  mode
) {
  const targetSats =
    amountSats + feeSats;

  let selected;

  if (mode === 'mixed5') {
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
      (sum, u) =>
        sum + u.amountSats,
      0
    );

  let changeSats =
    inputTotal -
    amountSats -
    feeSats;

  let actualFeeSats =
    feeSats;

  // Nếu change quá nhỏ thì cộng vào fee
  if (
    changeSats > 0 &&
    changeSats < DUST_SATS
  ) {
    actualFeeSats += changeSats;
    changeSats = 0;
  }

  return {
    mode:
      mode === 'mixed5'
        ? 'mixed5'
        : 'minimal',

    amountSats,

    amountBtc:
      satsToBtc(amountSats),

    feeSats:
      actualFeeSats,

    feeBtc:
      satsToBtc(actualFeeSats),

    inputTotalSats:
      inputTotal,

    inputTotalBtc:
      satsToBtc(inputTotal),

    changeSats,

    changeBtc:
      satsToBtc(changeSats),

    selectedCount:
      selected.length,

    selected:
      selected.map(normalizeUtxo),

    inputTypes: [
      ...new Set(
        selected.map(
          u => u.type
        )
      )
    ]
  };
}

// ============================================================
// VALIDATE DESTINATION
// ============================================================

function validateDestination(destination) {
  if (!destination) {
    throw new Error(
      'Thiếu địa chỉ người nhận.'
    );
  }

  try {
    bitcoin.address.toOutputScript(
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
  if (!keyPair.privateKey) {
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

  // Nếu public key có parity odd,
  // dùng private key bị negate trước khi tweak.
  if (
    keyPair.publicKey[0] === 0x03
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

  if (!tweakedPrivateKey) {
    throw new Error(
      'Không thể tạo Taproot tweaked private key.'
    );
  }

  return ECPair.fromPrivateKey(
    Buffer.from(
      tweakedPrivateKey
    ),
    { network }
  );
}

// ============================================================
// BUILD + SIGN PSBT
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
    const utxo of plan.selected
  ) {
    if (
      !utxo.scriptPubKey?.hex
    ) {
      throw new Error(
        `UTXO ${utxo.txid}:${utxo.vout} thiếu scriptPubKey.hex`
      );
    }

    const script =
      Buffer.from(
        utxo.scriptPubKey.hex,
        'hex'
      );

    // --------------------------------------------------------
    // P2PKH
    // --------------------------------------------------------

    if (
      utxo.type === 'P2PKH'
    ) {
      const rawPrevTx =
        await rpc(
          'getrawtransaction',
          [
            utxo.txid,
            false
          ]
        );

      psbt.addInput({
        hash:
          utxo.txid,

        index:
          utxo.vout,

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
          utxo.vout,

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
          Buffer.from(
            internalXOnly
          )
      });
    }

    else {
      throw new Error(
        `Loại UTXO không được hỗ trợ: ${utxo.type}`
      );
    }
  }

  // ==========================================================
  // OUTPUT: NGƯỜI NHẬN
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
  //
  // Trả change về P2WPKH của lab.
  // ==========================================================

  if (
    plan.changeSats > 0
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
    i < plan.selected.length;
    i++
  ) {
    const utxo =
      plan.selected[i];

    if (
      utxo.type === 'P2TR'
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
  async (req, res) => {
    try {
      const info =
        await rpc(
          'getblockchaininfo'
        );

      res.json({
        success: true,

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

    } catch (error) {
      res.status(500).json({
        success: false,
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
  (req, res) => {
    res.json({
      success: true,
      addresses
    });
  }
);

// ============================================================
// API: BALANCE
// ============================================================

app.get(
  '/api/balance',
  async (req, res) => {
    try {
      const utxos =
        await getAllUtxos();

      const byType = {
        P2PKH: 0,
        P2SH_P2WPKH: 0,
        P2WPKH: 0,
        P2TR: 0
      };

      let totalSats = 0;

      for (
        const raw of utxos
      ) {
        const sats =
          Number(
            raw.amountSats
          );

        totalSats +=
          sats;

        if (
          Object.prototype.hasOwnProperty.call(
            byType,
            raw.type
          )
        ) {
          byType[raw.type] +=
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
        success: true,

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

    } catch (error) {
      res.status(500).json({
        success: false,
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
  async (req, res) => {
    try {
      const raw =
        await getAllUtxos();

      const utxos =
        raw.map(
          normalizeUtxo
        );

      const totalSats =
        utxos.reduce(
          (sum, u) =>
            sum + u.amountSats,
          0
        );

      res.json({
        success: true,

        totalSats,

        totalBtc:
          satsToBtc(
            totalSats
          ),

        count:
          utxos.length,

        utxos
      });

    } catch (error) {
      res.status(500).json({
        success: false,
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
  async (req, res) => {
    try {
      if (!lastTxid) {
        return res.json({
          success: true,
          transaction: null
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
        success: true,

        transaction:
          decoded
      });

    } catch (error) {
      res.status(404).json({
        success: false,
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
  async (req, res) => {
    try {
      const txid =
        req.params.txid;

      const tx =
        await rpc(
          'getrawtransaction',
          [
            txid,
            true
          ]
        );

      res.json({
        success: true,

        transaction:
          tx
      });

    } catch (error) {
      res.status(404).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

// ============================================================
// API: TRANSACTION HISTORY
//
// Lịch sử của miner wallet / faucet.
// ============================================================

app.get(
  '/api/transactions',
  async (req, res) => {
    try {
      const count =
        Math.min(
          Math.max(
            Number(
              req.query.count || 30
            ),
            1
          ),
          100
        );

      const transactions =
        await rpc(
          'listtransactions',
          [
            '*',
            count,
            0,
            true
          ]
        );

      res.json({
        success: true,

        transactions
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

// ============================================================
// API: PREVIEW TRANSACTION
//
// Không ký.
// Không broadcast.
// Chỉ chọn UTXO và tính:
// - input
// - amount
// - fee
// - change
// ============================================================

app.post(
  '/api/transaction/preview',
  async (req, res) => {
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
            destination || ''
          ).trim()
        );

      const amountSats =
        btcToSats(
          amountBtc
        );

      if (
        amountSats <= 0
      ) {
        throw new Error(
          'Số lượng BTC phải lớn hơn 0.'
        );
      }

      const actualFeeSats =
        feeSats === undefined ||
        feeSats === ''
          ? DEFAULT_FEE_SATS
          : Number(
              feeSats
            );

      if (
        !Number.isSafeInteger(
          actualFeeSats
        ) ||
        actualFeeSats < 0
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
        success: true,

        destination:
          validDestination,

        ...plan
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

// ============================================================
// API: SEND TRANSACTION
//
// 1. Scan UTXO mới nhất
// 2. Chọn UTXO
// 3. Tạo PSBT
// 4. Ký bằng SDK
// 5. Finalize
// 6. Broadcast Bitcoin Core
// 7. Lưu TXID
// ============================================================

app.post(
  '/api/transaction/send',
  async (req, res) => {
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
            destination || ''
          ).trim()
        );

      const amountSats =
        btcToSats(
          amountBtc
        );

      if (
        amountSats <= 0
      ) {
        throw new Error(
          'Số lượng BTC phải lớn hơn 0.'
        );
      }

      const actualFeeSats =
        feeSats === undefined ||
        feeSats === ''
          ? DEFAULT_FEE_SATS
          : Number(
              feeSats
            );

      if (
        !Number.isSafeInteger(
          actualFeeSats
        ) ||
        actualFeeSats < 0
      ) {
        throw new Error(
          'Fee phải là số nguyên satoshi hợp lệ.'
        );
      }

      // --------------------------------------------------------
      // QUÉT LẠI UTXO NGAY TRƯỚC KHI KÝ
      // --------------------------------------------------------

      const utxos =
        await getAllUtxos();

      // --------------------------------------------------------
      // CHỌN INPUT
      // --------------------------------------------------------

      const plan =
        makeTransactionPlan(
          utxos,
          amountSats,
          actualFeeSats,
          mode
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
      // LƯU TXID
      // --------------------------------------------------------

      lastTxid =
        broadcastTxid;

      fs.writeFileSync(
        TXID_FILE,
        `${broadcastTxid}\n`,
        'utf8'
      );

      res.json({
        success: true,

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
          plan.selected
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

// ============================================================
// API: FAUCET
//
// Miner wallet -> một trong 4 address
// ============================================================

app.post(
  '/api/faucet',
  async (req, res) => {
    try {
      const {
        type,
        amountBtc
      } = req.body;

      if (
        !Object.prototype.hasOwnProperty.call(
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
        amountSats <= 0
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
            Number(amount)
          ]
        );

      res.json({
        success: true,

        txid,

        type,

        address:
          addresses[type],

        amountBtc:
          amount
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

// ============================================================
// API: MINE 1 BLOCK
//
// Miner wallet tạo address nhận coinbase.
// Dùng để xác nhận giao dịch faucet / giao dịch mới.
// ============================================================

app.post(
  '/api/mine',
  async (req, res) => {
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
        success: true,

        blocks,

        miningAddress
      });

    } catch (error) {
      res.status(500).json({
        success: false,
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
    console.log(
      '\n=============================================='
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
      '==============================================\n'
    );
  }
);
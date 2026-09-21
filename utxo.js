import { rpc } from './src-rpc.js';


// ============================================================
// LAB WALLET ADDRESSES
// ============================================================

export const addresses = {

  P2PKH:
    'miDFDuixvjXdEGmQZWp5FnLYpzHQSM8MtX',

  P2SH_P2WPKH:
    '2Mvh2PNnZvZRAvwHrEMCsUpbAagtWwXRbcw',

  P2WPKH:
    'bcrt1qrk8s2u5edc35p9jh7cudqmjgag43cxl4wnn339',

  P2TR:
    'bcrt1pvfk8hp0hh27kw2cltl486wzr2g53fp8n9cmjpf6zw84s9ddfy0tsj7ynfc'

};


// ============================================================
// SCAN LOCK
//
// Bitcoin Core chỉ cho phép một scantxoutset scan chạy
// tại một thời điểm.
//
// Nếu /api/balance và /api/utxos được gọi gần như đồng thời,
// cả hai sẽ dùng chung Promise scan thay vì tạo 2 scan.
//
// Điều này tránh lỗi:
//
// "Scan already in progress, use action abort or status"
// ============================================================

let activeScanPromise = null;


// ============================================================
// BTC -> SATOSHI
//
// Không dùng trực tiếp:
//
// amount * 100_000_000
//
// để hạn chế sai số floating-point.
//
// Ví dụ:
//
// "1.00000000" -> 100000000
// "4.99900000" -> 499900000
// ============================================================

export function btcToSats(value) {

  if (
    value === null ||
    value === undefined
  ) {

    throw new Error(
      'Giá trị BTC không hợp lệ'
    );

  }

  const text =
    String(value).trim();

  if (
    !/^\d+(\.\d{1,8})?$/.test(text)
  ) {

    throw new Error(
      `Giá trị BTC không hợp lệ: ${text}`
    );

  }

  const [
    wholePart,
    fractionPart = ''
  ] =
    text.split('.');

  const fraction =
    fractionPart
      .padEnd(8, '0');

  return (
    BigInt(wholePart) *
      100_000_000n
    +
    BigInt(fraction)
  );

}


// ============================================================
// SATOSHI -> BTC STRING
//
// Dùng cho API/UI.
// Không dùng Number(sats) khi cần độ chính xác tuyệt đối.
// ============================================================

export function satsToBtc(sats) {

  const value =
    typeof sats === 'bigint'
      ? sats
      : BigInt(sats);

  const whole =
    value / 100_000_000n;

  const fraction =
    (
      value %
      100_000_000n
    )
      .toString()
      .padStart(8, '0');

  return `${whole}.${fraction}`;

}


// ============================================================
// NORMALIZE SCRIPT PUBKEY
//
// Bitcoin Core có thể trả:
//
// 1. scriptPubKey: "76a914...88ac"
//
// hoặc ở một số ngữ cảnh:
//
// 2. scriptPubKey: {
//      hex: "76a914...88ac"
//    }
//
// Chuẩn hóa về chuỗi hex để transaction.js sử dụng thống nhất.
// ============================================================

function normalizeScriptPubKey(scriptPubKey) {

  if (
    typeof scriptPubKey === 'string'
  ) {

    return scriptPubKey;

  }

  if (
    scriptPubKey &&
    typeof scriptPubKey.hex === 'string'
  ) {

    return scriptPubKey.hex;

  }

  return '';

}


// ============================================================
// INTERNAL SCAN
//
// Chỉ thực hiện đúng một vòng scan cho 4 địa chỉ.
// Hàm này không có lock.
// Lock được quản lý bởi getAllUtxos() bên dưới.
// ============================================================

async function scanAllUtxos() {

  const allUtxos = [];

  for (
    const [type, address]
    of Object.entries(addresses)
  ) {

    const result =
      await rpc(
        'scantxoutset',
        [
          'start',
          [
            `addr(${address})`
          ]
        ]
      );

    const unspents =
      Array.isArray(result?.unspents)
        ? result.unspents
        : [];

    for (
      const utxo
      of unspents
    ) {

      const amountSats =
        btcToSats(
          utxo.amount
        );


      const scriptPubKey =
        normalizeScriptPubKey(
          utxo.scriptPubKey
        );


      if (!scriptPubKey) {

        throw new Error(
          `UTXO ${utxo.txid}:${utxo.vout} thiếu scriptPubKey`
        );

      }


      allUtxos.push({

        type,

        address,

        txid:
          utxo.txid,

        vout:
          Number(utxo.vout),

        amountBtc:
          satsToBtc(
            amountSats
          ),

        amountSats,

        // Luôn chuẩn hóa thành chuỗi hex.
        scriptPubKey,

        confirmations:
          Number(
            utxo.confirmations ?? 0
          ),

        height:
          Number(
            utxo.height ?? 0
          )

      });

    }

  }

  return allUtxos;

}


// ============================================================
// GET ALL UTXOs
//
// Nguồn dữ liệu duy nhất:
// Bitcoin Core Regtest chainstate.
//
// Không lấy balance từ frontend.
// Không lưu balance giả.
//
// Có scan lock để tránh nhiều scantxoutset chạy đồng thời.
// ============================================================

export async function getAllUtxos() {

  // ----------------------------------------------------------
  // Nếu đã có một scan đang chạy,
  // dùng chung Promise đó.
  // ----------------------------------------------------------

  if (activeScanPromise) {

    return activeScanPromise;

  }


  // ----------------------------------------------------------
  // Tạo scan mới.
  // ----------------------------------------------------------

  activeScanPromise =
    scanAllUtxos();


  try {

    return await activeScanPromise;

  } finally {

    // --------------------------------------------------------
    // Luôn giải phóng lock kể cả khi scan bị lỗi.
    // --------------------------------------------------------

    activeScanPromise = null;

  }

}


// ============================================================
// GET TOTAL BALANCE
//
// Balance = tổng UTXO hiện có của 4 lab addresses.
//
// Không lấy từ dữ liệu frontend.
// ============================================================

export async function getTotalBalance() {

  const utxos =
    await getAllUtxos();

  let totalSats =
    0n;

  for (
    const utxo
    of utxos
  ) {

    totalSats +=
      utxo.amountSats;

  }

  return {

    totalSats,

    totalBtc:
      satsToBtc(
        totalSats
      ),

    utxoCount:
      utxos.length

  };

}


// ============================================================
// GET BALANCE BY ADDRESS TYPE
// ============================================================

export async function getBalanceByType() {

  const utxos =
    await getAllUtxos();


  const balances = {

    P2PKH: 0n,

    P2SH_P2WPKH: 0n,

    P2WPKH: 0n,

    P2TR: 0n

  };


  for (
    const utxo
    of utxos
  ) {

    if (
      balances[utxo.type]
      === undefined
    ) {

      continue;

    }


    balances[utxo.type] +=
      utxo.amountSats;

  }


  return {

    P2PKH: {

      sats:
        balances.P2PKH,

      btc:
        satsToBtc(
          balances.P2PKH
        )

    },


    P2SH_P2WPKH: {

      sats:
        balances.P2SH_P2WPKH,

      btc:
        satsToBtc(
          balances.P2SH_P2WPKH
        )

    },


    P2WPKH: {

      sats:
        balances.P2WPKH,

      btc:
        satsToBtc(
          balances.P2WPKH
        )

    },


    P2TR: {

      sats:
        balances.P2TR,

      btc:
        satsToBtc(
          balances.P2TR
        )

    }

  };

}


// ============================================================
// GET COMPLETE WALLET BALANCE
//
// Hàm này thuận tiện cho server.js.
// ============================================================

export async function getWalletBalance() {

  const utxos =
    await getAllUtxos();


  let totalSats =
    0n;


  const byType = {

    P2PKH: 0n,

    P2SH_P2WPKH: 0n,

    P2WPKH: 0n,

    P2TR: 0n

  };


  for (
    const utxo
    of utxos
  ) {

    totalSats +=
      utxo.amountSats;


    if (
      byType[utxo.type]
      !== undefined
    ) {

      byType[utxo.type] +=
        utxo.amountSats;

    }

  }


  return {

    totalSats,

    totalBtc:
      satsToBtc(
        totalSats
      ),

    utxoCount:
      utxos.length,


    byType: {

      P2PKH: {

        sats:
          byType.P2PKH,

        btc:
          satsToBtc(
            byType.P2PKH
          )

      },


      P2SH_P2WPKH: {

        sats:
          byType.P2SH_P2WPKH,

        btc:
          satsToBtc(
            byType.P2SH_P2WPKH
          )

      },


      P2WPKH: {

        sats:
          byType.P2WPKH,

        btc:
          satsToBtc(
            byType.P2WPKH
          )

      },


      P2TR: {

        sats:
          byType.P2TR,

        btc:
          satsToBtc(
            byType.P2TR
          )

      }

    }

  };

}


// ============================================================
// FIND UTXO
// ============================================================

export async function findUtxo(
  txid,
  vout
) {

  const utxos =
    await getAllUtxos();


  return utxos.find(
    utxo =>
      utxo.txid === txid &&
      utxo.vout === Number(vout)
  ) || null;

}
import 'dotenv/config';

// ============================================================
// BITCOIN CORE RPC CONFIG
// ============================================================

const RPC_URL = process.env.BITCOIN_RPC_URL;
const RPC_USER = process.env.BITCOIN_RPC_USER;
const RPC_PASSWORD = process.env.BITCOIN_RPC_PASSWORD;
const RPC_WALLET = process.env.BITCOIN_RPC_WALLET || 'miner';

if (!RPC_URL) {
  throw new Error(
    'Thiếu BITCOIN_RPC_URL trong .env'
  );
}

if (!RPC_USER) {
  throw new Error(
    'Thiếu BITCOIN_RPC_USER trong .env'
  );
}

if (!RPC_PASSWORD) {
  throw new Error(
    'Thiếu BITCOIN_RPC_PASSWORD trong .env'
  );
}


// ============================================================
// BITCOIN CORE JSON-RPC
// ============================================================

export async function rpc(method, params = []) {

  const walletUrl =
    `${RPC_URL}/wallet/${encodeURIComponent(RPC_WALLET)}`;

  const auth = Buffer
    .from(
      `${RPC_USER}:${RPC_PASSWORD}`
    )
    .toString('base64');

  const body = {
    jsonrpc: '1.0',
    id: 'bitcoin-lab',
    method,
    params
  };

  try {

    const response = await fetch(
      walletUrl,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },

        body: JSON.stringify(body)
      }
    );

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status} ${response.statusText}\n${responseText}`
      );

    }

    let data;

    try {

      data =
        JSON.parse(responseText);

    } catch {

      throw new Error(
        `Bitcoin Core trả về dữ liệu không hợp lệ:\n${responseText}`
      );

    }

    if (data.error) {

      throw new Error(
        `Bitcoin Core RPC error ${data.error.code}: ${data.error.message}`
      );

    }

    return data.result;

  } catch (error) {

    throw new Error(
      `Không kết nối được Bitcoin Core RPC: ${error.message}`
    );

  }

}


// ============================================================
// RPC WALLET INFORMATION
// ============================================================

export function getRpcWalletName() {

  return RPC_WALLET;

}
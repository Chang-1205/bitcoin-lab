import { rpc } from './src-rpc.js';

// =====================================================
// 4 ĐỊA CHỈ ĐÃ SINH TỪ CÙNG 1 PRIVATE KEY
// =====================================================

const addresses = {
  p2pkh: 'miDFDuixvjXdEGmQZWp5FnLYpzHQSM8MtX',
  p2sh_p2wpkh: '2Mvh2PNnZvZRAvwHrEMCsUpbAagtWwXRbcw',
  p2wpkh: 'bcrt1qrk8s2u5edc35p9jh7cudqmjgag43cxl4wnn339',
  p2tr: 'bcrt1pvfk8hp0hh27kw2cltl486wzr2g53fp8n9cmjpf6zw84s9ddfy0tsj7ynfc'
};

// =====================================================
// CẤU HÌNH FAUCET
// =====================================================

// Mỗi giao dịch gửi 1 BTC Regtest.
// P2PKH nhận 2 lần => tạo 2 UTXO riêng biệt.
const amount = 1.0;

// =====================================================
// GỬI COIN TỪ VÍ MINER
// =====================================================

async function send(address, label) {
  console.log(`Đang gửi ${amount} BTC -> ${label}`);
  console.log(`Address: ${address}`);

  const txid = await rpc('sendtoaddress', [
    address,
    amount
  ]);

  console.log(`TXID: ${txid}`);
  console.log('');

  return txid;
}


// =====================================================
// MAIN
// =====================================================

try {

  console.log('');
  console.log('==============================================');
  console.log('BITCOIN REGTEST FAUCET');
  console.log('==============================================');
  console.log('');

  // Kiểm tra blockchain
  const blockchain = await rpc('getblockchaininfo');

  console.log('Network:', blockchain.chain);
  console.log('Current block:', blockchain.blocks);
  console.log('');

  // Kiểm tra số dư miner
  const balance = await rpc('getbalance');

  console.log('Miner balance:', balance, 'BTC');
  console.log('');

  // ---------------------------------------------------
  // UTXO #1 — P2PKH
  // ---------------------------------------------------
  await send(
    addresses.p2pkh,
    'UTXO #1 - P2PKH'
  );

  // ---------------------------------------------------
  // UTXO #2 — P2PKH
  // Cùng address nhưng là giao dịch khác
  // => tạo một UTXO độc lập
  // ---------------------------------------------------
  await send(
    addresses.p2pkh,
    'UTXO #2 - P2PKH'
  );

  // ---------------------------------------------------
  // UTXO #3 — P2SH-P2WPKH
  // ---------------------------------------------------
  await send(
    addresses.p2sh_p2wpkh,
    'UTXO #3 - P2SH-P2WPKH'
  );

  // ---------------------------------------------------
  // UTXO #4 — P2WPKH
  // ---------------------------------------------------
  await send(
    addresses.p2wpkh,
    'UTXO #4 - P2WPKH'
  );

  // ---------------------------------------------------
  // UTXO #5 — P2TR
  // ---------------------------------------------------
  await send(
    addresses.p2tr,
    'UTXO #5 - P2TR'
  );

  console.log('==============================================');
  console.log('5 GIAO DỊCH FAUCET ĐÃ ĐƯỢC TẠO');
  console.log('==============================================');
  console.log('');

  // ===================================================
  // MINE 1 BLOCK ĐỂ CONFIRM CÁC GIAO DỊCH
  // ===================================================

  console.log('Đang mine 1 block để confirm...');

  // Lấy địa chỉ miner để nhận coinbase
  const minerAddress = await rpc('getnewaddress');

  const blocks = await rpc('generatetoaddress', [
    1,
    minerAddress
  ]);

  console.log('Block mới:', blocks[0]);
  console.log('');

  // ===================================================
  // KIỂM TRA BLOCKCHAIN SAU KHI MINE
  // ===================================================

  const updatedBlockchain =
    await rpc('getblockchaininfo');

  console.log(
    'Current block:',
    updatedBlockchain.blocks
  );

  console.log('');
  console.log('==============================================');
  console.log('FAUCET HOÀN TẤT');
  console.log('==============================================');

} catch (error) {

  console.error('');
  console.error('FAUCET ERROR:');
  console.error(error.message);

  process.exit(1);
}
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import 'dotenv/config';

// =====================================================
// KHỞI TẠO BITCOINJS + ECC
// =====================================================

bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

// Bitcoin Core Regtest
const network = bitcoin.networks.regtest;


// =====================================================
// 1. ĐỌC DUY NHẤT 1 PRIVATE KEY TỪ .ENV
// =====================================================

const privateKeyHex = process.env.PRIVATE_KEY_HEX;

if (!privateKeyHex) {
  throw new Error(
    'PRIVATE_KEY_HEX chưa được cấu hình trong file .env'
  );
}

// Kiểm tra private key phải đúng 32 bytes = 64 hex characters
if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
  throw new Error(
    'PRIVATE_KEY_HEX phải là 64 ký tự hexadecimal (32 bytes)'
  );
}

// Tạo key pair từ DUY NHẤT private key
const keyPair = ECPair.fromPrivateKey(
  Buffer.from(privateKeyHex, 'hex'),
  {
    network
  }
);


// =====================================================
// 2. LẤY PUBLIC KEY
// =====================================================

const publicKeyHex = Buffer
  .from(keyPair.publicKey)
  .toString('hex');


// =====================================================
// 3. TẠO P2PKH
// =====================================================

const p2pkh = bitcoin.payments.p2pkh({
  pubkey: keyPair.publicKey,
  network
});


// =====================================================
// 4. TẠO P2WPKH
// =====================================================

const p2wpkh = bitcoin.payments.p2wpkh({
  pubkey: keyPair.publicKey,
  network
});


// =====================================================
// 5. TẠO P2SH-P2WPKH
// =====================================================

const p2shP2wpkh = bitcoin.payments.p2sh({
  redeem: p2wpkh,
  network
});


// =====================================================
// 6. TẠO P2TR / TAPROOT
// =====================================================

// Public key nén:
// 02/03 + 32 bytes X-coordinate
//
// Taproot sử dụng X-only public key,
// tức là bỏ byte đầu 02/03.

const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);

const p2tr = bitcoin.payments.p2tr({
  internalPubkey: xOnlyPubkey,
  network
});


// =====================================================
// 7. KIỂM TRA ADDRESS
// =====================================================

if (!p2pkh.address) {
  throw new Error('Không tạo được P2PKH address');
}

if (!p2shP2wpkh.address) {
  throw new Error('Không tạo được P2SH-P2WPKH address');
}

if (!p2wpkh.address) {
  throw new Error('Không tạo được P2WPKH address');
}

if (!p2tr.address) {
  throw new Error('Không tạo được P2TR address');
}


// =====================================================
// 8. HIỂN THỊ KẾT QUẢ
// =====================================================

console.log('');

console.log('==============================================');
console.log('ONE PRIVATE KEY -> FOUR BITCOIN ADDRESSES');
console.log('==============================================');

console.log('');

console.log('PRIVATE KEY:');
console.log(privateKeyHex);

console.log('');

console.log('PUBLIC KEY:');
console.log(publicKeyHex);

console.log('');

console.log('----------------------------------------------');

console.log('1. P2PKH');
console.log(p2pkh.address);

console.log('');

console.log('2. P2SH-P2WPKH');
console.log(p2shP2wpkh.address);

console.log('');

console.log('3. P2WPKH');
console.log(p2wpkh.address);

console.log('');

console.log('4. P2TR');
console.log(p2tr.address);

console.log('');

console.log('==============================================');
console.log('ADDRESS GENERATION COMPLETED');
console.log('==============================================');
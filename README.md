# Bitcoin Lab - PTIT

## 1. Mục tiêu
Xây dựng mạng Bitcoin local bằng Bitcoin Core Regtest và thực hiện:
Address → UTXO → Coin Selection → PSBT → Sign → Broadcast → Mine.

## 2. Kiến trúc

Web Dashboard
      ↓ HTTP/REST
Node.js + Express
      ↓ JSON-RPC
Bitcoin Core Regtest
      ↓
Blockchain / UTXO / Transaction

## 3. Công nghệ
- Bitcoin Core Regtest
- Node.js + Express
- bitcoinjs-lib
- ECPair + tiny-secp256k1
- HTML/CSS/JavaScript
- Bitcoin Core JSON-RPC

## 4. 4 loại Address
- P2PKH
- P2SH-P2WPKH
- P2WPKH
- P2TR

## 5. Flow chính
1. Khởi động Bitcoin Core Regtest
2. Tạo 4 loại address
3. Mine/Faucet tạo UTXO
4. Scan và chọn UTXO
5. Tạo PSBT
6. Ký transaction bằng SDK
7. Broadcast
8. Mine block xác nhận

## 6. Chức năng mở rộng
- Web Dashboard
- REST API
- Faucet
- Mine
- Transaction Preview
- Transaction History
- Mixed-input Transaction

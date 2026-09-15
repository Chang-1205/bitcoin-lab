# Bitcoin Lab – Bitcoin Core Regtest FinTech

## 1. Giới thiệu

Đây là bài thực hành mô phỏng quy trình giao dịch Bitcoin trên **mạng Bitcoin Core Regtest cục bộ**.

Project sử dụng **Node.js + Express + bitcoinjs-lib** để kết nối Bitcoin Core qua JSON-RPC, quản lý UTXO, lựa chọn UTXO, ký giao dịch và broadcast giao dịch thông qua giao diện Web.

> Project sử dụng dữ liệu thực từ Bitcoin Core Regtest cục bộ, không sử dụng dữ liệu coin giả và không sử dụng Bitcoin Testnet4.

## 2. Chức năng chính

* Kết nối Bitcoin Core Regtest qua JSON-RPC.
* Mine block bằng RPC.
* Tạo 4 loại địa chỉ single-key:

  * P2PKH
  * P2SH-P2WPKH
  * P2WPKH
  * P2TR
* Dùng miner wallet làm faucet.
* Quét và lấy UTXO của các địa chỉ.
* Lựa chọn số lượng UTXO tối thiểu để tạo giao dịch.
* Tạo và ký PSBT bằng `bitcoinjs-lib`.
* Hỗ trợ giao dịch có nhiều loại input.
* Broadcast giao dịch lên Bitcoin Core Regtest.
* Hiển thị trạng thái blockchain, address, UTXO và transaction trên Web UI.

## 3. Công nghệ

| Thành phần    | Công nghệ               |
| ------------- | ----------------------- |
| Blockchain    | Bitcoin Core Regtest    |
| Backend       | Node.js + Express       |
| Bitcoin SDK   | bitcoinjs-lib           |
| Key pair      | ECPair                  |
| ECC           | tiny-secp256k1          |
| Configuration | dotenv                  |
| RPC           | Bitcoin Core JSON-RPC   |
| Frontend      | HTML + CSS + JavaScript |
| Module        | ES Modules              |

## 4. Luồng xử lý

```text
Bitcoin Core Regtest
        │
        ▼
   Mine block / Miner
        │
        ▼
  4 Address Types
 P2PKH / P2SH-P2WPKH
 P2WPKH / P2TR
        │
        ▼
       Faucet
        │
        ▼
     Scan UTXO
        │
        ▼
   Coin Selection
        │
        ▼
   Build PSBT
        │
        ▼
   Sign Inputs
        │
        ▼
  Final Transaction
        │
        ▼
 Broadcast to Regtest
        │
        ▼
      Web UI
```

## 5. Cài đặt

Yêu cầu:

* Git
* Node.js
* Bitcoin Core
* GitHub Desktop (không bắt buộc)

Clone project:

```bash
git clone https://github.com/Chang-1205/bitcoin-lab.git
cd bitcoin-lab
```

Cài dependency:

```bash
npm install
```

Tạo `.env` từ `.env.example` và cấu hình thông tin RPC của Bitcoin Core.

## 6. Chạy project

Khởi động Bitcoin Core ở chế độ Regtest trước.

Sau đó chạy:

```bash
npm start
```

hoặc:

```bash
node server.js
```

Mở trình duyệt:

```text
http://localhost:3000
```

## 7. Lưu ý

* `.env` không được đưa lên GitHub.
* Không đưa private key hoặc password thật lên GitHub.
* Không commit thư mục `node_modules`.
* Project phải kết nối tới Bitcoin Core Regtest đang chạy trên máy.
* Dữ liệu UTXO phải được lấy từ Bitcoin Core Regtest thực tế.

## 8. Repository

GitHub:

https://github.com/Chang-1205/bitcoin-lab

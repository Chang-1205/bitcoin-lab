import 'dotenv/config';

console.log('RPC URL:', process.env.BITCOIN_RPC_URL);
console.log('RPC USER:', process.env.BITCOIN_RPC_USER);
console.log('RPC WALLET:', process.env.BITCOIN_RPC_WALLET);
console.log(
  'RPC PASSWORD:',
  process.env.BITCOIN_RPC_PASSWORD ? 'ĐÃ CÓ' : 'THIẾU'
);
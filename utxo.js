import { rpc } from './src-rpc.js';

const addresses = {
  P2PKH:
    'miDFDuixvjXdEGmQZWp5FnLYpzHQSM8MtX',

  P2SH_P2WPKH:
    '2Mvh2PNnZvZRAvwHrEMCsUpbAagtWwXRbcw',

  P2WPKH:
    'bcrt1qrk8s2u5edc35p9jh7cudqmjgag43cxl4wnn339',

  P2TR:
    'bcrt1pvfk8hp0hh27kw2cltl486wzr2g53fp8n9cmjpf6zw84s9ddfy0tsj7ynfc'
};


export async function getAllUtxos() {

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
          [`addr(${address})`]
        ]
      );

    for (
      const utxo
      of result.unspents
    ) {

      allUtxos.push({

        type,

        address,

        txid:
          utxo.txid,

        vout:
          utxo.vout,

        amountBtc:
          utxo.amount,

        amountSats:
          Math.round(
            utxo.amount *
            100_000_000
          ),

        scriptPubKey:
          utxo.scriptPubKey,

        confirmations:
          utxo.confirmations,

        height:
          utxo.height

      });

    }
  }

  return allUtxos;
}
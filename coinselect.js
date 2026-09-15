import { getAllUtxos } from './utxo.js';

const SATS_PER_BTC = 100_000_000;

/**
 * Chọn số UTXO ít nhất để đạt target.
 *
 * Ưu tiên:
 * 1. Ít input nhất
 * 2. Change nhỏ nhất
 */
export function selectUtxos(utxos, targetSats) {
  if (!Number.isInteger(targetSats) || targetSats <= 0) {
    throw new Error('targetSats phải là số nguyên > 0');
  }

  let best = null;

  function search(start, selected, total) {
    if (total >= targetSats) {
      const candidate = {
        utxos: [...selected],
        totalSats: total,
        changeSats: total - targetSats
      };

      if (
        best === null ||
        candidate.utxos.length < best.utxos.length ||
        (
          candidate.utxos.length === best.utxos.length &&
          candidate.changeSats < best.changeSats
        )
      ) {
        best = candidate;
      }

      return;
    }

    for (let i = start; i < utxos.length; i++) {
      // Nếu đã có một nghiệm dùng ít input hơn
      // thì không cần tiếp tục nhánh dài hơn.
      if (best && selected.length + 1 > best.utxos.length) {
        break;
      }

      selected.push(utxos[i]);

      search(
        i + 1,
        selected,
        total + utxos[i].amountSats
      );

      selected.pop();
    }
  }

  search(0, [], 0);

  if (!best) {
    throw new Error(
      `Không đủ UTXO. Cần ${targetSats} sats.`
    );
  }

  return best;
}

// Demo
const utxos = await getAllUtxos();

const targetBtc = 3;
const targetSats = targetBtc * SATS_PER_BTC;

const result = selectUtxos(utxos, targetSats);

console.log('');
console.log('==============================================');
console.log('COIN SELECTION');
console.log('==============================================');
console.log('');

console.log('Target:', targetBtc, 'BTC');
console.log('Selected:', result.utxos.length, 'UTXOs');
console.log(
  'Selected amount:',
  result.totalSats / SATS_PER_BTC,
  'BTC'
);
console.log(
  'Change:',
  result.changeSats / SATS_PER_BTC,
  'BTC'
);

console.log('');

result.utxos.forEach((utxo, index) => {
  console.log(
    `Input #${index + 1}`,
    utxo.type,
    `${utxo.txid}:${utxo.vout}`,
    `${utxo.amountBtc} BTC`
  );
});
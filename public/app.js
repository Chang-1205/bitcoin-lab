// ============================================================
// BITCOIN REGTEST LAB - FRONTEND
// ============================================================

const $ = (id) => document.getElementById(id);


// ============================================================
// GLOBAL STATE
// ============================================================

let walletAddresses = {};


// ============================================================
// FETCH JSON
// ============================================================

async function fetchJson(url, options = {}) {

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Server không trả JSON cho ${url}. HTTP ${response.status}.`
    );
  }

  if (!response.ok || data.success === false) {

    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}


// ============================================================
// FORMAT
// ============================================================

function btc(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '—';
  }

  return `${number.toFixed(8)} BTC`;
}


function shortenTxid(txid) {

  if (!txid) {
    return '—';
  }

  if (txid.length <= 20) {
    return txid;
  }

  return (
    txid.slice(0, 12) +
    '...' +
    txid.slice(-10)
  );
}


function escapeHtml(value) {

  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function formatDate(value) {

  if (!value) {
    return '—';
  }

  let date;

  if (typeof value === 'number') {

    date = new Date(value * 1000);

  } else {

    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('vi-VN');
}


// ============================================================
// TYPE BADGE
// ============================================================

function typeBadge(type) {

  const classes = {
    P2PKH: 'badge-p2pkh',
    P2SH_P2WPKH: 'badge-p2sh',
    P2WPKH: 'badge-p2wpkh',
    P2TR: 'badge-p2tr'
  };

  const labels = {
    P2PKH: 'P2PKH',
    P2SH_P2WPKH: 'P2SH-P2WPKH',
    P2WPKH: 'P2WPKH',
    P2TR: 'P2TR'
  };

  return `
    <span class="badge ${classes[type] || ''}">
      ${escapeHtml(labels[type] || type || 'Unknown')}
    </span>
  `;
}


// ============================================================
// STATUS BADGE
// ============================================================

function statusBadge(status) {

  const normalized =
    String(status || '')
      .toUpperCase();

  const config = {

    SUCCESS: {
      className: 'badge-confirmed',
      label: 'SUCCESS'
    },

    CONFIRMED: {
      className: 'badge-confirmed',
      label: 'CONFIRMED'
    },

    PENDING: {
      className: 'badge-pending',
      label: 'PENDING'
    },

    FAILED: {
      className: 'badge-failed',
      label: 'FAILED'
    }

  };

  const item =
    config[normalized] || {
      className: 'badge-pending',
      label: normalized || 'UNKNOWN'
    };

  return `
    <span class="badge ${item.className}">
      ${escapeHtml(item.label)}
    </span>
  `;
}


// ============================================================
// MESSAGE
// ============================================================

function showMessage(element, text, type = '') {

  if (!element) {
    return;
  }

  element.textContent = text;

  element.className =
    `message ${type}`;
}


// ============================================================
// STATUS
// ============================================================

async function loadStatus() {

  try {

    const data =
      await fetchJson('/api/status');

    $('networkStatus').textContent =
      data.chain ?? '—';

    $('blockHeight').textContent =
      data.blocks ?? '—';

    $('blockHeaders').textContent =
      data.headers ?? '—';

    $('ibdStatus').textContent =
      data.initialblockdownload
        ? 'YES'
        : 'NO';

    showMessage(
      $('statusMessage'),
      `Best block: ${data.bestblockhash || '—'}`,
      'success'
    );

  } catch (error) {

    showMessage(
      $('statusMessage'),
      error.message,
      'error'
    );
  }
}


// ============================================================
// ADDRESSES
// ============================================================

async function loadAddresses() {

  try {

    const data =
      await fetchJson('/api/addresses');

    walletAddresses =
      data.addresses || {};

    const rows =
      Object.entries(walletAddresses)
        .map(([type, address]) => {

          return `
            <div class="address-row">

              <div class="address-type">
                ${typeBadge(type)}
              </div>

              <div class="address-value">
                ${escapeHtml(address)}
              </div>

              <button
                class="copy-btn"
                data-copy="${escapeHtml(address)}"
                type="button"
              >
                Copy
              </button>

            </div>
          `;
        })
        .join('');

    $('addressList').innerHTML =
      rows ||
      `
        <div class="empty-state">
          Chưa có address.
        </div>
      `;

    // Mặc định gửi về P2WPKH của chính Lab Wallet
    if (
      walletAddresses.P2WPKH &&
      !$('destination').value
    ) {

      $('destination').value =
        walletAddresses.P2WPKH;
    }

  } catch (error) {

    $('addressList').innerHTML = `
      <div class="message error">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}


// ============================================================
// BALANCE
// ============================================================

async function loadBalance() {

  try {

    const data =
      await fetchJson('/api/balance');

    const wallet =
      data.myWallet || {};

    $('myBalance').textContent =
      btc(wallet.totalBtc);

    const minerBalance =
      data.faucet?.minerBalanceBtc;

    $('minerBalance').textContent =
      minerBalance === null ||
      minerBalance === undefined
        ? '—'
        : btc(minerBalance);

    $('utxoCount').textContent =
      wallet.utxoCount ?? '—';

    $('balanceP2PKH').textContent =
      btc(wallet.P2PKH);

    $('balanceP2SH').textContent =
      btc(wallet.P2SH_P2WPKH);

    $('balanceP2WPKH').textContent =
      btc(wallet.P2WPKH);

    $('balanceP2TR').textContent =
      btc(wallet.P2TR);

  } catch (error) {

    console.error(
      'Balance:',
      error
    );
  }
}


// ============================================================
// UTXOS
// ============================================================

async function loadUtxos() {

  try {

    const data =
      await fetchJson('/api/utxos');

    $('utxoTotalCount').textContent =
      data.count ?? 0;

    $('utxoTotalValue').textContent =
      btc(data.totalBtc);

    const utxos =
      Array.isArray(data.utxos)
        ? data.utxos
        : [];

    if (!utxos.length) {

      $('utxoTable').innerHTML = `
        <tr>
          <td colspan="6">
            Không có UTXO.
          </td>
        </tr>
      `;

      return;
    }

    $('utxoTable').innerHTML =
      utxos.map((u) => {

        return `
          <tr>

            <td>
              ${typeBadge(u.type)}
            </td>

            <td class="txid">

              <span>
                ${escapeHtml(
                  shortenTxid(u.txid)
                )}
              </span>

              <br>

              <small>
                ${escapeHtml(u.txid)}
              </small>

            </td>

            <td>
              ${escapeHtml(u.vout)}
            </td>

            <td>
              <b>
                ${btc(u.amountBtc)}
              </b>
            </td>

            <td>
              ${escapeHtml(
                u.confirmations ?? 0
              )}
            </td>

            <td class="address-cell">
              ${escapeHtml(u.address)}
            </td>

          </tr>
        `;

      }).join('');

  } catch (error) {

    $('utxoTable').innerHTML = `
      <tr>
        <td colspan="6" class="error-cell">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  }
}


// ============================================================
// TRANSACTION HISTORY
// ============================================================

async function loadHistory() {

  try {

    const data =
      await fetchJson(
        '/api/transactions?count=30'
      );

    const transactions =
      Array.isArray(data.transactions)
        ? data.transactions
        : [];

    if (!transactions.length) {

      $('historyTable').innerHTML = `
        <tr>
          <td colspan="6">
            Chưa có lịch sử transaction.
          </td>
        </tr>
      `;

      return;
    }


    $('historyTable').innerHTML =
      transactions.map((tx) => {

        const confirmations =
          Number(
            tx.confirmations ?? 0
          );

        let status =
          tx.status;

        if (!status) {

          status =
            confirmations > 0
              ? 'CONFIRMED'
              : 'PENDING';
        }

        const type =
          tx.type ||
          tx.category ||
          'transaction';

        const amount =
          tx.amountBtc ??
          tx.amount ??
          0;

        const txid =
          tx.txid || '—';

        const time =
          tx.createdAt ||
          tx.timestamp ||
          tx.timereceived ||
          tx.time;

        return `
          <tr>

            <td>
              ${escapeHtml(
                formatDate(time)
              )}
            </td>

            <td>
              ${statusBadge(status)}
            </td>

            <td>
              ${escapeHtml(type)}
            </td>

            <td>
              <b>
                ${btc(amount)}
              </b>
            </td>

            <td class="txid">
              ${escapeHtml(txid)}
            </td>

            <td>

              ${
                confirmations > 0

                  ? `
                    <span class="badge badge-confirmed">
                      ${confirmations}
                    </span>
                  `

                  : `
                    <span class="badge badge-pending">
                      0 · Pending
                    </span>
                  `
              }

            </td>

          </tr>
        `;

      }).join('');

  } catch (error) {

    console.error(
      'History:',
      error
    );

    $('historyTable').innerHTML = `
      <tr>
        <td colspan="6" class="error-cell">
          Không lấy được lịch sử: ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  }
}


// ============================================================
// LATEST TRANSACTION
// ============================================================

async function loadLatestTransaction() {

  try {

    const data =
      await fetchJson(
        '/api/transaction'
      );

    const tx =
      data.transaction;

    if (!tx) {

      $('latestTransaction').textContent =
        'Chưa có transaction.';

      return;
    }

    const confirmations =
      Number(
        tx.confirmations ?? 0
      );

    const status =
      confirmations > 0
        ? `${confirmations} confirmation`
        : 'Pending · 0 confirmation';


    $('latestTransaction').innerHTML = `

      <div class="transaction-id-box">

        <span>
          TXID
        </span>

        <code>
          ${escapeHtml(tx.txid)}
        </code>

      </div>


      <div class="transaction-detail-grid">

        <div>
          <span>Status</span>

          <strong>
            ${escapeHtml(status)}
          </strong>
        </div>


        <div>
          <span>Block</span>

          <strong>
            ${
              tx.blockhash
                ? escapeHtml(
                    shortenTxid(
                      tx.blockhash
                    )
                  )
                : 'Mempool'
            }
          </strong>
        </div>


        <div>
          <span>Inputs</span>

          <strong>
            ${tx.vin?.length || 0}
          </strong>
        </div>


        <div>
          <span>Outputs</span>

          <strong>
            ${tx.vout?.length || 0}
          </strong>
        </div>


        <div>
          <span>Size</span>

          <strong>
            ${tx.size ?? '—'} bytes
          </strong>
        </div>


        <div>
          <span>Virtual Size</span>

          <strong>
            ${tx.vsize ?? '—'} vbytes
          </strong>
        </div>


        <div>
          <span>Weight</span>

          <strong>
            ${tx.weight ?? '—'}
          </strong>
        </div>


        <div>
          <span>Version</span>

          <strong>
            ${tx.version ?? '—'}
          </strong>
        </div>

      </div>
    `;

  } catch (error) {

    $('latestTransaction').innerHTML = `
      <span class="error-text">
        Không lấy được transaction gần nhất.
      </span>
    `;
  }
}


// ============================================================
// LOAD ALL
// ============================================================

async function refreshAll() {

  const refreshButton =
    $('refreshBtn');

  refreshButton.disabled = true;

  try {

    await Promise.all([
      loadStatus(),
      loadAddresses(),
      loadBalance(),
      loadUtxos(),
      loadHistory(),
      loadLatestTransaction()
    ]);

  } catch (error) {

    console.error(
      'Refresh:',
      error
    );

  } finally {

    refreshButton.disabled = false;
  }
}


// ============================================================
// PREVIEW TRANSACTION
// ============================================================

async function previewTransaction() {

  const destination =
    $('destination')
      .value
      .trim();

  const amountBtc =
    $('amount')
      .value
      .trim();

  const feeSats =
    $('fee')
      .value;

  const mode =
    $('selectionMode')
      .value;

  const message =
    $('transactionMessage');

  showMessage(
    message,
    'Đang chọn UTXO...',
    ''
  );

  $('previewPanel')
    .classList.add('hidden');

  try {

    const data =
      await fetchJson(
        '/api/transaction/preview',
        {
          method: 'POST',

          body: JSON.stringify({
            destination,
            amountBtc,
            feeSats,
            mode
          })
        }
      );

    renderPreview(data);

    showMessage(
      message,
      `Đã chọn ${data.selectedCount} input.`,
      'success'
    );

  } catch (error) {

    showMessage(
      message,
      error.message,
      'error'
    );
  }
}


// ============================================================
// RENDER PREVIEW
// ============================================================

function renderPreview(data) {

  $('previewInputs').textContent =
    data.selectedCount ?? 0;

  $('previewInputTotal').textContent =
    btc(data.inputTotalBtc);

  $('previewAmount').textContent =
    btc(data.amountBtc);

  $('previewFee').textContent =
    btc(data.feeBtc);

  $('previewChange').textContent =
    btc(data.changeBtc);

  $('previewTypes').textContent =
    (data.inputTypes || [])
      .map((type) =>
        String(type)
          .replaceAll('_', '-')
      )
      .join(', ');


  const selected =
    Array.isArray(data.selected)
      ? data.selected
      : [];


  if (!selected.length) {

    $('previewUtxos').innerHTML = `
      <tr>
        <td colspan="5">
          Không có UTXO được chọn.
        </td>
      </tr>
    `;

  } else {

    $('previewUtxos').innerHTML =
      selected.map((u) => {

        return `
          <tr>

            <td>
              ${typeBadge(u.type)}
            </td>

            <td class="txid">
              ${escapeHtml(u.txid)}
            </td>

            <td>
              ${escapeHtml(u.vout)}
            </td>

            <td>
              ${btc(u.amountBtc)}
            </td>

            <td>
              ${escapeHtml(
                u.confirmations ?? 0
              )}
            </td>

          </tr>
        `;

      }).join('');
  }


  $('previewPanel')
    .classList.remove('hidden');
}


// ============================================================
// SEND TRANSACTION
// ============================================================

async function sendTransaction() {

  const destination =
    $('destination')
      .value
      .trim();

  const amountBtc =
    $('amount')
      .value
      .trim();

  const feeSats =
    $('fee')
      .value;

  const mode =
    $('selectionMode')
      .value;

  const message =
    $('transactionMessage');


  $('sendBtn').disabled = true;


  showMessage(
    message,
    'Đang chọn UTXO, tạo PSBT, ký và broadcast...',
    ''
  );


  $('sendResult')
    .classList.add('hidden');


  try {

    const data =
      await fetchJson(
        '/api/transaction/send',
        {
          method: 'POST',

          body: JSON.stringify({
            destination,
            amountBtc,
            feeSats,
            mode
          })
        }
      );


    $('resultTxid').textContent =
      data.txid || '—';

    $('resultAmount').textContent =
      btc(data.amountBtc);

    $('resultFee').textContent =
      btc(data.feeBtc);

    $('resultChange').textContent =
      btc(data.changeBtc);

    $('resultInputs').textContent =
      `${data.signedInputs ?? 0} signature(s)`;


    $('sendResult')
      .classList.remove('hidden');


    showMessage(
      message,
      `Broadcast thành công. TXID: ${data.txid}`,
      'success'
    );


    // Cập nhật ngay dữ liệu hiện tại.
    // UTXO confirmation sẽ thay đổi sau khi Mine.
    await refreshAll();

  } catch (error) {

    showMessage(
      message,
      error.message,
      'error'
    );

  } finally {

    $('sendBtn').disabled = false;
  }
}


// ============================================================
// FAUCET
// ============================================================

async function faucet() {

  const type =
    $('faucetType')
      .value;

  const amountBtc =
    $('faucetAmount')
      .value
      .trim();

  const button =
    $('faucetBtn');

  const message =
    $('faucetMessage');


  button.disabled = true;


  showMessage(
    message,
    'Đang tạo Faucet transaction...',
    ''
  );


  try {

    const data =
      await fetchJson(
        '/api/faucet',
        {
          method: 'POST',

          body: JSON.stringify({
            type,
            amountBtc
          })
        }
      );


    showMessage(
      message,
      `Faucet thành công. TXID: ${data.txid}. Hãy Mine 1 Block.`,
      'success'
    );


    alert(
      `Faucet transaction đã được tạo.\n\n` +
      `TXID: ${data.txid}\n\n` +
      `Address: ${data.address}\n\n` +
      `Amount: ${data.amountBtc} BTC\n\n` +
      `Hãy Mine 1 Block rồi Refresh.`
    );


    await loadHistory();

  } catch (error) {

    showMessage(
      message,
      error.message,
      'error'
    );

    alert(
      `Faucet lỗi:\n${error.message}`
    );

  } finally {

    button.disabled = false;
  }
}


// ============================================================
// MINE
// ============================================================

async function mineBlock() {

  const button =
    $('mineBtn');

  button.disabled = true;


  $('mineResult')
    .classList.remove('hidden');


  $('mineResult').textContent =
    'Đang mine 1 block...';


  try {

    const data =
      await fetchJson(
        '/api/mine',
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );


    const blocks =
      Array.isArray(data.blocks)
        ? data.blocks
        : [];


    $('mineResult').textContent =
      `Đã mine 1 block.\n\n` +
      `Block hash: ${blocks[0] || '—'}\n\n` +
      `Mining address: ${data.miningAddress || '—'}`;


    await refreshAll();

  } catch (error) {

    $('mineResult').textContent =
      `Mine lỗi: ${error.message}`;

  } finally {

    button.disabled = false;
  }
}


// ============================================================
// COPY ADDRESS
// ============================================================

document.addEventListener(
  'click',
  async (event) => {

    const button =
      event.target.closest('[data-copy]');

    if (!button) {
      return;
    }


    const value =
      button.dataset.copy;


    try {

      await navigator.clipboard.writeText(
        value
      );


      const oldText =
        button.textContent;


      button.textContent =
        'Copied';


      setTimeout(() => {

        button.textContent =
          oldText;

      }, 1000);

    } catch {

      alert(
        'Không thể copy tự động.'
      );
    }
  }
);


// ============================================================
// EVENTS
// ============================================================

$('refreshBtn')
  .addEventListener(
    'click',
    refreshAll
  );


$('previewBtn')
  .addEventListener(
    'click',
    previewTransaction
  );


$('sendBtn')
  .addEventListener(
    'click',
    sendTransaction
  );


$('faucetBtn')
  .addEventListener(
    'click',
    faucet
  );


$('mineBtn')
  .addEventListener(
    'click',
    mineBlock
  );


// ============================================================
// INITIAL LOAD
// ============================================================

refreshAll();
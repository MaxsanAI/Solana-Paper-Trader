/* Local encrypted Solana wallet for this browser. Private keys are never sent to the server. */
import { Keypair, PublicKey, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "https://esm.sh/@solana/web3.js@1.98.4";
import bs58 from "https://esm.sh/bs58@6.0.0";

const $ = (id) => document.getElementById(id);
function openWalletModal() {
  const modal = $("embeddedWalletModal");
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  $("embeddedWalletCloseBtn")?.focus();
}
function closeWalletModal() {
  const modal = $("embeddedWalletModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
  $("embeddedWalletTopBtn")?.focus();
}
$("embeddedWalletTopBtn")?.addEventListener("click", openWalletModal);
$("embeddedWalletCloseBtn")?.addEventListener("click", closeWalletModal);
$("embeddedWalletModal")?.addEventListener("click", event => {
  if (event.target === $("embeddedWalletModal")) closeWalletModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("embeddedWalletModal") && !$("embeddedWalletModal").hidden) closeWalletModal();
});

const DB_NAME = "solana-paper-trader-wallet-v1";
const STORE = "wallet";
const ITERATIONS = 600000;
let keypair = null;
let publicKey = "";
let balanceTimer = null;

function status(message, error = false) {
  const el = $("embeddedWalletStatus");
  if (el) { el.textContent = message; el.style.color = error ? "#ff789b" : "#91a2bc"; }
}
function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readRecord() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get("owner");
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function saveRecord(record) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(record, "owner");
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function bytesToB64(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function encryptSecret(secretKey, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, secretKey);
  return { version: 1, salt: bytesToB64(salt), iv: bytesToB64(iv), cipher: bytesToB64(new Uint8Array(cipher)) };
}
async function decryptSecret(record, password) {
  const key = await deriveKey(password, b64ToBytes(record.salt));
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(record.iv) }, key, b64ToBytes(record.cipher));
  return new Uint8Array(raw);
}
function validatePassword(p) {
  if (typeof p !== "string" || p.length < 12) throw new Error("Password must contain at least 12 characters.");
}
function setUnlockedUI(record) {
  $("embeddedWalletAuth").hidden = true;
  $("embeddedWalletDetails").hidden = false;
  $("embeddedWalletAddress").textContent = publicKey;
  $("embeddedWalletUsername").textContent = "Unlocked";
  $("embeddedWalletBackup").hidden = !record.backupAcknowledged;
  $("embeddedWalletLock").disabled = false;
  $("connectEmbeddedWalletBtn").disabled = false;
  $("connectEmbeddedWalletBtn").textContent = "Connect to Live Trading";
  $("embeddedWalletTopLabel").textContent = "My Wallet · Unlocked";
  status("Wallet unlocked in this tab only. Signing happens locally.");
  refreshBalance();
  if (balanceTimer) clearInterval(balanceTimer);
  balanceTimer = setInterval(refreshBalance, 20000);
  window.embeddedSolanaWallet = {
    isEmbeddedSolanaWallet: true,
    publicKey: new PublicKey(publicKey),
    async connect() { if (!keypair) throw new Error("Wallet is locked."); return { publicKey: new PublicKey(publicKey) }; },
    async disconnect() { return true; },
    async signTransaction(tx) { if (!keypair) throw new Error("Unlock the built-in wallet first."); if (!confirm("Allow Live Trader to sign this blockchain transaction? Verify the amount, token, and address in the terminal. This may spend funds.")) throw new Error("Signing was cancelled."); if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair); return tx; },
    async signAllTransactions(txs) { if (!keypair) throw new Error("Unlock the built-in wallet first."); if (!confirm("Allow signing "+txs.length+" blockchain transactions? Verify every detail; funds may be spent.")) throw new Error("Potpisivanje je otkazano."); for (const tx of txs) { if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair); } return txs; },
    async signAndSendTransaction(tx) {
      if (!keypair) throw new Error("Unlock the built-in wallet first.");
      if (!confirm("Allow the built-in wallet to send this blockchain transaction? Verify the amount and destination.")) throw new Error("Transaction was cancelled.");
      if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair);
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const signature = await connection.sendRawTransaction(tx.serialize());
      return { signature };
    },
    async signMessage(message) {
      if (!keypair) throw new Error("Unlock the built-in wallet first.");
      const { signAsync } = await import("https://esm.sh/@noble/ed25519@2.2.3");
      return signAsync(message, keypair.secretKey.slice(0, 32));
    }
  };
  window.dispatchEvent(new CustomEvent("embedded-wallet-ready", { detail: { publicKey } }));
}
async function refreshBalance() {
  if (!publicKey) return;
  try {
    const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const lamports = await c.getBalance(new PublicKey(publicKey), "confirmed");
    $("embeddedWalletBalance").textContent = (lamports / LAMPORTS_PER_SOL).toFixed(6) + " SOL";
  } catch { $("embeddedWalletBalance").textContent = "Unavailable"; }
}
async function createWallet() {
  const username = $("embeddedWalletUsernameInput").value.trim();
  const password = $("embeddedWalletPassword").value;
  validatePassword(password);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 characters: letters, numbers, . _ -");
  const existing = await readRecord();
  if (existing) throw new Error("A wallet already exists in this browser. Log in or export your recovery key first.");
  const kp = Keypair.generate();
  const record = { ...(await encryptSecret(kp.secretKey, password)), username, address: kp.publicKey.toBase58(), createdAt: new Date().toISOString(), backupAcknowledged: false };
  await saveRecord(record);
  keypair = kp; publicKey = kp.publicKey.toBase58();
  $("embeddedWalletPassword").value = "";
  setUnlockedUI(record);
  // Display the backup secret only in this initial creation flow.
  $("embeddedWalletBackupSecret").textContent = bs58.encode(kp.secretKey);
  $("embeddedWalletBackup").hidden = false;
  status("Wallet created. Save your recovery key somewhere safe outside this device now.", true);
}
async function loginWallet() {
  const username = $("embeddedWalletUsernameInput").value.trim();
  const password = $("embeddedWalletPassword").value;
  const record = await readRecord();
  if (!record || record.username.toLowerCase() !== username.toLowerCase()) throw new Error("No wallet with that username exists in this browser.");
  let raw;
  try { raw = await decryptSecret(record, password); } catch { throw new Error("Incorrect password or corrupted wallet."); }
  const kp = Keypair.fromSecretKey(raw);
  if (kp.publicKey.toBase58() !== record.address) throw new Error("Wallet address verification failed.");
  keypair = kp; publicKey = record.address;
  $("embeddedWalletPassword").value = "";
  setUnlockedUI(record);
}
async function exportKey() {
  if (!keypair) throw new Error("Unlock the wallet first.");
  const secret = bs58.encode(keypair.secretKey);
  $("embeddedWalletBackupSecret").textContent = secret;
  $("embeddedWalletBackup").hidden = false;
  status("Recovery key displayed. Never share it or store it in cloud notes.", true);
}
async function sendSol() {
  if (!keypair) throw new Error("Unlock the wallet first.");
  const destination = new PublicKey($("embeddedWalletSendAddress").value.trim());
  const amount = Number($("embeddedWalletSendAmount").value);
  if (!Number.isFinite(amount) || amount < 0.001 || amount > 10) throw new Error("Transfers are limited to 0.001–10 SOL.");
  if (destination.equals(keypair.publicKey)) throw new Error("The recipient address is your own address.");
  if (!confirm("Send " + amount + " SOL to " + destination.toBase58() + "? This transaction cannot be reversed.")) return;
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: latest.blockhash }).add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: destination, lamports: Math.floor(amount * LAMPORTS_PER_SOL) }));
  tx.partialSign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize());
  status("Transaction submitted; waiting for confirmation…");
  await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
  $("embeddedWalletTxLink").innerHTML = '<a class="underline" target="_blank" rel="noopener noreferrer" href="https://solscan.io/tx/' + encodeURIComponent(signature) + '">View transaction on Solscan</a>';
  status("Transfer confirmed on Solana Mainnet. Verify the recipient and transaction signature.");
  await refreshBalance();
}

let qrCodeModulePromise = null;
let qrScannerReader = null;
let qrScannerControls = null;
function validSolanaAddress(value) {
  try {
    const key = new PublicKey(String(value || "").trim());
    return PublicKey.isOnCurve(key.toBytes()) && key.toBase58() === String(value || "").trim();
  } catch { return false; }
}
async function showReceiveQr() {
  if (!publicKey || !keypair) throw new Error("Unlock your wallet first.");
  const panel = $("embeddedWalletQrPanel");
  panel.hidden = false;
  if (!qrCodeModulePromise) qrCodeModulePromise = import("https://esm.sh/qrcode@1.5.4");
  const mod = await qrCodeModulePromise;
  const QRCode = mod.default || mod;
  await QRCode.toCanvas($("embeddedWalletQrCanvas"), publicKey, {
    errorCorrectionLevel: "H", margin: 2, width: 280,
    color: { dark: "#101624", light: "#ffffff" }
  });
}
async function stopQrScanner() {
  try { if (qrScannerControls) qrScannerControls.stop(); } catch {}
  qrScannerControls = null;
  try { if (qrScannerReader && typeof qrScannerReader.reset === "function") qrScannerReader.reset(); } catch {}
  qrScannerReader = null;
  const video = $("embeddedWalletScannerVideo");
  if (video && video.srcObject) {
    for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
  }
  $("embeddedWalletScannerPanel").hidden = true;
}
function useScannedAddress(raw) {
  const value = String(raw || "").trim();
  let address = value;
  try {
    if (/^solana:/i.test(value)) {
      const withoutScheme = value.replace(/^solana:/i, "");
      address = withoutScheme.split(/[?&]/)[0];
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      throw new Error("This QR code is not a Solana address.");
    }
    if (!validSolanaAddress(address)) throw new Error("QR scanned, but it does not contain a valid Solana wallet address.");
    $("embeddedWalletSendAddress").value = address;
    $("embeddedWalletScanStatus").textContent = "Valid Solana address filled in. Check the recipient carefully before sending.";
    $("embeddedWalletSendAddress").focus();
    stopQrScanner();
  } catch (error) {
    $("embeddedWalletScanStatus").textContent = error.message || "Could not read a valid Solana address.";
    $("embeddedWalletScanStatus").style.color = "#ff789b";
  }
}
async function startQrScanner() {
  const panel = $("embeddedWalletScannerPanel");
  panel.hidden = false;
  $("embeddedWalletScanStatus").style.color = "";
  $("embeddedWalletScanStatus").textContent = "Requesting camera permission…";
  try {
    const mod = await import("https://esm.sh/@zxing/browser@0.1.5");
    const Reader = mod.BrowserMultiFormatReader;
    qrScannerReader = new Reader();
    qrScannerControls = await qrScannerReader.decodeFromVideoDevice(undefined, $("embeddedWalletScannerVideo"), (result, error) => {
      if (result) useScannedAddress(result.getText());
    });
    $("embeddedWalletScanStatus").textContent = "Camera active. Hold a Solana address QR code in view.";
  } catch (error) {
    await stopQrScanner();
    $("embeddedWalletScanStatus").style.color = "#ff789b";
    $("embeddedWalletScanStatus").textContent = "Camera unavailable. Allow camera access on HTTPS, or choose a QR image instead.";
  }
}
async function scanQrImage(file) {
  if (!file) return;
  $("embeddedWalletScanStatus").style.color = "";
  $("embeddedWalletScanStatus").textContent = "Reading QR image…";
  let url = null;
  try {
    const mod = await import("https://esm.sh/@zxing/browser@0.1.5");
    const Reader = mod.BrowserMultiFormatReader;
    const reader = new Reader();
    url = URL.createObjectURL(file);
    const result = await reader.decodeFromImageUrl(url);
    useScannedAddress(result.getText());
    try { reader.reset(); } catch {}
  } catch {
    $("embeddedWalletScanStatus").style.color = "#ff789b";
    $("embeddedWalletScanStatus").textContent = "Could not read a QR code from that image. Try a clearer, cropped image.";
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
async function buySolWithMoonPay() {
  if (!keypair || !publicKey) throw new Error("Unlock your wallet before buying SOL.");
  const amount = Number($("embeddedWalletBuyAmount")?.value);
  if (!Number.isFinite(amount) || amount < 20 || amount > 1000) throw new Error("Enter a purchase amount between $20 and $1,000.");
  const button = $("embeddedWalletBuyBtn");
  const popup = window.open("about:blank", "_blank");
  if (!popup) throw new Error("Allow pop-ups for this site to open the secure payment provider.");
  if (button) { button.disabled = true; button.textContent = "Preparing secure checkout…"; }
  try {
    const response = await fetch("/api/onramp/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress: publicKey, amountUsd: amount })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.url) throw new Error(data.error || "MoonPay checkout is not configured yet. The site owner must add the MoonPay API keys in Cloudflare Pages settings.");
    status("Opening MoonPay secure checkout. Review the final amount, fees, and recipient before paying.");
    popup.opener = null;
    popup.location.href = data.url;
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  } finally {
    if (button) { button.disabled = false; button.textContent = "Buy SOL with MoonPay"; }
  }
}
async function lockWallet() {
  keypair = null; publicKey = "";
  window.embeddedSolanaWallet = null;
  if (balanceTimer) clearInterval(balanceTimer);
  balanceTimer = null;
  $("embeddedWalletAuth").hidden = false;
  $("embeddedWalletDetails").hidden = true;
  $("embeddedWalletLock").disabled = true;
  $("connectEmbeddedWalletBtn").disabled = true;
  $("embeddedWalletTopLabel").textContent = "My Wallet";
  $("embeddedWalletUsername").textContent = "Locked";
  $("liveWalletLabel").textContent = "Built-in wallet locked";
  status("Wallet locked. The encrypted key remains in this browser's local IndexedDB storage.");
  window.dispatchEvent(new CustomEvent("embedded-wallet-locked"));
}
$("embeddedWalletCreateBtn").addEventListener("click", () => createWallet().catch(e => status(e.message || "Wallet creation failed.", true)));
$("embeddedWalletLoginBtn").addEventListener("click", () => loginWallet().catch(e => status(e.message || "Login failed.", true)));
$("embeddedWalletLock").addEventListener("click", lockWallet);
$("embeddedWalletExportBtn").addEventListener("click", () => exportKey().catch(e => status(e.message, true)));
$("embeddedWalletSendBtn").addEventListener("click", () => sendSol().catch(e => status(e.message || "Transfer failed.", true)));
$("embeddedWalletBuyBtn")?.addEventListener("click", () => buySolWithMoonPay().catch(e => status(e.message || "Could not open MoonPay checkout.", true)));
$("embeddedWalletShowQrBtn")?.addEventListener("click", () => showReceiveQr().catch(e => { $("embeddedWalletScanStatus").textContent = e.message || "Could not create QR code."; }));
$("embeddedWalletHideQrBtn")?.addEventListener("click", () => { $("embeddedWalletQrPanel").hidden = true; });
async function copyWalletAddress() {
  if (!publicKey) {
    status("Unlock your wallet before copying its address.", true);
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(publicKey);
    } else {
      const temp = document.createElement("textarea");
      temp.value = publicKey;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      temp.style.pointerEvents = "none";
      document.body.appendChild(temp);
      temp.select();
      const copied = document.execCommand("copy");
      temp.remove();
      if (!copied) throw new Error("Clipboard permission was denied.");
    }
    status("Address copied to clipboard ✓");
    const address = $("embeddedWalletAddress");
    if (address) {
      const previous = address.textContent;
      address.textContent = "Copied ✓";
      setTimeout(() => { if (address.textContent === "Copied ✓") address.textContent = previous; }, 1800);
    }
  } catch {
    status("Could not copy automatically. Select the wallet address and copy it manually.", true);
  }
}
$("embeddedWalletCopyAddress")?.addEventListener("click", copyWalletAddress);
$("embeddedWalletCopyAddress2")?.addEventListener("click", copyWalletAddress);
$("embeddedWalletStartScanBtn")?.addEventListener("click", () => startQrScanner());
$("embeddedWalletStopScanBtn")?.addEventListener("click", () => stopQrScanner());
$("embeddedWalletQrFile")?.addEventListener("change", event => {
  const file = event.target.files && event.target.files[0];
  scanQrImage(file);
  event.target.value = "";
});
window.addEventListener("pagehide", () => { stopQrScanner(); });

$("embeddedWalletBackupAck").addEventListener("click", async () => {
  if (!$("embeddedWalletBackupAck").checked) return;
  const record = await readRecord();
  if (record) { record.backupAcknowledged = true; await saveRecord(record); $("embeddedWalletBackup").hidden = true; status("Confirmed. Keep your recovery key in a safe place outside this browser."); }
});
(async () => {
  try {
    const record = await readRecord();
    if (record) {
      $("embeddedWalletUsernameInput").value = record.username;
      $("embeddedWalletCreateBtn").disabled = true;
      $("embeddedWalletCreateBtn").textContent = "Wallet already created";
      status("Encrypted wallet found. Enter your username and password to unlock it.");
    } else status("Create your personal wallet. Your password is never sent to the server and cannot be reset.");
  } catch { status("IndexedDB is unavailable. Open this site over HTTPS in a modern browser.", true); }
})();

/* Local encrypted Solana wallet for this browser. Private keys are never sent to the server. */
import { Keypair, PublicKey, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "https://esm.sh/@solana/web3.js@1.98.4";
import bs58 from "https://esm.sh/bs58@6.0.0";

const $ = (id) => document.getElementById(id);
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
  $("embeddedWalletUsername").textContent = record.username;
  $("embeddedWalletBackup").hidden = !record.backupAcknowledged;
  $("embeddedWalletLock").disabled = false;
  $("connectEmbeddedWalletBtn").disabled = false;
  $("connectEmbeddedWalletBtn").textContent = "Connect built-in wallet";
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
  if (!keypair) throw new Error("Prvo otključaj novčanik.");
  const destination = new PublicKey($("embeddedWalletSendAddress").value.trim());
  const amount = Number($("embeddedWalletSendAmount").value);
  if (!Number.isFinite(amount) || amount < 0.001 || amount > 10) throw new Error("Transfers are limited to 0.001–10 SOL.");
  if (destination.equals(keypair.publicKey)) throw new Error("The recipient address is your own address.");
  if (!confirm("Poslati " + amount + " SOL na " + destination.toBase58() + "? Transakcija se ne može poništiti.")) return;
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

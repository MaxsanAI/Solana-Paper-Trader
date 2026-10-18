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
  if (typeof p !== "string" || p.length < 12) throw new Error("Lozinka mora imati najmanje 12 karaktera.");
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
  status("Novčanik je otključan samo u ovom tabu. Potpisivanje se obavlja lokalno.");
  refreshBalance();
  if (balanceTimer) clearInterval(balanceTimer);
  balanceTimer = setInterval(refreshBalance, 20000);
  window.embeddedSolanaWallet = {
    isEmbeddedSolanaWallet: true,
    publicKey: new PublicKey(publicKey),
    async connect() { if (!keypair) throw new Error("Wallet is locked."); return { publicKey: new PublicKey(publicKey) }; },
    async disconnect() { return true; },
    async signTransaction(tx) { if (!keypair) throw new Error("Unlock the built-in wallet first."); if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair); return tx; },
    async signAllTransactions(txs) { if (!keypair) throw new Error("Unlock the built-in wallet first."); for (const tx of txs) { if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair); } return txs; },
    async signAndSendTransaction(tx) {
      if (!keypair) throw new Error("Unlock the built-in wallet first.");
      if (typeof tx.sign === "function") tx.sign([keypair]); else tx.partialSign(keypair);
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const signature = await connection.sendRawTransaction(tx.serialize());
      return { signature };
    },
    async signMessage(message) {
      if (!keypair) throw new Error("Unlock the built-in wallet first.");
      const { sign } = await import("https://esm.sh/@noble/ed25519@2.2.3");
      return sign(message, keypair.secretKey.slice(0, 32));
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
  } catch { $("embeddedWalletBalance").textContent = "Nije dostupno"; }
}
async function createWallet() {
  const username = $("embeddedWalletUsernameInput").value.trim();
  const password = $("embeddedWalletPassword").value;
  validatePassword(password);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Korisničko ime: 3–32 slova, broja ili . _ -");
  const existing = await readRecord();
  if (existing) throw new Error("Novčanik već postoji u ovom browseru. Prijavi se ili prvo izvezi rezervni ključ.");
  const kp = Keypair.generate();
  const record = { ...(await encryptSecret(kp.secretKey, password)), username, address: kp.publicKey.toBase58(), createdAt: new Date().toISOString(), backupAcknowledged: false };
  await saveRecord(record);
  keypair = kp; publicKey = kp.publicKey.toBase58();
  $("embeddedWalletPassword").value = "";
  setUnlockedUI(record);
  // Display the backup secret only in this initial creation flow.
  $("embeddedWalletBackupSecret").textContent = bs58.encode(kp.secretKey);
  $("embeddedWalletBackup").hidden = false;
  status("Novčanik je kreiran. Odmah sačuvaj rezervni ključ van ovog uređaja.", true);
}
async function loginWallet() {
  const username = $("embeddedWalletUsernameInput").value.trim();
  const password = $("embeddedWalletPassword").value;
  const record = await readRecord();
  if (!record || record.username.toLowerCase() !== username.toLowerCase()) throw new Error("Nema naloga sa tim korisničkim imenom u ovom browseru.");
  let raw;
  try { raw = await decryptSecret(record, password); } catch { throw new Error("Pogrešna lozinka ili oštećen novčanik."); }
  const kp = Keypair.fromSecretKey(raw);
  if (kp.publicKey.toBase58() !== record.address) throw new Error("Provera adrese nije uspela.");
  keypair = kp; publicKey = record.address;
  $("embeddedWalletPassword").value = "";
  setUnlockedUI(record);
}
async function exportKey() {
  if (!keypair) throw new Error("Prvo otključaj novčanik.");
  const secret = bs58.encode(keypair.secretKey);
  $("embeddedWalletBackupSecret").textContent = secret;
  $("embeddedWalletBackup").hidden = false;
  status("Rezervni privatni ključ prikazan. Ne šalji ga nikome i ne čuvaj ga u cloud beleškama.", true);
}
async function sendSol() {
  if (!keypair) throw new Error("Prvo otključaj novčanik.");
  const destination = new PublicKey($("embeddedWalletSendAddress").value.trim());
  const amount = Number($("embeddedWalletSendAmount").value);
  if (!Number.isFinite(amount) || amount < 0.001 || amount > 10) throw new Error("Za početak je dozvoljeno 0.001–10 SOL po transferu.");
  if (destination.equals(keypair.publicKey)) throw new Error("Adresa primaoca je ista kao tvoja.");
  if (!confirm("Poslati " + amount + " SOL na " + destination.toBase58() + "? Transakcija se ne može poništiti.")) return;
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: latest.blockhash }).add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: destination, lamports: Math.floor(amount * LAMPORTS_PER_SOL) }));
  tx.partialSign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize());
  status("Transakcija poslata; čeka se potvrda…");
  await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
  $("embeddedWalletTxLink").innerHTML = '<a class="underline" target="_blank" rel="noopener noreferrer" href="https://solscan.io/tx/' + encodeURIComponent(signature) + '">Otvori transakciju u Solscan-u</a>';
  status("Transfer potvrđen na Solana Mainnet-u. Proveri adresu i potpis transakcije.");
  await refreshBalance();
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
  status("Novčanik zaključan. Šifrovani ključ ostaje u lokalnoj IndexedDB bazi.");
  window.dispatchEvent(new CustomEvent("embedded-wallet-locked"));
}
$("embeddedWalletCreateBtn").addEventListener("click", () => createWallet().catch(e => status(e.message || "Kreiranje nije uspelo.", true)));
$("embeddedWalletLoginBtn").addEventListener("click", () => loginWallet().catch(e => status(e.message || "Prijava nije uspela.", true)));
$("embeddedWalletLock").addEventListener("click", lockWallet);
$("embeddedWalletExportBtn").addEventListener("click", () => exportKey().catch(e => status(e.message, true)));
$("embeddedWalletSendBtn").addEventListener("click", () => sendSol().catch(e => status(e.message || "Transfer nije uspeo.", true)));
$("embeddedWalletBackupAck").addEventListener("click", async () => {
  if (!$("embeddedWalletBackupAck").checked) return;
  const record = await readRecord();
  if (record) { record.backupAcknowledged = true; await saveRecord(record); $("embeddedWalletBackup").hidden = true; status("Potvrđeno. Rezervni ključ sačuvaj na bezbednom mestu van browsera."); }
});
(async () => {
  try {
    const record = await readRecord();
    if (record) {
      $("embeddedWalletUsernameInput").value = record.username;
      $("embeddedWalletCreateBtn").disabled = true;
      $("embeddedWalletCreateBtn").textContent = "Wallet already created";
      status("Pronađen je šifrovani novčanik. Unesi korisničko ime i lozinku za otključavanje.");
    } else status("Napravi lični novčanik. Lozinka se ne šalje serveru i ne može se resetovati.");
  } catch { status("IndexedDB nije dostupan. Otvori sajt preko HTTPS-a u modernom browseru.", true); }
})();

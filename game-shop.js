import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

// Persistent wallet: coin points earned across runs, owned skins and upgrades.
const WALLET_KEY = "ejderha-wallet";

export const SKINS = [
  { id: "kizil", name: "KIZIL", price: 0, color: null },
  { id: "zumrut", name: "ZÜMRÜT", price: 400, color: 0x2fd67a },
  { id: "buz", name: "BUZ", price: 700, color: 0x7fd8ff },
  { id: "altin", name: "ALTIN", price: 1200, color: 0xffc629 },
  { id: "golge", name: "GÖLGE", price: 1800, color: 0x8a52ff },
];

export const UPGRADES = [
  {
    id: "magnet",
    name: "MANYET SÜRESİ",
    desc: "+3 sn / seviye",
    prices: [300, 600, 1000],
  },
  {
    id: "shield",
    name: "KALKAN SÜRESİ",
    desc: "+3 sn / seviye",
    prices: [300, 600, 1000],
  },
];

export const LIFE_PRICE = 500;
export const MAX_LIVES = 3;

function load() {
  const fallback = { coins: 0, skins: ["kizil"], skin: "kizil", magnet: 0, shield: 0, lives: 0 };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(WALLET_KEY)) };
  } catch {
    return fallback;
  }
}

export const wallet = load();

export function saveWallet() {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch {}
}

export const magnetDuration = () => 10 + wallet.magnet * 3;
export const shieldDuration = () => 10 + wallet.shield * 3;

// Tints every dragon material towards the skin colour. Materials are cloned
// once so the tint never leaks into other models sharing them.
export function applySkin(model) {
  if (!model) return;
  const skin = SKINS.find((s) => s.id === wallet.skin) || SKINS[0];
  const tint = skin.color === null ? null : new THREE.Color(skin.color);
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.skinned) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.userData.origColor = m.color.clone();
      });
      o.userData.skinned = true;
    }
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      m.color.copy(m.userData.origColor);
      if (tint) m.color.lerp(tint, 0.7);
      if (m.emissive) {
        m.emissive.set(tint ? tint : 0x000000);
        m.emissiveIntensity = tint ? 0.12 : 0;
      }
    });
  });
}

// Renders the shop into `root`. onChange runs after any purchase so the
// caller can refresh the HUD and re-skin the dragon.
export function renderShop(root, { onChange, sound }) {
  const coinsText = String(wallet.coins).padStart(4, "0");
  const skinRows = SKINS.map((s) => {
    const owned = wallet.skins.includes(s.id);
    const equipped = wallet.skin === s.id;
    const swatch = s.color === null ? "#9b2f22" : `#${s.color.toString(16).padStart(6, "0")}`;
    const label = equipped ? "KULLANILIYOR" : owned ? "KULLAN" : `${s.price} ◈`;
    return `<li><i class="swatch" style="background:${swatch}"></i><span>${s.name}</span>
      <button data-skin="${s.id}" ${equipped ? "disabled" : ""} class="${owned ? "" : "buy"}">${label}</button></li>`;
  }).join("");
  const upgradeRows = UPGRADES.map((u) => {
    const level = wallet[u.id];
    const maxed = level >= u.prices.length;
    const pips = u.prices.map((_, i) => `<b class="${i < level ? "on" : ""}"></b>`).join("");
    return `<li><span>${u.name}<small>${u.desc}</small></span><em class="pips">${pips}</em>
      <button data-upgrade="${u.id}" ${maxed ? "disabled" : ""} class="buy">${maxed ? "MAKS" : `${u.prices[level]} ◈`}</button></li>`;
  }).join("");
  const livesFull = wallet.lives >= MAX_LIVES;
  root.innerHTML = `
    <div class="tag">MAĞAZA</div>
    <div class="wallet">CÜZDAN <strong>${coinsText}</strong> ◈</div>
    <div class="shop-cols">
      <section><h3>EJDERHA RENGİ</h3><ul>${skinRows}</ul></section>
      <section><h3>GÜÇLENDİRMELER</h3><ul>${upgradeRows}
        <li><span>YEDEK CAN<small>Çarpınca bir kez kurtarır (${wallet.lives}/${MAX_LIVES})</small></span><em></em>
        <button data-life ${livesFull ? "disabled" : ""} class="buy">${livesFull ? "DOLU" : `${LIFE_PRICE} ◈`}</button></li>
      </ul></section>
    </div>
    <button class="shop-close" data-close>GERİ <b>←</b></button>`;
  root.querySelectorAll("button").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.close !== undefined) {
        root.classList.add("gone");
        return;
      }
      const ok = purchase(btn.dataset);
      sound(ok ? "buy" : "denied");
      if (ok) onChange();
      renderShop(root, { onChange, sound });
    }),
  );
}

function spend(price) {
  if (wallet.coins < price) return false;
  wallet.coins -= price;
  return true;
}

function purchase({ skin, upgrade, life }) {
  if (skin) {
    const s = SKINS.find((x) => x.id === skin);
    if (!wallet.skins.includes(skin)) {
      if (!spend(s.price)) return false;
      wallet.skins.push(skin);
    }
    wallet.skin = skin;
  } else if (upgrade) {
    const u = UPGRADES.find((x) => x.id === upgrade);
    const price = u.prices[wallet[upgrade]];
    if (price === undefined || !spend(price)) return false;
    wallet[upgrade] += 1;
  } else if (life !== undefined) {
    if (wallet.lives >= MAX_LIVES || !spend(LIFE_PRICE)) return false;
    wallet.lives += 1;
  }
  saveWallet();
  return true;
}

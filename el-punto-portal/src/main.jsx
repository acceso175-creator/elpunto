import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { businessDefaults, initialMenu } from './menuData.js';
import { isSupabaseConfigured, listProductImages } from './lib/supabaseClient.js';
import { getMenuData, normalizeMenuData } from './services/menuService.js';
import './styles.css';

const STORAGE = {
  menu: 'elpunto_menu_v1',
  business: 'elpunto_business_v1',
  metrics: 'elpunto_metrics_v1',
  profile: 'elpunto_profile_v1',
  cart: 'elpunto_cart_v1',
  session: 'elpunto_session_v1',
  lastStripeOrder: 'elpunto_last_stripe_order_v1'
};

const ADMIN_PIN = '1234';
const MAPS_LINK = 'https://maps.app.goo.gl/aR9oguMm12B9VBtB7';
const BUSINESS_WHATSAPP = '526146087217';
const BUSINESS_PHONE_DISPLAY = '614 608 7217';
const WHATSAPP_GREETING = 'Hola, quiero hacer un pedido en El Punto.';
const identity = (value) => value;
const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'pago_en_linea', label: 'Pago en línea' },
  { value: 'criptomonedas', label: 'Criptomonedas' }
];
const BASE_CATEGORY_NAMES = ['Desayunos', 'Birria', 'Bebidas', 'Postres'];



function mapBusinessSettings(row) {
  if (!row) return businessDefaults;
  return {
    ...businessDefaults,
    id: row.id,
    name: row.business_name || businessDefaults.name,
    subtitle: row.subtitle || businessDefaults.subtitle,
    whatsapp: row.whatsapp_number || businessDefaults.whatsapp,
    googleMapsUrl: row.google_maps_url || businessDefaults.googleMapsUrl,
    cryptoBtcWallet: row.crypto_btc_wallet || '',
    cryptoEthWallet: row.crypto_eth_wallet || '',
    cryptoUsdtTrc20Wallet: row.crypto_usdt_trc20_wallet || '',
    cryptoNote: row.crypto_note || '',
    cryptoWallets: [
      row.crypto_btc_wallet && `BTC: ${row.crypto_btc_wallet}`,
      row.crypto_eth_wallet && `ETH: ${row.crypto_eth_wallet}`,
      row.crypto_usdt_trc20_wallet && `USDT TRC20: ${row.crypto_usdt_trc20_wallet}`,
      row.crypto_note
    ].filter(Boolean)
  };
}

async function adminRequest(functionName, { method = 'POST', pin, body = {} } = {}) {
  const endpoint = `/.netlify/functions/${functionName}${method === 'GET' ? `?t=${Date.now()}` : ''}`;
  const response = await fetch(endpoint, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(pin ? { 'x-admin-pin': pin } : {})
    },
    body: method === 'GET' ? undefined : JSON.stringify({ adminPin: pin, ...body })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Error en función de Netlify.');
  return result;
}

function menuFromAdminSnapshot(snapshot) {
  return normalizeMenu(normalizeMenuData(snapshot.categories || [], snapshot.products || []));
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function categoryDescription(name) {
  const known = {
    desayunos: 'Clásicos para arrancar el día.',
    birria: 'Opciones con cebolla, cilantro, limón y salsa.',
    bebidas: 'Café, jugos, malteadas y smoothies.',
    postres: 'Algo dulce para cerrar tu pedido.'
  };
  return known[slugify(name)] || 'Categoría editable desde Admin.';
}

function createCategory(name) {
  const cleanName = String(name || '').trim();
  return {
    id: slugify(cleanName) || `categoria-${Date.now()}`,
    name: cleanName || 'Nueva categoría',
    description: categoryDescription(cleanName),
    items: []
  };
}

function categoryExists(menu, name) {
  const id = slugify(name);
  return menu.some((category) => category.id === id || slugify(category.name) === id);
}

function categoryOptions(menu) {
  const byId = new Map();
  BASE_CATEGORY_NAMES.forEach((name, index) => {
    const category = menu.find((item) => slugify(item.name) === slugify(name) || item.id === slugify(name));
    byId.set(slugify(name), category || { ...createCategory(name), sortOrder: index });
  });
  menu.forEach((category, index) => byId.set(category.id || slugify(category.name), { ...category, sortOrder: Number(category.sortOrder ?? category.sort_order ?? index) }));
  return [...byId.values()].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
}

function normalizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((ingredient) => {
      if (typeof ingredient === 'string') {
        return { name: ingredient, removable: true };
      }
      return {
        name: String(ingredient?.name || '').trim(),
        removable: ingredient?.removable !== false
      };
    })
    .filter((ingredient) => ingredient.name);
}

function normalizeMenu(menu) {
  if (!Array.isArray(menu)) return normalizeMenu(initialMenu);
  return menu.map((category, categoryIndex) => ({
    ...category,
    id: category.id || slugify(category.name),
    name: category.name || 'Categoría',
    description: category.description || categoryDescription(category.name),
    sortOrder: Number(category.sortOrder ?? category.sort_order ?? categoryIndex),
    items: (category.items || []).map((item) => ({
      ...item,
      cost: item.cost ?? null,
      ingredientCost: item.ingredientCost ?? item.ingredient_cost ?? null,
      packagingCost: item.packagingCost ?? item.packaging_cost ?? null,
      discountPrice: item.discountPrice ?? item.discount_price ?? null,
      discountActive: item.discountActive ?? item.discount_active ?? false,
      isSupabaseProduct: item.isSupabaseProduct === true,
      supabaseProductId: item.isSupabaseProduct === true && isUuid(item.supabaseProductId || item.id) ? (item.supabaseProductId || item.id) : undefined,
      images: Array.isArray(item.images) ? item.images.filter((image) => typeof image === 'string' && !image.startsWith('data:')) : [],
      ingredients: normalizeIngredients(item.ingredients)
    }))
  })).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
}

function removableIngredientNames(ingredients) {
  return normalizeIngredients(ingredients)
    .filter((ingredient) => ingredient.removable)
    .map((ingredient) => ingredient.name);
}

function productOptions(product) {
  return Array.isArray(product?.options) ? product.options : [];
}

function usePersistedState(key, fallback, normalize = identity) {
  const [state, setState] = useState(() => normalize(readStorage(key, fallback)));
  useEffect(() => writeStorage(key, normalize(state)), [key, normalize, state]);
  return [state, setState];
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return 'Precio por confirmar';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function itemBasePrice(item) {
  return numericValue(item?.price ?? item?.unitPrice ?? item?.unit_price);
}

function itemDiscountPrice(item) {
  return numericValue(item?.discount_price ?? item?.discountPrice);
}

function isDiscountActive(product) {
  return product?.discount_active === true || product?.discountActive === true || product?.discount_active === 'true' || product?.discountActive === 'true' || product?.discount_active === 1 || product?.discountActive === 1;
}

function hasValidDiscount(product) {
  const price = Number(product?.price || 0);
  const discountPrice = Number(product?.discount_price ?? product?.discountPrice ?? 0);
  return isDiscountActive(product) && Number.isFinite(price) && price > 0 && Number.isFinite(discountPrice) && discountPrice > 0 && discountPrice < price;
}

function getEffectivePrice(product) {
  const price = Number(product?.price ?? product?.unitPrice ?? product?.unit_price ?? 0);
  const discountPrice = Number(product?.discount_price ?? product?.discountPrice ?? 0);
  if (hasValidDiscount(product)) return discountPrice;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function hasActiveDiscount(item) {
  return hasValidDiscount(item);
}

function itemNumericPrice(item) {
  return getEffectivePrice(item);
}

function hasNumericPrice(item) {
  return itemNumericPrice(item) !== null;
}

function parseOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function adminNumberInputValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(value) : '';
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function productProfitMetrics(item) {
  const rawCost = item?.cost;
  const costNumber = rawCost === null || rawCost === undefined || rawCost === '' ? null : Number(rawCost);
  const cost = Number.isFinite(costNumber) && costNumber >= 0 ? costNumber : null;
  const price = itemBasePrice(item);
  const discount = itemDiscountPrice(item);
  return {
    normalProfit: cost !== null && price !== null ? price - cost : null,
    discountProfit: cost !== null && discount !== null ? discount - cost : null,
    normalMargin: cost !== null && price !== null ? ((price - cost) / price) * 100 : null,
    discountMargin: cost !== null && discount !== null ? ((discount - cost) / discount) * 100 : null
  };
}

function cartItemsMissingPrice(cart) {
  return cart.filter((item) => !hasNumericPrice(item));
}

function paymentLabel(value) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label || 'Efectivo';
}

function businessWhatsappNumber(business) {
  const configured = String(business?.whatsapp || '').replace(/[^0-9]/g, '');
  return configured && configured !== '526140000000' ? configured : BUSINESS_WHATSAPP;
}

function openBusinessWhatsApp(business, message = WHATSAPP_GREETING) {
  window.open(`https://wa.me/${businessWhatsappNumber(business)}?text=${encodeURIComponent(message)}`, '_blank');
}

function cryptoWalletsFromBusiness(business) {
  if (Array.isArray(business.cryptoWallets)) return business.cryptoWallets.filter(Boolean);
  return String(business.cryptoWallets || '')
    .split('\n')
    .map((wallet) => wallet.trim())
    .filter(Boolean);
}

function clearAdminSession() {
  const keys = ['adminAuthenticated', 'adminPin', 'isAdmin', 'adminSession'];
  keys.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

function goHomeFromAdmin() {
  clearAdminSession();
  window.location.assign('/');
}

function createStableUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isSupabaseBackedProduct(item) {
  return item?.isSupabaseProduct === true && isUuid(item?.supabaseProductId || item?.id);
}

function productImageKey(item) {
  return isSupabaseBackedProduct(item) ? (item.supabaseProductId || item.id) : '';
}

function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function bumpMetric(name, amount = 1) {
  const metrics = readStorage(STORAGE.metrics, defaultMetrics());
  metrics[name] = (metrics[name] || 0) + amount;
  metrics.lastActivity = new Date().toISOString();
  writeStorage(STORAGE.metrics, metrics);
  window.dispatchEvent(new Event('elpunto:metrics'));
}

function defaultMetrics() {
  return {
    visits: 0,
    uniqueSessions: 0,
    addToCart: 0,
    orderRequests: 0,
    lastActivity: null
  };
}

function ensureSessionMetric() {
  const existing = localStorage.getItem(STORAGE.session);
  const metrics = readStorage(STORAGE.metrics, defaultMetrics());
  metrics.visits += 1;
  if (!existing) {
    localStorage.setItem(STORAGE.session, crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    metrics.uniqueSessions += 1;
  }
  metrics.lastActivity = new Date().toISOString();
  writeStorage(STORAGE.metrics, metrics);
}

function calculateLine(item) {
  const proteinExtra = Object.values(item.selectedOptions || {}).some((value) => String(value).includes('+$25'));
  return (itemNumericPrice(item) || 0) + (proteinExtra ? 25 : 0);
}

function createOrderNumber() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `EP-${y}${m}${d}-${h}${min}-${rand}`;
}

function App() {
  const [menu, setMenu] = usePersistedState(STORAGE.menu, normalizeMenu(initialMenu), normalizeMenu);
  const [business, setBusiness] = usePersistedState(STORAGE.business, businessDefaults);
  const [cart, setCart] = usePersistedState(STORAGE.cart, []);
  const [profile, setProfile] = usePersistedState(STORAGE.profile, { name: '', phone: '', isMember: false });
  const currentPath = window.location.pathname;
  const isAdminPath = currentPath === '/admin';
  const isPaymentSuccessPath = currentPath === '/payment-success';
  const isPaymentCancelPath = currentPath === '/payment-cancel';
  const [activeSection, setActiveSection] = useState(isAdminPath ? 'admin' : (window.location.hash === '#pedido' ? 'pedido' : 'inicio'));
  const [productImages, setProductImages] = useState({});
  const [productImagesError, setProductImagesError] = useState('');
  const [dataSource, setDataSource] = useState(isSupabaseConfigured ? 'loading' : 'local');

  useEffect(() => {
    ensureSessionMetric();
  }, []);

  useEffect(() => {
    if (window.location.hash === '#pedido') {
      window.setTimeout(() => document.getElementById('pedido')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSupabaseMenu() {
      if (!isSupabaseConfigured) return;
      const result = await getMenuData();
      if (cancelled) return;
      if (result.business) setBusiness((current) => ({ ...current, ...result.business }));
      if (result.source === 'supabase') {
        setMenu(normalizeMenu(result.menu));
        const grouped = {};
        result.menu.forEach((category) => {
          category.items.forEach((item) => {
            if (item.images?.length && productImageKey(item)) grouped[productImageKey(item)] = item.images;
          });
        });
        setProductImages(grouped);
      }
      setDataSource(result.source);
    }
    loadSupabaseMenu();
    return () => { cancelled = true; };
  }, [setBusiness, setMenu]);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + calculateLine(item) * item.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const supabaseProductIds = useMemo(() => menu.flatMap((category) => category.items.map(productImageKey).filter(Boolean)), [menu]);

  function addToCart(payload) {
    setCart((current) => [...current, { ...payload, cartId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` }]);
    bumpMetric('addToCart');
  }

  function removeFromCart(cartId) {
    setCart((current) => current.filter((item) => item.cartId !== cartId));
  }

  function clearCart() {
    setCart([]);
  }

  async function refreshProductImages() {
    if (!isSupabaseConfigured || !supabaseProductIds.length) {
      setProductImages({});
      return;
    }
    try {
      const records = await listProductImages(supabaseProductIds);
      const grouped = records.reduce((acc, image) => {
        acc[image.product_id] = [...(acc[image.product_id] || []), image];
        return acc;
      }, {});
      setProductImages(grouped);
      setProductImagesError('');
    } catch (error) {
      setProductImagesError(error.message);
    }
  }

  useEffect(() => {
    refreshProductImages();
  }, [supabaseProductIds.join('|')]);

  function navigateTo(section) {
    if (isAdminPath) return;
    const sectionIds = {
      inicio: 'inicio',
      ubicacion: 'ubicacion',
      menu: 'menu',
      pedido: 'pedido',
      cuenta: 'club-el-punto'
    };
    setActiveSection(section === 'ubicacion' ? 'inicio' : section);
    window.setTimeout(() => {
      document.getElementById(sectionIds[section] || section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  if (isPaymentSuccessPath || isPaymentCancelPath) {
    return <PaymentResultPage type={isPaymentSuccessPath ? 'success' : 'cancel'} business={business} />;
  }

  if (isAdminPath) {
    return (
      <main className="admin-route">
        <div className="admin-route__bar">
          <button className="button--ghost admin-exit" onClick={goHomeFromAdmin}>Salir del admin</button>
        </div>
        <AdminSection menu={menu} setMenu={setMenu} business={business} setBusiness={setBusiness} productImages={productImages} refreshProductImages={refreshProductImages} productImagesError={productImagesError} dataSource={dataSource} setDataSource={setDataSource} />
      </main>
    );
  }

  return (
    <main>
      <Header navigateTo={navigateTo} business={business} />
      <Hero navigateTo={navigateTo} />
      <LocationSection business={business} />
      
      {activeSection === 'inicio' && <HomeImages />}

      {activeSection === 'menu' && (
        <MenuSection menu={menu} addToCart={addToCart} productImages={productImages} />
      )}

      {activeSection === 'pedido' && (
        <OrderSection
          cart={cart}
          cartTotal={cartTotal}
          removeFromCart={removeFromCart}
          clearCart={clearCart}
          business={business}
          profile={profile}
          setProfile={setProfile}
        />
      )}

      {activeSection === 'cuenta' && (
        <AccountSection profile={profile} setProfile={setProfile} />
      )}


      <Footer business={business} />
      <FloatingCart cartCount={cartCount} cartTotal={cartTotal} navigateTo={navigateTo} />
    </main>
  );
}


function Header({ navigateTo, business }) {
  const [logoError, setLogoError] = useState(false);
  const links = [
    ['inicio', 'Inicio'],
    ['ubicacion', 'Ubicación'],
    ['menu', 'Menú'],
    ['pedido', 'Pedido'],
    ['cuenta', 'Club El Punto']
  ];

  function handleHeaderNav(target) {
    navigateTo(target);
  }


  return (
    <header className="site-header">
      <button className="brand-mini" onClick={() => navigateTo('inicio')} aria-label="Ir al inicio">
        <span className="brand-logo">
          {!logoError ? <img src="/images/logo-el-punto.png" alt="Logo El Punto" onError={() => setLogoError(true)} /> : <span className="brand-logo__fallback">El Punto</span>}
        </span>
      </button>
      <nav className="site-nav">
        {links.map(([id, label]) => (
          <button key={id} className="site-nav__link" onClick={() => handleHeaderNav(id)}>{label}</button>
        ))}
      </nav>
      <button className="site-header__cta" onClick={() => openBusinessWhatsApp(business)}>Hacer pedido</button>
    </header>
  );
}

function ImagePlaceholder({ src, alt, fallback }) {
  const [error, setError] = useState(false);
  if (error) return <div className="image-placeholder">{fallback}</div>;
  return <img src={src} alt={alt} className="home-image" onError={() => setError(true)} />;
}

function HomeImages() {
  return (
    <section className="section home-gallery">
      <ImagePlaceholder src="/images/inicio/hero.jpg" alt="Imagen principal" fallback="Imagen del producto" />
      <ImagePlaceholder src="/images/inicio/desayuno-destacado.jpg" alt="Desayuno destacado" fallback="Desayuno destacado" />
      <ImagePlaceholder src="/images/inicio/local.jpg" alt="Foto del local" fallback="Foto del local" />
    </section>
  );
}

function Hero({ navigateTo }) {
  return (
    <section id="inicio" className="hero scroll-target">
      <div className="hero__content">
        <p className="eyebrow">Centro de Chihuahua · para llevar</p>
        <h1>El Punto<span>.</span></h1>
        <p className="subtitle">Food To Go</p>
        <p className="hero__copy">Desayunos, comida rápida y antojos listos para llevar.</p>
        <div className="hero__actions">
          <button onClick={() => navigateTo('menu')}>Ver menú</button>
        </div>
      </div>
      <div className="hero__card">
        <div className="pin" aria-hidden="true">⌖</div>
        <h2>Pedido rápido</h2>
        <p>Recoger o domicilio</p>
        <p>Pago en efectivo, tarjeta o transferencia</p>
        <p>WhatsApp automático con número de orden</p>
      </div>
    </section>
  );
}


function LocationSection({ business }) {
  const mapsLink = business.googleMapsUrl || MAPS_LINK;
  return (
    <section id="ubicacion" className="section scroll-target">
      <div className="location-card">
        <div>
          <p className="eyebrow">Ubicación</p>
          <h2>Estamos aquí</h2>
          <p className="location-copy">Pasa por tu pedido o mándanos tu ubicación para entrega.</p>
          <div className="location-actions">
            <a className="location-link location-link--primary" href={mapsLink} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
          </div>
        </div>
        <div className="map-placeholder" aria-label="Mapa del local">
          <span className="map-pin" aria-hidden="true">📍</span>
          <strong>Mapa del local</strong>
          <p>Espacio preparado para reemplazar después por Google Maps Embed.</p>
        </div>
      </div>
    </section>
  );
}

function MenuSection({ menu, addToCart, productImages }) {
  const [activeCategory, setActiveCategory] = useState('todo');
  const visibleCategories = menu.filter((category) => (category.items || []).length > 0);
  const filteredCategories = activeCategory === 'todo'
    ? visibleCategories
    : visibleCategories.filter((category) => category.id === activeCategory);
  const filters = [{ id: 'todo', name: 'Todo' }, ...visibleCategories.map((category) => ({ id: category.id, name: category.name }))];

  return (
    <section id="menu" className="section scroll-target">
      <div className="section__heading">
        <p className="eyebrow">Menú</p>
        <h2>Arma tu pedido</h2>
        <p>Elige tus productos, ajusta ingredientes y manda tu pedido directo por WhatsApp.</p>
      </div>

      <div className="category-filter" aria-label="Filtros de categorías">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={activeCategory === filter.id ? 'category-filter__chip active' : 'category-filter__chip'}
            onClick={() => setActiveCategory(filter.id)}
          >
            {filter.name}
          </button>
        ))}
      </div>

      {filteredCategories.length === 0 ? (
        <p className="empty">Todavía no hay productos en esta categoría.</p>
      ) : filteredCategories.map((category) => (
        <div key={category.id} className="category">
          <div className="category__title">
            <h3>{category.name}</h3>
            <p>{category.description}</p>
          </div>
          <div className="grid">
            {category.items.map((item) => (
              <ProductCard key={item.id} item={item} categoryId={category.id} addToCart={addToCart} images={productImages[productImageKey(item)] || []} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ProductCard({ item, categoryId, addToCart, images }) {
  const [quantity, setQuantity] = useState(1);
  const [removed, setRemoved] = useState([]);
  const [imageIndex, setImageIndex] = useState(0);
  const imageUrls = images.map((image) => image.image_url || image.imageUrl).filter(Boolean);
  const removableIngredients = removableIngredientNames(item.ingredients);
  const optionList = productOptions(item);
  const [selectedOptions, setSelectedOptions] = useState(() => {
    const options = {};
    optionList.forEach((option) => {
      options[option.name] = option.values?.[0] || '';
    });
    return options;
  });

  useEffect(() => {
    if (imageIndex >= imageUrls.length) setImageIndex(0);
  }, [imageIndex, imageUrls.length]);

  const basePrice = itemBasePrice(item);
  const discountPrice = itemDiscountPrice(item);
  const effectivePrice = getEffectivePrice(item);
  const showDiscount = hasValidDiscount(item);

  function toggleIngredient(ingredient) {
    setRemoved((current) => current.includes(ingredient)
      ? current.filter((value) => value !== ingredient)
      : [...current, ingredient]
    );
  }

  function handleAdd() {
    addToCart({
      id: item.id,
      supabaseProductId: item.supabaseProductId || (isUuid(item.id) ? item.id : undefined),
      categoryId,
      name: item.name,
      price: item.price,
      priceLabel: item.priceLabel,
      discountPrice: item.discountPrice,
      discountActive: item.discountActive,
      effectivePrice,
      quantity,
      removedIngredients: removed,
      selectedOptions,
      description: item.description
    });
  }

  return (
    <article className={`product ${!item.available ? 'product--disabled' : ''}`}>
      <div className="product-media">
        {imageUrls.length > 0 ? (
          <>
            <img src={imageUrls[imageIndex]} alt={item.name} className="product-media__image" />
            {imageUrls.length > 1 && (
              <div className="product-media__controls">
                <button type="button" className="button--ghost" onClick={() => setImageIndex((imageIndex - 1 + imageUrls.length) % imageUrls.length)}>‹</button>
                <span>{imageIndex + 1}/{imageUrls.length}</span>
                <button type="button" className="button--ghost" onClick={() => setImageIndex((imageIndex + 1) % imageUrls.length)}>›</button>
              </div>
            )}
          </>
        ) : (
          <div className="product-media__placeholder">Imagen del producto</div>
        )}
      </div>
      <div className="product__top">
        <div>
          <h4>{item.name}</h4>
          <p>{item.description}</p>
        </div>
        {item.badge && <span className="badge">{item.badge}</span>}
      </div>
      {basePrice ? (
        <div className={showDiscount ? 'price-stack' : 'price'}>
          {showDiscount ? (
            <>
              <span className="price-old">{formatMoney(basePrice)}</span>
              <strong className="price-discount">{formatMoney(discountPrice)}</strong>
              <span className="badge promo-badge">Promo</span>
            </>
          ) : (
            <strong>{formatMoney(basePrice)}</strong>
          )}
        </div>
      ) : (
        <strong className="price">{item.priceLabel || 'Precio por confirmar'}</strong>
      )}

      {optionList.length > 0 && (
        <div className="modifiers">
          {optionList.map((option) => (
            <label key={option.name}>
              {option.name}
              <select
                value={selectedOptions[option.name] || ''}
                onChange={(event) => setSelectedOptions((current) => ({ ...current, [option.name]: event.target.value }))}
              >
                {(option.values || []).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      {removableIngredients.length > 0 && <div className="ingredients">
        <p>Quitar ingredientes:</p>
        <div>
          {removableIngredients.map((ingredient) => (
            <button
              type="button"
              key={ingredient}
              className={removed.includes(ingredient) ? 'chip chip--off' : 'chip'}
              onClick={() => toggleIngredient(ingredient)}
            >
              {removed.includes(ingredient) ? `Sin ${ingredient}` : ingredient}
            </button>
          ))}
        </div>
      </div>}

      <div className="product__actions">
        <label className="qty">
          Cant.
          <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} />
        </label>
        <button disabled={!item.available} onClick={handleAdd}>{item.available ? 'Agregar' : 'Agotado'}</button>
      </div>
    </article>
  );
}

function OrderSection({ cart, cartTotal, removeFromCart, clearCart, business, profile, setProfile }) {
  const [orderType, setOrderType] = useState('recoger');
  const [payment, setPayment] = useState('efectivo');
  const [address, setAddress] = useState('');
  const [geoLink, setGeoLink] = useState('');
  const [notes, setNotes] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const selectedPaymentLabel = paymentLabel(payment);
  const itemsMissingPrice = useMemo(() => cartItemsMissingPrice(cart), [cart]);
  const hasPriceConfirmation = itemsMissingPrice.length > 0;
  const isCartTotalNumeric = Number.isFinite(Number(cartTotal)) && Number(cartTotal) > 0;
  const checkoutDisabledReason = !cart.length
    ? 'empty_cart'
    : hasPriceConfirmation
      ? 'missing_prices'
      : !isCartTotalNumeric
        ? 'invalid_total'
        : '';
  const isOnlinePaymentReady = payment === 'pago_en_linea' && !checkoutDisabledReason;
  const cryptoWallets = cryptoWalletsFromBusiness(business);

  useEffect(() => {
    if (payment === 'pago_en_linea' && checkoutDisabledReason) {
      console.warn('Stripe checkout disabled reason:', checkoutDisabledReason);
    }
  }, [payment, checkoutDisabledReason]);

  function getLocation() {
    if (!navigator.geolocation) {
      alert('Tu navegador no permite ubicación automática. Puedes escribir tu dirección manualmente.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setGeoLink(`https://maps.google.com/?q=${latitude},${longitude}`);
        setIsLocating(false);
      },
      () => {
        alert('No se pudo tomar la ubicación. Escríbela manualmente.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function buildMessage(forStripeOrderNumber = '') {
    const orderNumber = forStripeOrderNumber || createOrderNumber();
    const items = cart.map((item, index) => {
      const opts = Object.entries(item.selectedOptions || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      const removed = item.removedIngredients?.length ? ` | Sin: ${item.removedIngredients.join(', ')}` : '';
      const linePrice = calculateLine(item) * item.quantity;
      const priceText = linePrice ? ` | Subtotal: ${formatMoney(linePrice)}` : '';
      return `${index + 1}. ${item.quantity} x ${item.name}${opts ? ` (${opts})` : ''}${removed}${priceText}`;
    }).join('\n');

    const locationText = orderType === 'domicilio'
      ? `\nDirección: ${address || 'pendiente de confirmar'}${geoLink ? `\nUbicación Maps: ${geoLink}` : ''}`
      : '';

    const totalText = cartTotal ? formatMoney(cartTotal) : 'Por confirmar';
    const paymentNote = payment === 'pago_en_linea'
      ? '\nEstado: pendiente de pago'
      : payment === 'criptomonedas'
        ? '\nPago con criptomonedas seleccionado. Solicito datos de pago.'
        : '';

    return `Hola, quiero hacer un pedido en El Punto.\n\nOrden: ${orderNumber}\nNombre: ${profile.name || 'Cliente'}\nTeléfono: ${profile.phone || 'No capturado'}\nMétodo de pago: ${selectedPaymentLabel}${paymentNote}\n${orderType === 'domicilio' ? 'Tipo: A domicilio' : 'Tipo: Para recoger'}${locationText}\n\nPedido:\n${items}\n\nTotal estimado: ${totalText}\nNotas: ${notes || 'Sin notas'}\n\nPor favor confírmenme disponibilidad y tiempo estimado.`;
  }

  async function startStripeCheckout() {
    if (!isOnlinePaymentReady || checkoutLoading) return;
    if (orderType === 'domicilio' && !address && !geoLink) {
      setCheckoutError('Para domicilio agrega dirección o ubicación antes de pagar.');
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const whatsappMessage = buildMessage();
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart,
          customerName: profile.name,
          customerPhone: profile.phone,
          orderType,
          deliveryAddress: orderType === 'domicilio' ? [address, geoLink].filter(Boolean).join(' | ') : '',
          notes,
          paymentMethod: payment,
          whatsappMessage
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo iniciar el pago con tarjeta.');
      writeStorage(STORAGE.lastStripeOrder, { orderId: result.orderId, orderNumber: result.orderNumber, customerName: profile.name, customerPhone: profile.phone });
      window.location.href = result.checkoutUrl;
    } catch (error) {
      setCheckoutError(error.message || 'No se pudo iniciar el pago con tarjeta.');
      setCheckoutLoading(false);
    }
  }

  function sendWhatsApp() {
    if (!cart.length) return;
    if (orderType === 'domicilio' && !address && !geoLink) {
      alert('Para domicilio agrega dirección o ubicación antes de mandar el pedido.');
      return;
    }
    const number = businessWhatsappNumber(business);
    if (!number) {
      alert('Falta configurar el número de WhatsApp en Admin.');
      return;
    }
    bumpMetric('orderRequests');
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(buildMessage())}`, '_blank');
  }

  return (
    <section id="pedido" className="section order-layout scroll-target">
      <div className="panel">
        <div className="section__heading compact">
          <p className="eyebrow">Pedido</p>
          <h2>Confirma y manda por WhatsApp</h2>
        </div>

        {cart.length === 0 ? (
          <p className="empty">Tu pedido está vacío. Agrega productos desde el menú.</p>
        ) : (
          <div className="cart-list">
            {cart.map((item) => (
              <div key={item.cartId} className="cart-item">
                <div>
                  <strong>{item.quantity} x {item.name}</strong>
                  <p>{Object.entries(item.selectedOptions || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                  {item.removedIngredients?.length > 0 && <p>Sin: {item.removedIngredients.join(', ')}</p>}
                </div>
                <div className="cart-item__side">
                  <span>{formatMoney(calculateLine(item) * item.quantity)}</span>
                  <button className="button--link" onClick={() => removeFromCart(item.cartId)}>Quitar</button>
                </div>
              </div>
            ))}
            <div className="total">
              <span>Total estimado</span>
              <strong>{cartTotal ? formatMoney(cartTotal) : 'Por confirmar'}</strong>
            </div>
            <button className="button--ghost full" onClick={clearCart}>Vaciar pedido</button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="form-grid">
          <label>
            Nombre
            <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Tu nombre" />
          </label>
          <label>
            Teléfono
            <input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="614..." />
          </label>
          <label>
            Tipo de pedido
            <select value={orderType} onChange={(event) => setOrderType(event.target.value)}>
              <option value="recoger">Para recoger</option>
              <option value="domicilio">A domicilio</option>
            </select>
          </label>
          <label>
            Método de pago
            <select value={payment} onChange={(event) => setPayment(event.target.value)}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
          </label>
        </div>

        {payment === 'pago_en_linea' && (
          <div className="payment-info-card">
            <p>Paga de forma segura con tarjeta antes de enviar tu pedido.</p>
            {hasPriceConfirmation && (
              <div className="small-note warning-note">
                <p>Este pedido tiene productos con precio por confirmar.</p>
                {itemsMissingPrice.map((item) => (
                  <p key={item.cartId || item.id || item.name}>Falta precio: {item.name || 'Producto sin nombre'}</p>
                ))}
              </div>
            )}
            {!hasPriceConfirmation && checkoutDisabledReason === 'invalid_total' && (
              <p className="small-note warning-note">El total del pedido no es válido para pagar en línea.</p>
            )}
            {checkoutError && <p className="error-note">{checkoutError}</p>}
            <button className="button--ghost" disabled={!isOnlinePaymentReady || checkoutLoading} onClick={startStripeCheckout}>
              {checkoutLoading ? 'Creando pago...' : 'Pagar con tarjeta'}
            </button>
          </div>
        )}

        {payment === 'criptomonedas' && (
          <div className="payment-info-card">
            <p>Te enviaremos los datos de pago por WhatsApp para confirmar tu pedido.</p>
            {cryptoWallets.length > 0 && (
              <ul className="wallet-list">
                {cryptoWallets.map((wallet) => <li key={wallet}>{wallet}</li>)}
              </ul>
            )}
          </div>
        )}

        <p className="small-note">También puedes abrir nuestra ubicación para calcular distancia o recoger en local. <a href={business.googleMapsUrl || MAPS_LINK} target="_blank" rel="noreferrer">Ver ubicación</a>.</p>

        {orderType === 'domicilio' && (
          <div className="delivery-box">
            <label>
              Dirección / referencias
              <textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Calle, número, colonia, referencias..." />
            </label>
            <button className="button--ghost" onClick={getLocation}>{isLocating ? 'Tomando ubicación...' : 'Usar mi ubicación'}</button>
            {geoLink && <p className="success">Ubicación lista: <a href={geoLink} target="_blank" rel="noreferrer">abrir mapa</a></p>}
          </div>
        )}

        <label>
          Notas para cocina
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. salsa aparte, poco hielo, sin cebolla..." />
        </label>

        <button className="full" disabled={!cart.length} onClick={sendWhatsApp}>Mandar pedido por WhatsApp</button>
        <p className="small-note">El portal genera el mensaje. El pedido queda confirmado hasta que el negocio responda por WhatsApp.</p>
      </div>
    </section>
  );
}


function PaymentResultPage({ type, business }) {
  const params = new URLSearchParams(window.location.search);
  const storedOrder = readStorage(STORAGE.lastStripeOrder, {});
  const orderNumber = params.get('order_number') || storedOrder.orderNumber || '';
  const isSuccess = type === 'success';

  function sendPaymentWhatsApp() {
    const number = businessWhatsappNumber(business);
    if (!number) {
      alert('Falta configurar el número de WhatsApp en Admin.');
      return;
    }
    const message = `Pago en línea realizado. Favor de confirmar mi pedido.${orderNumber ? `\nNúmero de orden: ${orderNumber}` : ''}`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank');
  }

  return (
    <main>
      <section className="section payment-result">
        <div className="panel narrow">
          <p className="eyebrow">{isSuccess ? 'Pago recibido' : 'Pago cancelado'}</p>
          <h1>{isSuccess ? 'Pago recibido. Tu pedido está en proceso de confirmación.' : 'Pago cancelado. Puedes intentar de nuevo o mandar tu pedido por WhatsApp.'}</h1>
          {orderNumber && <p className="success">Orden: {orderNumber}</p>}
          <div className="payment-result__actions">
            {isSuccess && <button onClick={sendPaymentWhatsApp}>Enviar detalles por WhatsApp</button>}
            <a className="button--ghost" href={isSuccess ? '/' : '/#pedido'}>{isSuccess ? 'Volver al inicio' : 'Volver al pedido'}</a>
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountSection({ profile, setProfile }) {
  return (
    <section id="club-el-punto" className="section account-grid scroll-target">
      <div className="panel">
        <div className="section__heading compact">
          <p className="eyebrow">Cliente</p>
          <h2>Club El Punto</h2>
          <p>Esta primera versión guarda los datos en el navegador para hacer pedidos más rápido.</p>
        </div>
        <div className="form-grid one">
          <label>
            Nombre
            <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
          </label>
          <label>
            Teléfono
            <input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={profile.isMember} onChange={(event) => setProfile({ ...profile, isMember: event.target.checked })} />
            Quiero recibir beneficios de cliente frecuente
          </label>
        </div>
      </div>
      <div className="benefits-card">
        <p className="eyebrow">Club El Punto</p>
        <h2>Club El Punto</h2>
        <ul>
          <li>Promos para clientes frecuentes.</li>
          <li>Pedidos más rápidos con tus datos guardados.</li>
          <li>Espacio listo para cupones, puntos o recompensas.</li>
        </ul>
        <p className="small-note">Pendiente para backend: guardar cuentas reales, historial de pedidos y beneficios por cliente.</p>
      </div>
    </section>
  );
}

function AdminSection({ menu, setMenu, business, setBusiness, productImages, refreshProductImages, productImagesError, dataSource, setDataSource }) {
  const [pin, setPin] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [metrics, setMetrics] = useState(() => readStorage(STORAGE.metrics, defaultMetrics()));
  const [newProduct, setNewProduct] = useState({ categoryId: menu[0]?.id || 'desayunos', categoryName: '', name: '', price: '', description: '', ingredients: '' });
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameDrafts, setRenameDrafts] = useState({});
  const [moveDrafts, setMoveDrafts] = useState({});
  const adminCategories = categoryOptions(menu);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState(JSON.stringify(menu, null, 2));
  const [adminStatus, setAdminStatus] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersStatus, setOrdersStatus] = useState('');

  useEffect(() => {
    const refresh = () => setMetrics(readStorage(STORAGE.metrics, defaultMetrics()));
    window.addEventListener('elpunto:metrics', refresh);
    return () => window.removeEventListener('elpunto:metrics', refresh);
  }, []);

  function login() {
    if (isSupabaseConfigured) {
      if (!pin.trim()) return alert('Escribe el ADMIN_PIN configurado en Netlify.');
      setUnlocked(true);
      return;
    }
    setUnlocked(pin === ADMIN_PIN);
    if (pin !== ADMIN_PIN) alert('PIN incorrecto. En modo local el PIN demo es 1234.');
  }

  async function loadOrders() {
    if (!isSupabaseConfigured) return;
    try {
      const result = await adminRequest('admin-orders', { method: 'GET', pin });
      setOrders(result.orders || []);
      setOrdersStatus('Órdenes sincronizadas.');
    } catch (error) {
      setOrdersStatus(error.message);
    }
  }

  async function reloadAdminMenu() {
    if (!isSupabaseConfigured) return;
    try {
      setDataSource('supabase-loading');
      setAdminStatus('Cargando productos reales desde Supabase...');
      localStorage.removeItem(STORAGE.menu);
      setMenu([]);
      const snapshot = await adminRequest('admin-products', { method: 'GET', pin });
      const nextMenu = menuFromAdminSnapshot(snapshot);
      setMenu(nextMenu);
      setDataSource('supabase-admin');
      console.info('Admin products source:', 'supabase', { categories: snapshot.categories?.length || 0, products: snapshot.products?.length || 0 });
      setAdminStatus('Menú sincronizado con Supabase. Fuente: Supabase.');
      await refreshProductImages();
      return snapshot;
    } catch (error) {
      setDataSource('supabase-error');
      console.warn('Admin products source:', 'supabase_error', error.message);
      setAdminStatus(error.message);
    }
  }

  useEffect(() => {
    if (unlocked && isSupabaseConfigured) {
      reloadAdminMenu();
      loadOrders();
    }
  }, [unlocked]);

  async function persistProduct(category, product, method = 'PATCH') {
    if (!isSupabaseConfigured) return null;
    try {
      const snapshot = await adminRequest('admin-products', { method, pin, body: { product, category } });
      setMenu(menuFromAdminSnapshot(snapshot));
      setDataSource('supabase-admin');
      setAdminStatus('Cambio guardado en Supabase.');
      await refreshProductImages();
      return snapshot;
    } catch (error) {
      setAdminStatus(error.message);
      throw error;
    }
  }

  async function persistCategory(category, method = 'POST') {
    if (!isSupabaseConfigured) return;
    try {
      const snapshot = await adminRequest('admin-categories', { method, pin, body: { category, id: category.supabaseCategoryId, slug: category.id, name: category.name, sortOrder: category.sortOrder } });
      if (snapshot.categories) setMenu(menuFromAdminSnapshot(snapshot));
      setAdminStatus('Categoría guardada en Supabase.');
    } catch (error) {
      setAdminStatus(error.message);
    }
  }

  async function persistSettings(nextBusiness) {
    if (!isSupabaseConfigured) return;
    try {
      const result = await adminRequest('admin-settings', { method: 'PATCH', pin, body: { settings: nextBusiness } });
      if (result.settings) setBusiness((current) => ({ ...current, ...mapBusinessSettings(result.settings) }));
      setAdminStatus('Configuración guardada en Supabase.');
    } catch (error) {
      setAdminStatus(error.message);
    }
  }

  async function migrateLocalMenu() {
    if (!isSupabaseConfigured) return alert('Configura Supabase antes de migrar.');
    if (!confirm('¿Migrar menú local a Supabase evitando duplicados por nombre/categoría?')) return;
    try {
      const snapshot = await adminRequest('admin-products', { method: 'POST', pin, body: { action: 'migrate', menu } });
      setMenu(menuFromAdminSnapshot(snapshot));
      setDataSource('supabase-admin');
      setAdminStatus('Menú migrado a Supabase correctamente.');
    } catch (error) {
      setAdminStatus(error.message);
    }
  }

  function updateItem(categoryId, itemId, patch) {
    const category = menu.find((item) => item.id === categoryId);
    const existing = category?.items.find((item) => item.id === itemId);
    const updated = existing ? { ...existing, ...patch } : null;
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
    }));
    if (category && updated) persistProduct(category, updated);
  }

  function deleteItem(categoryId, itemId) {
    const category = menu.find((item) => item.id === categoryId);
    const product = category?.items.find((item) => item.id === itemId);
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.filter((item) => item.id !== itemId)
    }));
    if (isSupabaseConfigured && isSupabaseBackedProduct(product)) {
      adminRequest('admin-products', { method: 'DELETE', pin, body: { id: productImageKey(product) } })
        .then((snapshot) => setMenu(menuFromAdminSnapshot(snapshot)))
        .catch((error) => setAdminStatus(error.message));
    }
  }

  function addCategoryByName(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return '';
    const id = slugify(cleanName);
    const category = { ...createCategory(cleanName), sortOrder: menu.length };
    setMenu((current) => categoryExists(current, cleanName) ? current : [...current, category]);
    persistCategory(category);
    return id;
  }

  function renameCategory(categoryId, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return alert('Escribe un nombre de categoría.');
    const existing = menu.find((category) => category.id === categoryId);
    const renamed = existing ? { ...existing, id: slugify(cleanName), name: cleanName, description: existing.description || categoryDescription(cleanName) } : null;
    setMenu((current) => current.map((category) => category.id === categoryId ? {
      ...category,
      id: slugify(cleanName),
      name: cleanName,
      description: category.description || categoryDescription(cleanName)
    } : category));
    if (renamed) persistCategory(renamed, 'PATCH');
  }


  async function moveCategory(categoryId, direction) {
    const ordered = categoryOptions(menu);
    const currentIndex = ordered.findIndex((category) => category.id === categoryId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const reordered = [...ordered];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    const withSortOrder = reordered.map((category, index) => ({ ...category, sortOrder: index }));
    setMenu((current) => normalizeMenu(withSortOrder.map((orderedCategory) => {
      const existing = current.find((category) => category.id === orderedCategory.id || category.supabaseCategoryId === orderedCategory.supabaseCategoryId);
      return existing ? { ...existing, sortOrder: orderedCategory.sortOrder } : orderedCategory;
    })));
    if (!isSupabaseConfigured) return;
    try {
      const snapshot = await adminRequest('admin-categories', {
        method: 'PATCH',
        pin,
        body: {
          action: 'reorder',
          categories: withSortOrder.map((category) => ({ id: category.supabaseCategoryId, slug: category.id, sortOrder: category.sortOrder }))
        }
      });
      setMenu(menuFromAdminSnapshot(snapshot));
      setAdminStatus('Orden de categorías actualizado.');
    } catch (error) {
      setAdminStatus(error.message);
      reloadAdminMenu();
    }
  }

  function deleteCategory(categoryId) {
    const category = menu.find((item) => item.id === categoryId);
    if (!category || category.items.length > 0) return alert('Solo puedes eliminar categorías sin productos asignados.');
    setMenu((current) => current.filter((item) => item.id !== categoryId));
    if (isSupabaseConfigured) adminRequest('admin-categories', { method: 'DELETE', pin, body: { id: category.supabaseCategoryId, slug: category.id } }).catch((error) => setAdminStatus(error.message));
  }

  function moveItemToCategoryName(sourceCategoryId, itemId, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const targetId = slugify(cleanName);
    const sourceCategoryNow = menu.find((category) => category.id === sourceCategoryId);
    const itemToPersist = sourceCategoryNow?.items.find((item) => item.id === itemId);
    const targetCategoryNow = menu.find((category) => category.id === targetId || slugify(category.name) === targetId) || { ...createCategory(cleanName), sortOrder: menu.length };
    setMenu((current) => {
      const withCategory = categoryExists(current, cleanName) ? current : [...current, { ...createCategory(cleanName), sortOrder: current.length }];
      const sourceCategory = withCategory.find((category) => category.id === sourceCategoryId);
      const itemToMove = sourceCategory?.items.find((item) => item.id === itemId);
      if (!itemToMove) return withCategory;
      return withCategory.map((category) => {
        if (category.id === sourceCategoryId) return { ...category, items: category.items.filter((item) => item.id !== itemId) };
        if (category.id === targetId || slugify(category.name) === targetId) return { ...category, items: [...category.items, itemToMove] };
        return category;
      });
    });
    if (itemToPersist) persistProduct(targetCategoryNow, itemToPersist);
  }

  function moveItem(sourceCategoryId, itemId, targetCategoryId) {
    if (sourceCategoryId === targetCategoryId) return;
    const targetOption = adminCategories.find((category) => category.id === targetCategoryId);
    const sourceCategoryNow = menu.find((category) => category.id === sourceCategoryId);
    const itemToPersist = sourceCategoryNow?.items.find((item) => item.id === itemId);
    const targetCategoryNow = menu.find((category) => category.id === targetCategoryId) || { ...createCategory(targetOption?.name || targetCategoryId), sortOrder: menu.length };
    setMenu((current) => {
      const withCategory = current.some((category) => category.id === targetCategoryId)
        ? current
        : [...current, { ...createCategory(targetOption?.name || targetCategoryId), sortOrder: current.length }];
      const sourceCategory = withCategory.find((category) => category.id === sourceCategoryId);
      const itemToMove = sourceCategory?.items.find((item) => item.id === itemId);
      if (!itemToMove) return withCategory;
      return withCategory.map((category) => {
        if (category.id === sourceCategoryId) {
          return { ...category, items: category.items.filter((item) => item.id !== itemId) };
        }
        if (category.id === targetCategoryId) {
          return { ...category, items: [...category.items, itemToMove] };
        }
        return category;
      });
    });
    if (itemToPersist) persistProduct(targetCategoryNow, itemToPersist);
  }

  function updateIngredient(categoryId, itemId, ingredientIndex, patch) {
    const category = menu.find((item) => item.id === categoryId);
    const existing = category?.items.find((item) => item.id === itemId);
    const updated = existing ? {
      ...existing,
      ingredients: normalizeIngredients(existing.ingredients).map((ingredient, index) => index === ingredientIndex ? { ...ingredient, ...patch } : ingredient)
    } : null;
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.map((item) => item.id !== itemId ? item : {
        ...item,
        ingredients: normalizeIngredients(item.ingredients).map((ingredient, index) => index === ingredientIndex ? { ...ingredient, ...patch } : ingredient)
      })
    }));
    if (category && updated) persistProduct(category, updated);
  }

  function addIngredient(categoryId, itemId) {
    const category = menu.find((item) => item.id === categoryId);
    const existing = category?.items.find((item) => item.id === itemId);
    const updated = existing ? { ...existing, ingredients: [...normalizeIngredients(existing.ingredients), { name: '', removable: true }] } : null;
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.map((item) => item.id !== itemId ? item : {
        ...item,
        ingredients: [...normalizeIngredients(item.ingredients), { name: '', removable: true }]
      })
    }));
    if (category && updated) persistProduct(category, updated);
  }

  function deleteIngredient(categoryId, itemId, ingredientIndex) {
    const category = menu.find((item) => item.id === categoryId);
    const existing = category?.items.find((item) => item.id === itemId);
    const updated = existing ? { ...existing, ingredients: normalizeIngredients(existing.ingredients).filter((_, index) => index !== ingredientIndex) } : null;
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.map((item) => item.id !== itemId ? item : {
        ...item,
        ingredients: normalizeIngredients(item.ingredients).filter((_, index) => index !== ingredientIndex)
      })
    }));
    if (category && updated) persistProduct(category, updated);
  }

  function addProduct() {
    if (!newProduct.name.trim()) return alert('Agrega nombre del producto.');
    const product = {
      id: slugify(newProduct.name),
      isSupabaseProduct: false,
      name: newProduct.name.trim(),
      cost: null,
      price: parseOptionalNumber(newProduct.price),
      discountPrice: null,
      discountActive: false,
      description: newProduct.description.trim(),
      ingredients: splitCsv(newProduct.ingredients).map((name) => ({ name, removable: true })),
      images: [],
      options: {},
      available: true
    };
    const targetName = newProduct.categoryName.trim();
    const selectedCategory = adminCategories.find((category) => category.id === newProduct.categoryId);
    const targetId = targetName ? slugify(targetName) : newProduct.categoryId;
    const targetCategory = menu.find((category) => category.id === targetId) || { ...createCategory(targetName || selectedCategory?.name || targetId), sortOrder: menu.length };
    setMenu((current) => {
      const needsCategory = !current.some((category) => category.id === targetId);
      const withCategory = needsCategory ? [...current, targetCategory] : current;
      return withCategory.map((category) => category.id !== targetId ? category : {
        ...category,
        items: [...category.items, product]
      });
    });
    persistProduct(targetCategory, product, 'POST');
    setNewProduct({ ...newProduct, categoryName: '', name: '', price: '', description: '', ingredients: '' });
  }

  function resetMenu() {
    if (!confirm('¿Seguro que quieres regresar al menú inicial?')) return;
    setMenu(normalizeMenu(initialMenu));
    setJsonDraft(JSON.stringify(normalizeMenu(initialMenu), null, 2));
  }

  function saveJsonMenu() {
    try {
      const parsed = JSON.parse(jsonDraft);
      setMenu(normalizeMenu(parsed));
      setJsonMode(false);
    } catch {
      alert('El JSON tiene un error. Revísalo antes de guardar.');
    }
  }

  if (!unlocked) {
    return (
      <section id="admin" className="section admin-login">
        <div className="panel narrow">
          <p className="eyebrow">Admin</p>
          <h2>Panel interno</h2>
          <p>Demo local para editar menú, disponibilidad, precios y WhatsApp.</p>
          <label>
            PIN
            <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="1234" />
          </label>
          <button onClick={login}>Entrar</button>
          <div className="admin-update-summary">
            <strong>Resumen de actualización</strong>
            <ul>
              <li>Productos cargan cost, ingredient_cost, packaging_cost y discount_price desde Supabase.</li>
              <li>El campo Costo usa product.cost; 0 o null se muestran vacío.</li>
              <li>El menú público usa precio efectivo: descuento activo válido menor que precio normal; si no, precio normal.</li>
              <li>Cada producto se edita con estado aislado y se guarda con botón Guardar producto.</li>
              <li>Ingredientes se agregan con input enfocado, Enter y persistencia al guardar.</li>
              <li>Descuento activo se guarda explícitamente como discount_active boolean y se recarga desde Supabase.</li>
              <li>Subida de imágenes devuelve JSON claro, valida bucket/env vars y muestra errores legibles.</li>
              <li>Teléfono/WhatsApp del negocio: 614 608 7217 / 526146087217.</li>
            </ul>
          </div>
          <p className="small-note">Ojo: este PIN no es seguridad real. Para producción hay que conectar Supabase, Firebase o un backend.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="admin" className="section admin-grid">
      <div className="panel">
        <div className="section__heading compact">
          <p className="eyebrow">Admin</p>
          <h2>Config del negocio</h2>
        </div>
        <div className="form-grid one">
          <label>
            Nombre
            <input value={business.name} onChange={(event) => setBusiness({ ...business, name: event.target.value })} />
          </label>
          <label>
            Subtítulo
            <input value={business.subtitle} onChange={(event) => setBusiness({ ...business, subtitle: event.target.value })} />
          </label>
          <label>
            WhatsApp con lada país
            <input value={business.whatsapp} onChange={(event) => setBusiness({ ...business, whatsapp: event.target.value })} placeholder="52614..." />
          </label>
          <label>
            Ubicación base
            <input value={business.address} onChange={(event) => setBusiness({ ...business, address: event.target.value })} />
          </label>
          <label>
            Link Google Maps
            <input value={business.googleMapsUrl || ''} onChange={(event) => setBusiness({ ...business, googleMapsUrl: event.target.value })} placeholder="https://maps.app.goo.gl/..." />
          </label>
          <label>
            Wallet BTC (opcional)
            <input value={business.cryptoBtcWallet || ''} onChange={(event) => setBusiness({ ...business, cryptoBtcWallet: event.target.value })} />
          </label>
          <label>
            Wallet ETH (opcional)
            <input value={business.cryptoEthWallet || ''} onChange={(event) => setBusiness({ ...business, cryptoEthWallet: event.target.value })} />
          </label>
          <label>
            Wallet USDT TRC20 (opcional)
            <input value={business.cryptoUsdtTrc20Wallet || ''} onChange={(event) => setBusiness({ ...business, cryptoUsdtTrc20Wallet: event.target.value })} />
          </label>
          <label>
            Nota cripto (opcional)
            <input value={business.cryptoNote || ''} onChange={(event) => setBusiness({ ...business, cryptoNote: event.target.value })} />
          </label>
          <button type="button" className="button--ghost" onClick={() => persistSettings(business)}>Guardar configuración en Supabase</button>
          <p className="small-note">Fuente actual: {dataSource}. {adminStatus}</p>
          {isSupabaseConfigured && dataSource !== 'supabase-admin' && <p className="small-note warning-note">Admin esperando datos reales de Supabase; no uses datos locales/cacheados para editar productos.</p>}
        </div>
      </div>

      <div className="panel metrics">
        <p className="eyebrow">Métricas</p>
        <div className="metric-grid">
          <Metric label="Visitas" value={metrics.visits} />
          <Metric label="Usuarios únicos" value={metrics.uniqueSessions} />
          <Metric label="Agregados al carrito" value={metrics.addToCart} />
          <Metric label="Pedidos enviados" value={metrics.orderRequests} />
        </div>
        <p className="small-note">Métricas locales del navegador. Para métricas reales usa Google Analytics, Plausible o backend.</p>
      </div>


      <div className="panel admin-full">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Órdenes</p>
            <h2>Órdenes recientes</h2>
          </div>
          <button type="button" className="button--ghost" onClick={loadOrders}>Actualizar órdenes</button>
        </div>
        <p className="small-note">{ordersStatus || 'Las órdenes se crean desde Stripe Checkout y se actualizan por webhook.'}</p>
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Estado pago</th>
                <th>Estado orden</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan="8">Sin órdenes todavía.</td></tr>
              ) : orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.order_number}</td>
                  <td>{order.customer_name || 'Cliente'}</td>
                  <td>{order.customer_phone || '—'}</td>
                  <td>{formatMoney(order.total)}</td>
                  <td>{paymentLabel(order.payment_method)}</td>
                  <td>{order.payment_status}</td>
                  <td>{order.order_status}</td>
                  <td>{order.created_at ? new Date(order.created_at).toLocaleString('es-MX') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel admin-full">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Categorías</p>
            <h2>Categorías del menú</h2>
          </div>
        </div>
        <div className="category-admin-list">
          {adminCategories.map((category, categoryIndex) => (
            <div key={category.id} className="category-admin-row">
              <div className="category-order-actions">
                <button type="button" className="button--ghost" onClick={() => moveCategory(category.id, -1)} disabled={categoryIndex === 0}>Subir</button>
                <button type="button" className="button--ghost" onClick={() => moveCategory(category.id, 1)} disabled={categoryIndex === adminCategories.length - 1}>Bajar</button>
              </div>
              <span>{category.name}</span>
              <small>{category.items?.length || 0} productos · orden {Number(category.sortOrder ?? categoryIndex) + 1}</small>
              <input
                placeholder="Renombrar categoría"
                value={renameDrafts[category.id] ?? category.name}
                onChange={(event) => setRenameDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
              />
              <button type="button" className="button--ghost" onClick={() => renameCategory(category.id, renameDrafts[category.id] ?? category.name)}>Renombrar</button>
              <button type="button" className="button--danger" onClick={() => deleteCategory(category.id)} disabled={(category.items?.length || 0) > 0}>Eliminar</button>
            </div>
          ))}
        </div>
        <div className="category-admin-add">
          <input placeholder="Nueva categoría (ej. Combos)" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} />
          <button type="button" onClick={() => { addCategoryByName(newCategoryName); setNewCategoryName(''); }}>Agregar categoría</button>
        </div>
      </div>

      <div className="panel admin-full">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Productos</p>
            <h2>Menú editable</h2>
          </div>
          <div className="admin-actions">
            <button className="button--ghost" onClick={reloadAdminMenu}>Recargar Supabase</button>
            <button className="button--ghost" onClick={migrateLocalMenu}>Migrar menú local a Supabase</button>
            <button className="button--ghost" onClick={() => { setJsonDraft(JSON.stringify(menu, null, 2)); setJsonMode(!jsonMode); }}>{jsonMode ? 'Vista normal' : 'Editar JSON'}</button>
            <button className="button--danger" onClick={resetMenu}>Reset menú</button>
          </div>
        </div>

        <p className="small-note">Fuente de productos en admin: {dataSource === 'supabase-admin' ? 'Supabase' : dataSource}. Usa Recargar Supabase para limpiar caché local y volver a leer la base.</p>

        {jsonMode ? (
          <div className="json-editor">
            <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
            <button onClick={saveJsonMenu}>Guardar JSON</button>
          </div>
        ) : (
          <>
            <div className="add-product">
              <select value={newProduct.categoryId} onChange={(event) => setNewProduct({ ...newProduct, categoryId: event.target.value, categoryName: '' })}>
                {adminCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <input placeholder="O nueva categoría" value={newProduct.categoryName} onChange={(event) => setNewProduct({ ...newProduct, categoryName: event.target.value })} list="category-options" />
              <datalist id="category-options">
                {adminCategories.map((category) => <option key={category.id} value={category.name} />)}
              </datalist>
              <input placeholder="Producto" value={newProduct.name} onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })} />
              <input placeholder="Precio" type="number" value={newProduct.price} onChange={(event) => setNewProduct({ ...newProduct, price: event.target.value })} />
              <input placeholder="Descripción" value={newProduct.description} onChange={(event) => setNewProduct({ ...newProduct, description: event.target.value })} />
              <input placeholder="Ingredientes separados por coma" value={newProduct.ingredients} onChange={(event) => setNewProduct({ ...newProduct, ingredients: event.target.value })} />
              <button onClick={addProduct}>Agregar</button>
            </div>

            {menu.map((category) => (
              <div key={category.id} className="admin-category">
                <h3>{category.name}</h3>
                {category.items.map((item) => (
                  <AdminProductEditor
                    key={productImageKey(item) || item.id}
                    item={item}
                    category={category}
                    adminCategories={adminCategories}
                    productImages={productImages}
                    adminPin={pin}
                    persistProduct={persistProduct}
                    deleteItem={deleteItem}
                    refreshProductImages={refreshProductImages}
                    productImagesError={productImagesError}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}



function AdminProductEditor({ item, category, adminCategories, productImages, adminPin, persistProduct, deleteItem, refreshProductImages, productImagesError }) {
  const [draft, setDraft] = useState(() => ({ ...item, categoryId: category.id, newIngredientName: '', newIngredientRemovable: true }));
  const [saveStatus, setSaveStatus] = useState('');
  const newIngredientRef = React.useRef(null);
  const itemKey = productImageKey(item) || item.id;

  useEffect(() => {
    setDraft((current) => current?.id === item.id
      ? { ...item, categoryId: current.categoryId || category.id, newIngredientName: current.newIngredientName || '', newIngredientRemovable: current.newIngredientRemovable ?? true }
      : { ...item, categoryId: category.id, newIngredientName: '', newIngredientRemovable: true });
  }, [item, category.id]);

  function patchDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveStatus('Cambios sin guardar');
  }

  function patchIngredient(index, patch) {
    setDraft((current) => ({
      ...current,
      ingredients: normalizeIngredients(current.ingredients).map((ingredient, ingredientIndex) => ingredientIndex === index ? { ...ingredient, ...patch } : ingredient)
    }));
    setSaveStatus('Cambios sin guardar');
  }

  function removeIngredient(index) {
    setDraft((current) => ({
      ...current,
      ingredients: normalizeIngredients(current.ingredients).filter((_, ingredientIndex) => ingredientIndex !== index)
    }));
    setSaveStatus('Cambios sin guardar');
  }

  function addDraftIngredient() {
    const name = String(draft.newIngredientName || '').trim();
    if (!name) return;
    setDraft((current) => ({
      ...current,
      ingredients: [...normalizeIngredients(current.ingredients), { name, removable: current.newIngredientRemovable !== false }],
      newIngredientName: ''
    }));
    setSaveStatus('Cambios sin guardar');
    window.setTimeout(() => newIngredientRef.current?.focus(), 0);
  }

  function openIngredientInput() {
    setDraft((current) => ({ ...current, newIngredientName: current.newIngredientName || '', newIngredientRemovable: current.newIngredientRemovable ?? true }));
    window.setTimeout(() => newIngredientRef.current?.focus(), 0);
  }

  async function saveProduct() {
    const targetCategory = adminCategories.find((categoryOption) => categoryOption.id === draft.categoryId) || category;
    const productToSave = {
      ...draft,
      discountActive: draft.discountActive === true,
      discount_active: draft.discountActive === true,
      discountPrice: parseOptionalNumber(draft.discountPrice),
      discount_price: parseOptionalNumber(draft.discountPrice),
      price: parseOptionalNumber(draft.price),
      cost: parseOptionalNumber(draft.cost),
      ingredients: normalizeIngredients(draft.ingredients)
    };
    console.log('Guardando descuento', productToSave.name, {
      price: productToSave.price,
      discount_price: productToSave.discount_price,
      discount_active: productToSave.discount_active
    });
    setSaveStatus('Guardando...');
    try {
      await persistProduct(targetCategory, productToSave, 'PATCH');
      setSaveStatus('Guardado');
    } catch (error) {
      setSaveStatus(error.message || 'Error al guardar producto.');
    }
  }

  return (
    <div className="admin-product-editor">
      <div className="admin-product-editor__grid">
        <label>
          Nombre
          <input value={draft.name || ''} onChange={(event) => patchDraft({ name: event.target.value })} />
        </label>
        <label>
          Costo
          <input type="number" step="0.01" value={adminNumberInputValue(draft.cost)} placeholder="Costo total interno" onChange={(event) => patchDraft({ cost: parseOptionalNumber(event.target.value) })} />
        </label>
        <label>
          Precio normal
          <input type="number" step="0.01" value={draft.price ?? ''} placeholder="Precio normal" onChange={(event) => patchDraft({ price: parseOptionalNumber(event.target.value) })} />
        </label>
        <label>
          Precio con descuento
          <input type="number" step="0.01" value={draft.discountPrice ?? ''} placeholder="Precio descuento" onChange={(event) => patchDraft({ discountPrice: parseOptionalNumber(event.target.value) })} />
        </label>
        <label className="checkbox-line admin-discount-toggle">
          <input type="checkbox" checked={isDiscountActive(draft)} onChange={(event) => patchDraft({ discountActive: event.target.checked, discount_active: event.target.checked })} />
          Descuento activo
        </label>
        <label>
          Categoría
          <select value={draft.categoryId || category.id} onChange={(event) => patchDraft({ categoryId: event.target.value })}>
            {adminCategories.map((categoryOption) => <option key={categoryOption.id} value={categoryOption.id}>{categoryOption.name}</option>)}
          </select>
        </label>
        <div className="admin-image-slot">
          <ProductImageManager
            item={draft}
            category={category}
            images={productImages[itemKey] || []}
            adminPin={adminPin}
            onSaveProduct={persistProduct}
            refreshProductImages={refreshProductImages}
            productImagesError={productImagesError}
          />
        </div>
      </div>

      <ProductProfitSummary item={draft} />

      <label>
        Descripción
        <textarea value={draft.description || ''} onChange={(event) => patchDraft({ description: event.target.value })} />
      </label>

      <div className="admin-ingredients">
        <div className="admin-subheader">
          <strong>Ingredientes</strong>
          <button type="button" className="button--ghost" onClick={openIngredientInput}>Agregar ingrediente</button>
        </div>
        {normalizeIngredients(draft.ingredients).length === 0 && <p className="small-note">Sin ingredientes capturados.</p>}
        {normalizeIngredients(draft.ingredients).map((ingredient, ingredientIndex) => (
          <div key={`${draft.id}-${ingredientIndex}-${ingredient.name}`} className="ingredient-editor">
            <label>
              Ingrediente
              <input value={ingredient.name} onChange={(event) => patchIngredient(ingredientIndex, { name: event.target.value })} placeholder="huevo" />
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={ingredient.removable} onChange={(event) => patchIngredient(ingredientIndex, { removable: event.target.checked })} />
              Cliente puede quitarlo
            </label>
            <button type="button" className="button--danger" onClick={() => removeIngredient(ingredientIndex)}>Eliminar</button>
          </div>
        ))}
        <div className="ingredient-editor ingredient-editor--new">
          <label>
            Nuevo ingrediente
            <input
              ref={newIngredientRef}
              value={draft.newIngredientName || ''}
              onChange={(event) => patchDraft({ newIngredientName: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addDraftIngredient();
                }
              }}
              placeholder="Escribe ingrediente y Enter"
            />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.newIngredientRemovable !== false} onChange={(event) => patchDraft({ newIngredientRemovable: event.target.checked })} />
            Cliente puede quitarlo
          </label>
          <button type="button" className="button--ghost" onClick={addDraftIngredient}>Agregar</button>
        </div>
      </div>

      <div className="admin-product-editor__actions">
        <button className={draft.available !== false ? 'status status--ok' : 'status status--off'} onClick={() => patchDraft({ available: draft.available === false })}>
          {draft.available !== false ? 'Disponible' : 'Agotado'}
        </button>
        <button type="button" onClick={saveProduct} disabled={saveStatus === 'Guardando...'}>{saveStatus === 'Guardando...' ? 'Guardando...' : 'Guardar producto'}</button>
        <button className="button--danger" onClick={() => deleteItem(category.id, item.id)}>Quitar producto</button>
        {saveStatus && <span className="small-note">{saveStatus}</span>}
      </div>
    </div>
  );
}

function ProductProfitSummary({ item }) {
  const metrics = productProfitMetrics(item);
  return (
    <div className="profit-summary">
      <div><span>Utilidad normal</span><strong>{metrics.normalProfit === null ? '—' : formatMoney(metrics.normalProfit)}</strong></div>
      <div><span>Margen normal</span><strong>{formatPercent(metrics.normalMargin)}</strong></div>
      <div><span>Utilidad con descuento</span><strong>{metrics.discountProfit === null ? '—' : formatMoney(metrics.discountProfit)}</strong></div>
      <div><span>Margen con descuento</span><strong>{formatPercent(metrics.discountMargin)}</strong></div>
    </div>
  );
}


async function parseFunctionResponse(response, fallbackMessage) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || fallbackMessage };
  }
}

function ProductImageManager({ item, category, images, adminPin, onSaveProduct, refreshProductImages, productImagesError }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const productId = productImageKey(item);
  const isSavedInSupabase = isSupabaseBackedProduct(item);
  const remainingSlots = Math.max(0, 5 - images.length);

  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, remainingSlots);
    if (!files.length) return;
    if (!isSupabaseConfigured) {
      setMessage('Configura Supabase para subir imágenes.');
      event.target.value = '';
      return;
    }
    if (!isSavedInSupabase || !productId) {
      setMessage('Primero guarda este producto en Supabase.');
      event.target.value = '';
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      for (const [fileIndex, file] of files.entries()) {
        const formData = new FormData();
        formData.append('adminPin', adminPin);
        formData.append('productId', productId);
        formData.append('category', category.id);
        formData.append('name', item.name || 'Producto');
        formData.append('description', item.description || '');
        formData.append('price', String(item.price || ''));
        formData.append('available', String(item.available !== false));
        formData.append('sortOrder', String(images.length + fileIndex));
        formData.append('image', file);

        const response = await fetch('/.netlify/functions/upload-product-image', {
          method: 'POST',
          body: formData
        });
        const result = await parseFunctionResponse(response, 'No se pudo subir la imagen.');
        if (!response.ok || result.ok === false) throw new Error(result.error || 'No se pudo subir la imagen.');
      }
      await refreshProductImages();
      setMessage('Imagen subida a Supabase.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function saveProductInSupabase() {
    if (!isSupabaseConfigured) {
      setMessage('Configura Supabase para subir imágenes.');
      return;
    }
    setUploading(true);
    setMessage('Guardando producto en Supabase...');
    try {
      await onSaveProduct(category, item, 'POST');
      setMessage('Producto guardado en Supabase. Ya puedes subir imágenes.');
    } catch (error) {
      setMessage(error.message || 'No se pudo guardar el producto en Supabase.');
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(image) {
    if (!confirm('¿Eliminar esta imagen del producto?')) return;
    setUploading(true);
    setMessage('');
    try {
      const response = await fetch('/.netlify/functions/upload-product-image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, id: image.id, storage_path: image.storage_path })
      });
      const result = await parseFunctionResponse(response, 'No se pudo eliminar la imagen.');
      if (!response.ok || result.ok === false) throw new Error(result.error || 'No se pudo eliminar la imagen.');
      await refreshProductImages();
      setMessage(result.warning || 'Imagen eliminada.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="product-image-manager">
      <div className="admin-subheader">
        <strong>Imágenes Supabase</strong>
        <span className="small-note">{images.length}/5</span>
      </div>
      {productImagesError && <p className="small-note warning-note">{productImagesError}</p>}
      {!isSupabaseConfigured && <p className="small-note warning-note">Configura Supabase para subir imágenes.</p>}
      {isSupabaseConfigured && !isSavedInSupabase && (
        <div className="supabase-save-notice">
          <p className="small-note warning-note">Este producto todavía no está guardado en Supabase.</p>
          <button type="button" className="button--ghost" onClick={saveProductInSupabase} disabled={uploading}>Guardar en Supabase</button>
        </div>
      )}
      <div className="admin-image-preview-list">
        {images.length === 0 && <div className="admin-image-empty">Sin imágenes en Supabase</div>}
        {images.map((image) => (
          <div key={image.id} className="admin-image-preview">
            <img src={image.image_url} alt={item.name} />
            <button type="button" className="button--danger" onClick={() => deleteImage(image)} disabled={uploading}>Eliminar</button>
          </div>
        ))}
      </div>
      <label className="file-picker">
        Subir imágenes (jpeg/png/webp, máx. 2 MB c/u)
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading || remainingSlots === 0 || !isSupabaseConfigured || !isSavedInSupabase} onChange={uploadFiles} />
      </label>
      {remainingSlots === 0 && <p className="small-note">Máximo 5 imágenes por producto.</p>}
      {uploading && <p className="small-note">Procesando imagen...</p>}
      {message && <p className="small-note">{message}</p>}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value || 0}</strong>
    </div>
  );
}


function FloatingCart({ cartCount, cartTotal, navigateTo }) {
  return (
    <button className="floating-cart" onClick={() => navigateTo('pedido')} aria-label="Abrir pedido">
      <span>🛒</span>
      <strong>{cartCount || 0}</strong>
      <small>{cartTotal ? formatMoney(cartTotal) : 'Sin total'}</small>
    </button>
  );
}

function Footer({ business }) {
  return (
    <footer>
      <strong>{business.name}</strong>
      <span>{business.subtitle}</span>
      <span>{business.address}</span>
      <a href={`https://wa.me/${businessWhatsappNumber(business)}?text=${encodeURIComponent(WHATSAPP_GREETING)}`}>Tel. {BUSINESS_PHONE_DISPLAY}</a>
    </footer>
  );
}

createRoot(document.getElementById('root')).render(<App />);

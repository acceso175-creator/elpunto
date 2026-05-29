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
  session: 'elpunto_session_v1'
};

const ADMIN_PIN = '1234';
const MAPS_LINK = 'https://maps.app.goo.gl/aR9oguMm12B9VBtB7';
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
  const response = await fetch(`/.netlify/functions/${functionName}`, {
    method,
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
  BASE_CATEGORY_NAMES.forEach((name) => {
    const category = menu.find((item) => slugify(item.name) === slugify(name) || item.id === slugify(name));
    byId.set(slugify(name), category || createCategory(name));
  });
  menu.forEach((category) => byId.set(category.id || slugify(category.name), category));
  return [...byId.values()];
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
  return menu.map((category) => ({
    ...category,
    id: category.id || slugify(category.name),
    name: category.name || 'Categoría',
    description: category.description || categoryDescription(category.name),
    items: (category.items || []).map((item) => ({
      ...item,
      supabaseProductId: isUuid(item.supabaseProductId) ? item.supabaseProductId : (isUuid(item.id) ? item.id : createStableUuid()),
      images: Array.isArray(item.images) ? item.images.filter((image) => typeof image === 'string' && !image.startsWith('data:')) : [],
      ingredients: normalizeIngredients(item.ingredients)
    }))
  }));
}

function removableIngredientNames(ingredients) {
  return normalizeIngredients(ingredients)
    .filter((ingredient) => ingredient.removable)
    .map((ingredient) => ingredient.name);
}

function usePersistedState(key, fallback, normalize = identity) {
  const [state, setState] = useState(() => normalize(readStorage(key, fallback)));
  useEffect(() => writeStorage(key, normalize(state)), [key, normalize, state]);
  return [state, setState];
}

function formatMoney(value) {
  if (!value) return 'Precio por confirmar';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
}

function paymentLabel(value) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label || 'Efectivo';
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
  return (Number(item.price) || 0) + (proteinExtra ? 25 : 0);
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
  const isAdminPath = window.location.pathname === '/admin';
  const [activeSection, setActiveSection] = useState(isAdminPath ? 'admin' : 'inicio');
  const [productImages, setProductImages] = useState({});
  const [productImagesError, setProductImagesError] = useState('');
  const [dataSource, setDataSource] = useState(isSupabaseConfigured ? 'loading' : 'local');

  useEffect(() => {
    ensureSessionMetric();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSupabaseMenu() {
      if (!isSupabaseConfigured) return;
      const result = await getMenuData();
      if (cancelled) return;
      if (result.source === 'supabase') {
        setMenu(normalizeMenu(result.menu));
        setBusiness((current) => ({ ...current, ...result.business }));
        const grouped = {};
        result.menu.forEach((category) => {
          category.items.forEach((item) => {
            if (item.images?.length) grouped[item.supabaseProductId || item.id] = item.images;
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
  const supabaseProductIds = useMemo(() => menu.flatMap((category) => category.items.map((item) => item.supabaseProductId || item.id).filter(Boolean)), [menu]);

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
      <Header navigateTo={navigateTo} />
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


function Header({ navigateTo }) {
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
      <button className="site-header__cta" onClick={() => navigateTo('menu')}>Hacer pedido</button>
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
              <ProductCard key={item.id} item={item} categoryId={category.id} addToCart={addToCart} images={productImages[item.supabaseProductId || item.id] || []} />
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
  const [selectedOptions, setSelectedOptions] = useState(() => {
    const options = {};
    (item.options || []).forEach((option) => {
      options[option.name] = option.values?.[0] || '';
    });
    return options;
  });

  useEffect(() => {
    if (imageIndex >= imageUrls.length) setImageIndex(0);
  }, [imageIndex, imageUrls.length]);

  function toggleIngredient(ingredient) {
    setRemoved((current) => current.includes(ingredient)
      ? current.filter((value) => value !== ingredient)
      : [...current, ingredient]
    );
  }

  function handleAdd() {
    addToCart({
      id: item.id,
      categoryId,
      name: item.name,
      price: item.price,
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
      <strong className="price">{item.price ? formatMoney(item.price) : (item.priceLabel || 'Precio por confirmar')}</strong>

      {(item.options || []).length > 0 && (
        <div className="modifiers">
          {item.options.map((option) => (
            <label key={option.name}>
              {option.name}
              <select
                value={selectedOptions[option.name] || ''}
                onChange={(event) => setSelectedOptions((current) => ({ ...current, [option.name]: event.target.value }))}
              >
                {option.values.map((value) => <option key={value} value={value}>{value}</option>)}
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
  const selectedPaymentLabel = paymentLabel(payment);
  const isOnlinePaymentReady = Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) && cartTotal > 0;
  const cryptoWallets = cryptoWalletsFromBusiness(business);

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

  function buildMessage() {
    const orderNumber = createOrderNumber();
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
      ? '\nPago en línea seleccionado. Pendiente de confirmación.'
      : payment === 'criptomonedas'
        ? '\nPago con criptomonedas seleccionado. Solicito datos de pago.'
        : '';

    return `Hola, quiero hacer un pedido en El Punto.\n\nOrden: ${orderNumber}\nNombre: ${profile.name || 'Cliente'}\nTeléfono: ${profile.phone || 'No capturado'}\nMétodo de pago: ${selectedPaymentLabel}${paymentNote}\n${orderType === 'domicilio' ? 'Tipo: A domicilio' : 'Tipo: Para recoger'}${locationText}\n\nPedido:\n${items}\n\nTotal estimado: ${totalText}\nNotas: ${notes || 'Sin notas'}\n\nPor favor confírmenme disponibilidad y tiempo estimado.`;
  }

  function sendWhatsApp() {
    if (!cart.length) return;
    if (orderType === 'domicilio' && !address && !geoLink) {
      alert('Para domicilio agrega dirección o ubicación antes de mandar el pedido.');
      return;
    }
    const number = String(business.whatsapp || '').replace(/[^0-9]/g, '');
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
            {!isOnlinePaymentReady && (
              <p className="small-note">Pago en línea todavía no está configurado o el pedido requiere confirmar precio por WhatsApp.</p>
            )}
            <button className="button--ghost" disabled={!isOnlinePaymentReady}>Pagar con tarjeta</button>
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

  async function reloadAdminMenu() {
    if (!isSupabaseConfigured) return;
    try {
      const snapshot = await adminRequest('admin-products', { method: 'GET', pin });
      setMenu(menuFromAdminSnapshot(snapshot));
      setDataSource('supabase-admin');
      setAdminStatus('Menú sincronizado con Supabase.');
      await refreshProductImages();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }

  useEffect(() => {
    if (unlocked && isSupabaseConfigured) reloadAdminMenu();
  }, [unlocked]);

  async function persistProduct(category, product, method = 'PATCH') {
    if (!isSupabaseConfigured) return;
    try {
      const snapshot = await adminRequest('admin-products', { method, pin, body: { product, category } });
      setMenu(menuFromAdminSnapshot(snapshot));
      setDataSource('supabase-admin');
      setAdminStatus('Cambio guardado en Supabase.');
      await refreshProductImages();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }

  async function persistCategory(category, method = 'POST') {
    if (!isSupabaseConfigured) return;
    try {
      const snapshot = await adminRequest('admin-categories', { method, pin, body: { category, id: category.supabaseCategoryId, slug: category.id, name: category.name } });
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
    if (!confirm('¿Migrar productos locales a Supabase evitando duplicados por nombre/categoría?')) return;
    try {
      const snapshot = await adminRequest('admin-products', { method: 'POST', pin, body: { action: 'migrate', menu } });
      setMenu(menuFromAdminSnapshot(snapshot));
      setDataSource('supabase-admin');
      setAdminStatus(`Migración completada: ${snapshot.count || 0} productos procesados.`);
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
    if (isSupabaseConfigured && product) {
      adminRequest('admin-products', { method: 'DELETE', pin, body: { id: product.supabaseProductId || product.id } })
        .then((snapshot) => setMenu(menuFromAdminSnapshot(snapshot)))
        .catch((error) => setAdminStatus(error.message));
    }
  }

  function addCategoryByName(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return '';
    const id = slugify(cleanName);
    const category = createCategory(cleanName);
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
    const targetCategoryNow = menu.find((category) => category.id === targetId || slugify(category.name) === targetId) || createCategory(cleanName);
    setMenu((current) => {
      const withCategory = categoryExists(current, cleanName) ? current : [...current, createCategory(cleanName)];
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
    const targetCategoryNow = menu.find((category) => category.id === targetCategoryId) || createCategory(targetOption?.name || targetCategoryId);
    setMenu((current) => {
      const withCategory = current.some((category) => category.id === targetCategoryId)
        ? current
        : [...current, createCategory(targetOption?.name || targetCategoryId)];
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
      supabaseProductId: createStableUuid(),
      name: newProduct.name.trim(),
      price: Number(newProduct.price) || 0,
      description: newProduct.description.trim(),
      ingredients: splitCsv(newProduct.ingredients).map((name) => ({ name, removable: true })),
      images: [],
      options: [],
      available: true
    };
    const targetName = newProduct.categoryName.trim();
    const selectedCategory = adminCategories.find((category) => category.id === newProduct.categoryId);
    const targetId = targetName ? slugify(targetName) : newProduct.categoryId;
    const targetCategory = menu.find((category) => category.id === targetId) || createCategory(targetName || selectedCategory?.name || targetId);
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
            <p className="eyebrow">Categorías</p>
            <h2>Categorías del menú</h2>
          </div>
        </div>
        <div className="category-admin-list">
          {adminCategories.map((category) => (
            <div key={category.id} className="category-admin-row">
              <span>{category.name}</span>
              <small>{category.items?.length || 0} productos</small>
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
            <button className="button--ghost" onClick={migrateLocalMenu}>Migrar productos locales a Supabase</button>
            <button className="button--ghost" onClick={() => { setJsonDraft(JSON.stringify(menu, null, 2)); setJsonMode(!jsonMode); }}>{jsonMode ? 'Vista normal' : 'Editar JSON'}</button>
            <button className="button--danger" onClick={resetMenu}>Reset menú</button>
          </div>
        </div>

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
                  <div key={item.id} className="admin-product-editor">
                    <div className="admin-product-editor__grid">
                      <label>
                        Nombre
                        <input value={item.name} onChange={(event) => updateItem(category.id, item.id, { name: event.target.value })} />
                      </label>
                      <label>
                        Precio
                        <input type="number" value={item.price || ''} placeholder="Precio" onChange={(event) => updateItem(category.id, item.id, { price: Number(event.target.value) || 0 })} />
                      </label>
                      <label>
                        Categoría
                        <select value={category.id} onChange={(event) => moveItem(category.id, item.id, event.target.value)}>
                          {adminCategories.map((categoryOption) => <option key={categoryOption.id} value={categoryOption.id}>{categoryOption.name}</option>)}
                        </select>
                      </label>
                      <label>
                        Nueva categoría
                        <div className="category-move-inline">
                          <input
                            value={moveDrafts[item.id] || ''}
                            onChange={(event) => setMoveDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Ej. Combos"
                            list="category-options"
                          />
                          <button type="button" className="button--ghost" onClick={() => { moveItemToCategoryName(category.id, item.id, moveDrafts[item.id]); setMoveDrafts((current) => ({ ...current, [item.id]: '' })); }}>Mover</button>
                        </div>
                      </label>
                      <div className="admin-image-slot">
                        <ProductImageManager
                          item={item}
                          categoryId={category.id}
                          images={productImages[item.supabaseProductId || item.id] || []}
                          adminPin={pin}
                          refreshProductImages={refreshProductImages}
                          productImagesError={productImagesError}
                        />
                      </div>
                    </div>

                    <label>
                      Descripción
                      <textarea value={item.description || ''} onChange={(event) => updateItem(category.id, item.id, { description: event.target.value })} />
                    </label>

                    <div className="admin-ingredients">
                      <div className="admin-subheader">
                        <strong>Ingredientes</strong>
                        <button type="button" className="button--ghost" onClick={() => addIngredient(category.id, item.id)}>Agregar ingrediente</button>
                      </div>
                      {normalizeIngredients(item.ingredients).length === 0 && <p className="small-note">Sin ingredientes capturados.</p>}
                      {normalizeIngredients(item.ingredients).map((ingredient, ingredientIndex) => (
                        <div key={`${item.id}-${ingredientIndex}`} className="ingredient-editor">
                          <label>
                            Ingrediente
                            <input value={ingredient.name} onChange={(event) => updateIngredient(category.id, item.id, ingredientIndex, { name: event.target.value })} placeholder="huevo" />
                          </label>
                          <label className="checkbox-line">
                            <input type="checkbox" checked={ingredient.removable} onChange={(event) => updateIngredient(category.id, item.id, ingredientIndex, { removable: event.target.checked })} />
                            Cliente puede quitarlo
                          </label>
                          <button type="button" className="button--danger" onClick={() => deleteIngredient(category.id, item.id, ingredientIndex)}>Eliminar</button>
                        </div>
                      ))}
                    </div>

                    <div className="admin-product-editor__actions">
                      <button className={item.available ? 'status status--ok' : 'status status--off'} onClick={() => updateItem(category.id, item.id, { available: !item.available })}>
                        {item.available ? 'Disponible' : 'Agotado'}
                      </button>
                      <button className="button--danger" onClick={() => deleteItem(category.id, item.id)}>Quitar producto</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}


function ProductImageManager({ item, categoryId, images, adminPin, refreshProductImages, productImagesError }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const productId = item.supabaseProductId || item.id;
  const remainingSlots = Math.max(0, 5 - images.length);

  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, remainingSlots);
    if (!files.length) return;
    if (!isSupabaseConfigured) {
      setMessage('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para usar imágenes en Supabase.');
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
        formData.append('category', categoryId);
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
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo subir la imagen.');
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo eliminar la imagen.');
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
      {!isSupabaseConfigured && <p className="small-note warning-note">Configura Supabase para cargar y mostrar imágenes reales.</p>}
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
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading || remainingSlots === 0} onChange={uploadFiles} />
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
    </footer>
  );
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { businessDefaults, initialMenu } from './menuData.js';
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

function usePersistedState(key, fallback) {
  const [state, setState] = useState(() => readStorage(key, fallback));
  useEffect(() => writeStorage(key, state), [key, state]);
  return [state, setState];
}

function formatMoney(value) {
  if (!value) return 'Precio por confirmar';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
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
  const [menu, setMenu] = usePersistedState(STORAGE.menu, initialMenu);
  const [business, setBusiness] = usePersistedState(STORAGE.business, businessDefaults);
  const [cart, setCart] = usePersistedState(STORAGE.cart, []);
  const [profile, setProfile] = usePersistedState(STORAGE.profile, { name: '', phone: '', isMember: false });
  const [activeSection, setActiveSection] = useState('menu');

  useEffect(() => {
    ensureSessionMetric();
  }, []);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + calculateLine(item) * item.quantity, 0), [cart]);

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

  return (
    <main>
      <Hero business={business} setActiveSection={setActiveSection} cartCount={cart.length} />
      <Navigation activeSection={activeSection} setActiveSection={setActiveSection} />

      {activeSection === 'menu' && (
        <MenuSection menu={menu} addToCart={addToCart} />
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

      {activeSection === 'admin' && (
        <AdminSection
          menu={menu}
          setMenu={setMenu}
          business={business}
          setBusiness={setBusiness}
        />
      )}

      <Footer business={business} />
    </main>
  );
}

function Hero({ business, setActiveSection, cartCount }) {
  return (
    <section className="hero">
      <div className="hero__content">
        <p className="eyebrow">Centro de Chihuahua · para llevar</p>
        <h1>{business.name}<span>.</span></h1>
        <p className="subtitle">{business.subtitle}</p>
        <p className="hero__copy">Desayunos, birria y bebidas listos para pedir por WhatsApp. Escoge recoger o domicilio, ajusta ingredientes y manda tu orden en un mensaje.</p>
        <div className="hero__actions">
          <button onClick={() => setActiveSection('menu')}>Ver menú</button>
          <button className="button--ghost" onClick={() => setActiveSection('pedido')}>Mi pedido ({cartCount})</button>
        </div>
      </div>
      <div className="hero__card">
        <div className="pin">●</div>
        <h2>Pedido rápido</h2>
        <p>Recoger o domicilio</p>
        <p>Pago en efectivo, tarjeta o transferencia</p>
        <p>WhatsApp automático con número de orden</p>
      </div>
    </section>
  );
}

function Navigation({ activeSection, setActiveSection }) {
  const items = [
    ['menu', 'Menú'],
    ['pedido', 'Pedido'],
    ['cuenta', 'Cuenta / beneficios'],
    ['admin', 'Admin']
  ];

  return (
    <nav className="tabs">
      {items.map(([id, label]) => (
        <button key={id} className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

function MenuSection({ menu, addToCart }) {
  return (
    <section className="section">
      <div className="section__heading">
        <p className="eyebrow">Menú</p>
        <h2>Arma tu pedido</h2>
        <p>Todos los productos permiten quitar ingredientes y seleccionar cantidad. Los precios están listos para que los captures desde Admin.</p>
      </div>

      {menu.map((category) => (
        <div key={category.id} className="category">
          <div className="category__title">
            <h3>{category.name}</h3>
            <p>{category.description}</p>
          </div>
          <div className="grid">
            {category.items.map((item) => (
              <ProductCard key={item.id} item={item} categoryId={category.id} addToCart={addToCart} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ProductCard({ item, categoryId, addToCart }) {
  const [quantity, setQuantity] = useState(1);
  const [removed, setRemoved] = useState([]);
  const [selectedOptions, setSelectedOptions] = useState(() => {
    const options = {};
    (item.options || []).forEach((option) => {
      options[option.name] = option.values?.[0] || '';
    });
    return options;
  });

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
      <div className="product__top">
        <div>
          <h4>{item.name}</h4>
          <p>{item.description}</p>
        </div>
        {item.badge && <span className="badge">{item.badge}</span>}
      </div>
      <strong className="price">{formatMoney(item.price)}</strong>

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

      <div className="ingredients">
        <p>Quitar ingredientes:</p>
        <div>
          {(item.ingredients || []).map((ingredient) => (
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
      </div>

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
  const [payment, setPayment] = useState('Efectivo');
  const [address, setAddress] = useState('');
  const [geoLink, setGeoLink] = useState('');
  const [notes, setNotes] = useState('');
  const [isLocating, setIsLocating] = useState(false);

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
      const removed = item.removedIngredients?.length ? ` | Quitar: ${item.removedIngredients.join(', ')}` : '';
      const linePrice = calculateLine(item) * item.quantity;
      const priceText = linePrice ? ` | Subtotal: ${formatMoney(linePrice)}` : '';
      return `${index + 1}. ${item.quantity} x ${item.name}${opts ? ` (${opts})` : ''}${removed}${priceText}`;
    }).join('\n');

    const locationText = orderType === 'domicilio'
      ? `\nDirección: ${address || 'pendiente de confirmar'}${geoLink ? `\nUbicación Maps: ${geoLink}` : ''}`
      : '';

    const totalText = cartTotal ? formatMoney(cartTotal) : 'Por confirmar';

    return `Hola, quiero hacer un pedido en El Punto.\n\nOrden: ${orderNumber}\nNombre: ${profile.name || 'Cliente'}\nTeléfono: ${profile.phone || 'No capturado'}\nMétodo de pago: ${payment}\n${orderType === 'domicilio' ? 'Tipo: A domicilio' : 'Tipo: Para recoger'}${locationText}\n\nPedido:\n${items}\n\nTotal estimado: ${totalText}\nNotas: ${notes || 'Sin notas'}\n\nPor favor confírmenme disponibilidad y tiempo estimado.`;
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
    <section className="section order-layout">
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
              <option>Efectivo</option>
              <option>Tarjeta</option>
              <option>Transferencia</option>
            </select>
          </label>
        </div>

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
    <section className="section account-grid">
      <div className="panel">
        <div className="section__heading compact">
          <p className="eyebrow">Cliente</p>
          <h2>Cuenta rápida</h2>
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
        <p className="eyebrow">Beneficios</p>
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

function AdminSection({ menu, setMenu, business, setBusiness }) {
  const [pin, setPin] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [metrics, setMetrics] = useState(() => readStorage(STORAGE.metrics, defaultMetrics()));
  const [newProduct, setNewProduct] = useState({ categoryId: menu[0]?.id || 'desayunos', name: '', price: '', description: '', ingredients: '' });
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState(JSON.stringify(menu, null, 2));

  useEffect(() => {
    const refresh = () => setMetrics(readStorage(STORAGE.metrics, defaultMetrics()));
    window.addEventListener('elpunto:metrics', refresh);
    return () => window.removeEventListener('elpunto:metrics', refresh);
  }, []);

  function login() {
    setUnlocked(pin === ADMIN_PIN);
    if (pin !== ADMIN_PIN) alert('PIN incorrecto. En esta demo el PIN es 1234. Cámbialo cuando conectes backend.');
  }

  function updateItem(categoryId, itemId, patch) {
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
    }));
  }

  function deleteItem(categoryId, itemId) {
    setMenu((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      items: category.items.filter((item) => item.id !== itemId)
    }));
  }

  function addProduct() {
    if (!newProduct.name.trim()) return alert('Agrega nombre del producto.');
    const product = {
      id: slugify(newProduct.name),
      name: newProduct.name.trim(),
      price: Number(newProduct.price) || 0,
      description: newProduct.description.trim(),
      ingredients: newProduct.ingredients.split(',').map((value) => value.trim()).filter(Boolean),
      options: [],
      available: true
    };
    setMenu((current) => current.map((category) => category.id !== newProduct.categoryId ? category : {
      ...category,
      items: [...category.items, product]
    }));
    setNewProduct({ ...newProduct, name: '', price: '', description: '', ingredients: '' });
  }

  function resetMenu() {
    if (!confirm('¿Seguro que quieres regresar al menú inicial?')) return;
    setMenu(initialMenu);
    setJsonDraft(JSON.stringify(initialMenu, null, 2));
  }

  function saveJsonMenu() {
    try {
      const parsed = JSON.parse(jsonDraft);
      setMenu(parsed);
      setJsonMode(false);
    } catch {
      alert('El JSON tiene un error. Revísalo antes de guardar.');
    }
  }

  if (!unlocked) {
    return (
      <section className="section admin-login">
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
    <section className="section admin-grid">
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
            <p className="eyebrow">Productos</p>
            <h2>Menú editable</h2>
          </div>
          <div className="admin-actions">
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
              <select value={newProduct.categoryId} onChange={(event) => setNewProduct({ ...newProduct, categoryId: event.target.value })}>
                {menu.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
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
                  <div key={item.id} className="admin-product-row">
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                    </div>
                    <input type="number" value={item.price || ''} placeholder="Precio" onChange={(event) => updateItem(category.id, item.id, { price: Number(event.target.value) || 0 })} />
                    <button className={item.available ? 'status status--ok' : 'status status--off'} onClick={() => updateItem(category.id, item.id, { available: !item.available })}>
                      {item.available ? 'Disponible' : 'Agotado'}
                    </button>
                    <button className="button--danger" onClick={() => deleteItem(category.id, item.id)}>Quitar</button>
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

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value || 0}</strong>
    </div>
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

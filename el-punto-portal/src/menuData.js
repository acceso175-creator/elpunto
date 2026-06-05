export const businessDefaults = {
  name: 'El Punto',
  subtitle: 'Food To Go',
  whatsapp: '526146087217',
  googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Calle%20Ojinaga%20410%2C%20Col.%20Centro%2C%20Chihuahua%2C%20Chih.%2C%20M%C3%A9xico',
  socialLinks: {
    facebook: 'https://www.facebook.com/profile.php?id=61590350441792#',
    instagram: 'https://www.instagram.com/elpuntofoodto/'
  },
  address: 'Calle Ojinaga 410, Col. Centro, Chihuahua, Chih.',
  cryptoBtcWallet: '',
  cryptoEthWallet: '',
  cryptoUsdtTrc20Wallet: '',
  cryptoNote: '',
  cryptoWallets: [],
  hours: 'Lunes a domingo · horario por definir',
  deliveryNote: 'Servicio para recoger o a domicilio. Confirma disponibilidad por WhatsApp.'
};

export const initialMenu = [
  {
    id: 'desayunos',
    name: 'Desayunos',
    description: 'Clásicos para arrancar el día.',
    items: [
      {
        id: 'huevos-al-gusto',
        name: 'Huevos al gusto',
        price: 0,
        description: 'Huevo revuelto o estrellado con proteína, acompañado de papas hashbrown y frijoles.',
        ingredients: ['huevo', 'papas hashbrown', 'frijoles', 'proteína', 'salsa'],
        options: [
          { name: 'Preparación', values: ['Revuelto', 'Estrellado'] },
          { name: 'Proteína', values: ['Jamón', 'Tocino', 'Chorizo', 'Winnie'] }
        ],
        available: true,
        badge: 'Favorito'
      },
      {
        id: 'torta-huevo',
        name: 'Torta de huevo',
        price: 0,
        description: 'Torta de huevo con aguacate, proteína a elegir, costra de queso, tomate y lechuga.',
        ingredients: ['pan', 'huevo', 'aguacate', 'costra de queso', 'tomate', 'lechuga', 'proteína'],
        options: [
          { name: 'Proteína', values: ['Jamón', 'Tocino', 'Chorizo', 'Winnie'] }
        ],
        available: true
      },
      {
        id: 'avena-platano',
        name: 'Avena con plátano',
        price: 0,
        description: 'Avena con plátano acompañada de pan con mantequilla.',
        ingredients: ['avena', 'plátano', 'pan', 'mantequilla'],
        options: [],
        available: true
      }
    ]
  },
  {
    id: 'birria',
    name: 'Birria',
    description: 'Opciones con cebolla, cilantro, limón y salsa.',
    items: [
      {
        id: 'burrita-birria',
        name: 'Burrita de birria',
        price: 0,
        description: 'Burrita acompañada de cebolla picada, limón y cilantro.',
        ingredients: ['tortilla', 'birria', 'cebolla', 'cilantro', 'limón', 'salsa'],
        options: [],
        available: true
      },
      {
        id: 'orden-tacos-birria',
        name: 'Orden de tacos de birria',
        price: 0,
        description: 'Orden de 4 piezas en tortilla de maíz o harina.',
        ingredients: ['birria', 'tortilla', 'cebolla', 'cilantro', 'limón', 'salsa'],
        options: [
          { name: 'Tortilla', values: ['Maíz', 'Harina'] }
        ],
        available: true
      },
      {
        id: 'quesabirria',
        name: 'Quesabirria',
        price: 0,
        description: 'Quesabirria con queso fundido y birria.',
        ingredients: ['birria', 'queso', 'tortilla', 'cebolla', 'cilantro', 'limón', 'salsa'],
        options: [
          { name: 'Tortilla', values: ['Maíz', 'Harina'] }
        ],
        available: true,
        badge: 'Nuevo'
      },
      {
        id: 'torta-birria',
        name: 'Torta de birria',
        price: 0,
        description: 'Torta rellena de birria con acompañamientos.',
        ingredients: ['pan', 'birria', 'cebolla', 'cilantro', 'limón', 'salsa'],
        options: [],
        available: true
      },
      {
        id: 'birriamen',
        name: 'Birriamen',
        price: 0,
        description: 'Birriamen de 1/2 litro con costra de queso y aguacate.',
        ingredients: ['birria', 'ramen', 'consomé', 'costra de queso', 'aguacate', 'cebolla', 'cilantro'],
        options: [],
        available: true
      },
      {
        id: 'montado-birria',
        name: 'Montado de birria',
        price: 0,
        description: 'Montado de birria con queso.',
        ingredients: ['tortilla', 'birria', 'queso', 'cebolla', 'cilantro', 'limón'],
        options: [],
        available: true
      },
      {
        id: 'consome',
        name: 'Consomé',
        price: 0,
        description: 'Consomé de birria para acompañar.',
        ingredients: ['consomé', 'cebolla', 'cilantro', 'limón'],
        options: [],
        available: true
      }
    ]
  },
  {
    id: 'bebidas',
    name: 'Bebidas',
    description: 'Café, jugos, malteadas y smoothies.',
    items: [
      {
        id: 'refresco-coca',
        name: 'Refresco Coca-Cola',
        price: 0,
        description: 'Refresco Coca-Cola.',
        ingredients: ['refresco'],
        options: [],
        available: true
      },
      {
        id: 'jugos-frescos',
        name: 'Jugos frescos de fruta',
        price: 0,
        description: 'Jugo fresco de fruta de temporada.',
        ingredients: ['fruta de temporada'],
        options: [
          { name: 'Sabor', values: ['Naranja', 'Piña', 'Mango', 'Temporada'] }
        ],
        available: true
      },
      {
        id: 'jugo-verde',
        name: 'Jugo verde',
        price: 0,
        description: 'Jugo verde con piña, pepino, naranja y hoja verde.',
        ingredients: ['piña', 'pepino', 'naranja', 'hoja verde'],
        options: [],
        available: true
      },
      {
        id: 'limonada',
        name: 'Limonada',
        price: 0,
        description: 'Limonada con limón, pepino y chía.',
        ingredients: ['limón', 'pepino', 'chía', 'agua'],
        options: [],
        available: true
      },
      {
        id: 'jugo-rojo',
        name: 'Jugo rojo',
        price: 0,
        description: 'Jugo rojo con zanahoria, betabel y frutos rojos. Ingredientes editables en admin.',
        ingredients: ['zanahoria', 'betabel', 'frutos rojos'],
        options: [],
        available: true
      },
      {
        id: 'jugo-amarillo',
        name: 'Jugo amarillo',
        price: 0,
        description: 'Jugo amarillo con mango, zanahoria y naranja.',
        ingredients: ['mango', 'zanahoria', 'naranja'],
        options: [],
        available: true
      },
      {
        id: 'cafe-americano',
        name: 'Café americano',
        price: 0,
        description: 'Café americano caliente.',
        ingredients: ['café', 'agua'],
        options: [],
        available: true
      },
      {
        id: 'iced-americano',
        name: 'Iced americano',
        price: 0,
        description: 'Iced americano con crema, azúcar y hielo.',
        ingredients: ['café', 'hielo', 'crema', 'azúcar'],
        options: [],
        available: true
      },
      {
        id: 'iced-moka',
        name: 'Iced moka',
        price: 0,
        description: 'Café frío estilo moka.',
        ingredients: ['café', 'chocolate', 'hielo', 'leche'],
        options: [],
        available: true
      },
      {
        id: 'malteada',
        name: 'Malteada',
        price: 0,
        description: 'Malteada en sabor chocolate, vainilla, Oreo, fresa o mango. Puedes agregar scoop de proteína por $25.',
        ingredients: ['leche', 'helado', 'saborizante'],
        options: [
          { name: 'Sabor', values: ['Chocolate', 'Vainilla', 'Oreo', 'Fresa', 'Mango'] },
          { name: 'Proteína', values: ['Sin proteína', 'Agregar scoop +$25'] }
        ],
        available: true
      },
      {
        id: 'smoothie-proteina',
        name: 'Smoothie con proteína',
        price: 0,
        description: 'Smoothie con proteína en sabor fresa, mango o moras.',
        ingredients: ['fruta', 'proteína', 'hielo', 'base smoothie'],
        options: [
          { name: 'Sabor', values: ['Fresa', 'Mango', 'Moras'] }
        ],
        available: true
      }
    ]
  }
];

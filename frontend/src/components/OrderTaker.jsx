import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { 
  ShoppingCart, 
  LayoutGrid, 
  Utensils, 
  Search, 
  Plus, 
  Minus, 
  Send, 
  Coffee, 
  ChevronRight, 
  ArrowLeft, 
  X, 
  Trash2 
} from 'lucide-react';

const TABLES = Array.from({ length: 12 }, (_, i) => `Table ${i + 1}`);

export default function OrderTaker({ session, selectedDepotId }) {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const itemsPerPage = 8;
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Mobile UI State: 'tables', 'menu', 'cart'
  const [activeTab, setActiveTab] = useState('tables');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [prodRes, catRes] = await Promise.all([
        supabase.from('produits').select('*').order('name'),
        supabase.from('categories').select('*').order('name')
      ]);
      
      const filteredCats = (catRes.data || []).filter(c => 
        c.name.toLowerCase().includes('boisson')
      );
      
      setProducts(prodRes.data || []);
      setCategories(filteredCats);
      setLoading(false);
    };
    fetchData();
  }, [selectedDepotId]);

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id, delta) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter(item => item.quantity > 0));
  };

  const clearCart = () => {
    if (window.confirm('Vider le panier ?')) {
      setCart([]);
    }
  };

  const filteredTables = useMemo(() => {
    return TABLES.filter(t => t.toLowerCase().includes(tableSearchTerm.toLowerCase()));
  }, [tableSearchTerm]);

  const paginatedTables = useMemo(() => {
    const start = (tablePage - 1) * itemsPerPage;
    return filteredTables.slice(start, start + itemsPerPage);
  }, [filteredTables, tablePage]);

  const totalTablePages = Math.ceil(filteredTables.length / itemsPerPage);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || p.category_id === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  const total = useMemo(() => cart.reduce((a, b) => a + (b.quantity * b.price), 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((a, b) => a + b.quantity, 0), [cart]);

  const handleSendOrder = async () => {
    if (!selectedTable) {
      alert('Veuillez sélectionner une table');
      setActiveTab('tables');
      return;
    }
    if (cart.length === 0) {
      alert('Le panier est vide');
      return;
    }

    const orderReference = `CMD-${Date.now()}`;
    
    // 1. Insert Order
    const { data: orderData, error: orderError } = await supabase
      .from('commandes')
      .insert({
        table_name: selectedTable,
        status: 'pending',
        order_reference: orderReference,
        total_amount: total
      })
      .select('id')
      .single();

    if (orderError) {
      alert('Erreur lors de la création de la commande : ' + orderError.message);
      return;
    }

    // 2. Insert Order Items
    const orderItems = cart.map(item => ({
      commande_id: orderData.id,
      item_id: item.id,
      item_type: 'product', // assuming products for now
      quantity: item.quantity,
      unit_price: item.price
    }));

    const { error: itemsError } = await supabase
      .from('commande_items')
      .insert(orderItems);

    if (itemsError) {
      alert('Erreur lors de l\'ajout des articles : ' + itemsError.message);
      return;
    }

    alert('Commande envoyée en cuisine !');
    setCart([]);
    setSelectedTable(null);
    setActiveTab('tables');
    navigate('/dashboard/restaurant-kitchen');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 overflow-hidden relative pb-16 md:pb-0">
      
      {/* 1. Header Area */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          {activeTab !== 'tables' && (
             <button onClick={() => setActiveTab(activeTab === 'cart' ? 'menu' : 'tables')} className="md:hidden p-2 -ml-2 text-gray-400">
               <ArrowLeft size={18} />
             </button>
          )}
          <h2 className="font-black text-lg tracking-tight">
            {activeTab === 'tables' ? 'Salles' : activeTab === 'menu' ? 'Menu' : 'Panier'}
          </h2>
        </div>
        
        {selectedTable && (
          <div className="flex items-center gap-2 bg-red-50 px-3 py-1 rounded-full border border-red-100">
            <Utensils size={12} className="text-red-600" />
            <span className="text-red-700 font-black text-xs uppercase">{selectedTable}</span>
            <button onClick={() => setSelectedTable(null)} className="text-red-400 hover:text-red-600 ml-1">
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* 2. Main Content Grid */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* TAB 1: TABLES - Fixed width for MD and XL */}
        <div className={`
          ${activeTab === 'tables' ? 'flex' : 'hidden'} 
          md:flex md:w-[280px] xl:w-[320px] bg-white border-r border-gray-200 flex-col shrink-0
          ${activeTab !== 'tables' && 'md:hidden xl:flex'}
        `}>
          <div className="p-3 flex flex-col h-full">
            <h3 className="font-black text-gray-400 uppercase text-[10px] tracking-widest px-1 mb-2">Salles / Zones</h3>
            
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input 
                type="text" 
                placeholder="Chercher..." 
                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2 pl-9 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-red-500/10" 
                value={tableSearchTerm}
                onChange={(e) => { setTableSearchTerm(e.target.value); setTablePage(1); }}
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {paginatedTables.map(table => (
                  <button 
                    key={table} 
                    onClick={() => {
                      setSelectedTable(table);
                      if (window.innerWidth < 1280) setActiveTab('menu');
                    }} 
                    className={`
                      aspect-[4/3] rounded-2xl flex flex-col items-center justify-center gap-1 transition-all duration-200 border-2
                      ${selectedTable === table 
                        ? 'bg-red-600 border-red-600 text-white shadow-md' 
                        : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100'
                      }
                    `}
                  >
                    <span className="text-xl font-black">{table.replace('Table ', '')}</span>
                    <span className="text-[9px] font-bold uppercase opacity-60">Table</span>
                  </button>
                ))}
              </div>
            </div>

            {totalTablePages > 1 && (
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                <button 
                  disabled={tablePage === 1}
                  onClick={() => setTablePage(p => p - 1)}
                  className="p-2 text-gray-400 disabled:opacity-30"
                >
                  <ArrowLeft size={16} />
                </button>
                <span className="text-[10px] font-black text-gray-400">PAGE {tablePage} / {totalTablePages}</span>
                <button 
                  disabled={tablePage === totalTablePages}
                  onClick={() => setTablePage(p => p + 1)}
                  className="p-2 text-gray-400 disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* TAB 2: MENU */}
        <div className={`
          ${activeTab === 'menu' ? 'flex' : 'hidden'} 
          md:flex flex-1 flex-col bg-gray-50 min-w-0
        `}>
          {/* Search & Categories */}
          <div className="p-3 bg-white border-b border-gray-200 space-y-3 shadow-sm z-10">
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveTab('tables')}
                className="xl:hidden p-2.5 bg-gray-100 rounded-xl text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <LayoutGrid size={18} />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Rechercher..." 
                  className="w-full bg-gray-100 border-none rounded-xl py-2 pl-9 pr-4 text-xs font-bold outline-none" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                />
              </div>
            </div>
            
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              <button 
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-1.5 rounded-full whitespace-nowrap text-[10px] font-black uppercase tracking-tight transition-colors ${selectedCategory === 'all' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                Tout
              </button>
              {categories.map(cat => (
                <button 
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-1.5 rounded-full whitespace-nowrap text-[10px] font-black uppercase tracking-tight transition-colors ${selectedCategory === cat.id ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto p-3 content-start">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
              {filteredProducts.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => addToCart(p)}
                  className="bg-white p-2.5 rounded-2xl flex flex-col gap-1 shadow-sm hover:shadow-md transition-all active:scale-95 text-left h-28 border border-gray-100 relative group"
                >
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-black text-xs text-gray-800 line-clamp-2 leading-tight">{p.name}</h4>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-red-600 font-black text-xs">{p.price.toLocaleString()} Ar</span>
                      <div className="w-6 h-6 bg-gray-50 rounded-lg flex items-center justify-center group-hover:bg-red-50 group-hover:text-red-600 transition-colors">
                        <Plus size={14} />
                      </div>
                    </div>
                  </div>
                  {cart.find(item => item.id === p.id) && (
                    <div className="absolute -top-1 -right-1 bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center font-black text-[9px] border-2 border-white shadow-sm">
                      {cart.find(item => item.id === p.id).quantity}
                    </div>
                  )}
                </button>
              ))}
              
              {filteredProducts.length === 0 && (
                <div className="col-span-full py-10 text-center">
                  <Search size={32} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-gray-400 font-black uppercase tracking-widest text-[10px]">Aucun plat trouvé</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TAB 3: CART - Increased width for MD and XL */}
        <div className={`
          ${activeTab === 'cart' ? 'flex' : 'hidden'} 
          md:flex md:w-[340px] xl:w-[420px] bg-white border-l border-gray-200 flex-col shrink-0
        `}>
          <div className="p-3 border-b border-gray-200 flex items-center justify-between bg-white z-10">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-gray-400" />
              <h3 className="font-black text-gray-800 uppercase tracking-tight text-xs">Panier</h3>
            </div>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-gray-400 hover:text-red-600 p-1.5 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <ShoppingCart size={24} className="text-gray-300 mb-2" />
                <p className="text-gray-400 font-bold text-[10px] uppercase tracking-wide">Vide</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.id} className="bg-white p-2 rounded-xl shadow-sm border border-gray-100 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-[11px] text-gray-800 truncate leading-tight">{item.name}</h4>
                    <p className="text-[10px] text-red-600 font-black">{item.price.toLocaleString()} Ar</p>
                  </div>
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                    <button 
                      onClick={() => updateQuantity(item.id, -1)} 
                      className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-white rounded-md transition-colors"
                    >
                      <Minus size={12}/>
                    </button>
                    <span className="w-4 text-center font-black text-[11px] text-gray-800">{item.quantity}</span>
                    <button 
                      onClick={() => updateQuantity(item.id, 1)} 
                      className="w-6 h-6 flex items-center justify-center text-gray-800 hover:bg-white rounded-md transition-colors"
                    >
                      <Plus size={12}/>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 bg-white border-t border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 font-bold uppercase text-[9px] tracking-widest">Total</span>
              <span className="text-xl font-black text-gray-800">{total.toLocaleString()} Ar</span>
            </div>
            
            <button 
              disabled={cart.length === 0}
              onClick={handleSendOrder}
              className={`
                w-full py-3 rounded-xl font-black flex items-center justify-center gap-2 transition-all text-sm
                ${cart.length === 0 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-red-600 text-white shadow-md hover:bg-red-700 active:scale-[0.98]'
                }
              `}
            >
              <Send size={16} />
              <span>Commander</span>
            </button>
          </div>
        </div>

      </div>

      {/* 3. Mobile Navigation Bottom Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <NavButton 
          active={activeTab === 'tables'} 
          onClick={() => setActiveTab('tables')} 
          icon={<LayoutGrid size={20} />} 
          label="Salles" 
        />
        <NavButton 
          active={activeTab === 'menu'} 
          onClick={() => setActiveTab('menu')} 
          icon={<Coffee size={20} />} 
          label="Menu" 
        />
        <NavButton 
          active={activeTab === 'cart'} 
          onClick={() => setActiveTab('cart')} 
          icon={<ShoppingCart size={20} />} 
          label="Panier" 
          badge={cartCount}
        />
      </div>

    </div>
  );
}

function NavButton({ active, onClick, icon, label, badge }) {
  return (
    <button 
      onClick={onClick}
      className={`
        flex flex-col items-center gap-1 flex-1 py-1 rounded-xl transition-all relative
        ${active ? 'text-red-600' : 'text-gray-400'}
      `}
    >
      <div className={`p-1.5 rounded-xl ${active ? 'bg-red-50' : 'transparent'}`}>
        {icon}
      </div>
      <span className="text-[10px] font-black uppercase tracking-tight">{label}</span>
      {badge > 0 && (
        <span className="absolute top-0 right-1/2 translate-x-4 bg-red-600 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">
          {badge}
        </span>
      )}
    </button>
  );
}

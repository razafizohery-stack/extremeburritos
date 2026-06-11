import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabaseClient';
import { Search, ShoppingCart, Send, Loader2, Utensils, Trash2, X, ChevronRight, LayoutGrid, CheckCircle2, Clock, Printer } from 'lucide-react';

const TABLES = Array.from({ length: 12 }, (_, i) => `Table ${i + 1}`);

export default function OrderTaker({ session, selectedDepotId }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTable, setSelectedTable] = useState(null);
  const [cart, setCart] = useState([]);
  const [existingOrderItems, setExistingOrderItems] = useState([]);
  const [tableStatus, setTableStatus] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCartMobile, setShowCartMobile] = useState(false);
  const [showTableSelect, setShowTableSelect] = useState(true);
  const [loading, setLoading] = useState(true);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [currentDepotInfo, setCurrentDepotInfo] = useState(null);

  // Fetch Depot Info
  useEffect(() => {
    const fetchDepot = async () => {
        if (!selectedDepotId) return;
        const { data } = await supabase.from('depots').select('*').eq('id', selectedDepotId).single();
        if (data) setCurrentDepotInfo(data);
    };
    fetchDepot();
  }, [selectedDepotId]);
  
  // Fetch active orders for all tables to show status
  const fetchTableStatus = async () => {
    // Lock table if it has an order that is not paid or cancelled
    const { data: activeOrders } = await supabase
      .from('commandes')
      .select('table_name, status, id')
      .neq('status', 'paid')
      .neq('status', 'cancelled');
    
    const statusMap = {};
    if (activeOrders) {
        for (const order of activeOrders) {
            const { data: items } = await supabase
                .from('commande_items')
                .select('quantity, item_id, item_type')
                .eq('commande_id', order.id);
            
            const itemsWithNames = await Promise.all((items || []).map(async (item) => {
                if (item.item_type === 'product' && item.item_id) {
                    const { data: prodData } = await supabase
                        .from('produits')
                        .select('name')
                        .eq('id', item.item_id)
                        .maybeSingle();
                    return { ...item, produits: prodData || { name: 'Produit inconnu' } };
                }
                return { ...item, produits: { name: 'Menu/Article' } };
            }));
            
            statusMap[order.table_name] = {
                status: order.status,
                items: itemsWithNames || []
            };
        }
    }
    setTableStatus(statusMap);
  };

  const fetchExistingOrder = async (tableName) => {
    if (!tableName) {
      setExistingOrderItems([]);
      return;
    }
    // Fetch active order regardless of status (as long as not paid/cancelled)
    const { data: order } = await supabase
      .from('commandes')
      .select('id')
      .eq('table_name', tableName)
      .neq('status', 'paid')
      .neq('status', 'cancelled')
      .maybeSingle();
    
    if (order) {
      const { data: items } = await supabase
        .from('commande_items')
        .select('*')
        .eq('commande_id', order.id);
      
      // Manual lookup to avoid FK join issues
      const itemsWithNames = await Promise.all((items || []).map(async (item) => {
          if (item.item_type === 'product' && item.item_id) {
              const { data: prodData } = await supabase
                  .from('produits')
                  .select('name')
                  .eq('id', item.item_id)
                  .maybeSingle();
              return { ...item, produits: prodData || { name: 'Produit inconnu' } };
          }
          return { ...item, produits: { name: 'Menu/Article' } };
      }));
      
      setExistingOrderItems(itemsWithNames || []);
    } else {
      setExistingOrderItems([]);
    }
  };

  useEffect(() => {
    fetchTableStatus();

    // Subscribe to real-time changes
    const channel = supabase
      .channel('table-status-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'commandes' 
      }, (payload) => {
        fetchTableStatus();
        // If we have a selected table, check if it was updated
        if (selectedTable) {
           fetchExistingOrder(selectedTable);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTable]);

  useEffect(() => {
    fetchExistingOrder(selectedTable);
  }, [selectedTable]);
  
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      // Fetch Categories
      const { data: catsData } = await supabase.from('categories').select('*').order('name');
      setCategories(catsData || []);

      // Fetch Products
      let { data: productsData } = await supabase
        .from('produits')
        .select(`*, stocks(*)`)
        .order('name');
      
      // Fetch Menus
      let { data: menusData } = await supabase
        .from('menus')
        .select(`*, menu_items(produits(name, price))`)
        .eq('is_active', true);

      let allItems = [];
      if (productsData) {
        allItems = [...allItems, ...productsData
          .filter(p => p.type === 'vente' || !p.type)
          .map(p => ({ 
            ...p, 
            type: 'product',
            type_prod: p.type || 'vente',
            stock_quantity: p.stocks?.find(s => s.depot_id === selectedDepotId)?.quantity || 0 
        }))];
      }
      
      if (menusData) {
        allItems = [...allItems, ...menusData.map(m => ({
            id: m.id,
            name: m.name,
            price: m.price,
            description: m.description,
            type: 'menu',
            stock_quantity: 999 
        }))];
      }

      setProducts(allItems);
      setFilteredProducts(allItems);
      setLoading(false);
    };
    if (selectedDepotId) fetchData();
  }, [selectedDepotId]);

  useEffect(() => {
    const term = searchTerm.toLowerCase().trim();
    let filtered = products;

    if (term) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(term));
    }

    if (selectedCategory !== 'all') {
      if (selectedCategory === 'menu') {
        filtered = filtered.filter(p => p.type === 'menu');
      } else {
        filtered = filtered.filter(p => p.category_id === selectedCategory);
      }
    }

    setFilteredProducts(filtered);
  }, [searchTerm, products, selectedCategory]);

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
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(0, item.quantity + delta);
        return newQty === 0 ? null : { ...item, quantity: newQty };
      }
      return item;
    }).filter(Boolean));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const total = useMemo(() => cart.reduce((acc, item) => acc + (item.quantity * item.price), 0), [cart]);

  const confirmAndSend = async () => {
    if (!selectedTable || cart.length === 0) return;
    setIsProcessing(true);
    try {
      const { data: existingOrder } = await supabase
        .from('commandes')
        .select('id, total_amount, status, order_reference')
        .eq('table_name', selectedTable)
        .neq('status', 'paid')
        .neq('status', 'cancelled')
        .maybeSingle();

      let commandeId;
      let orderReference;
      let newTotal;
      let isExistingOrderReady = false;

      if (existingOrder) {
        if (existingOrder.status === 'ready') {
            isExistingOrderReady = true;
        }
        commandeId = existingOrder.id;
        orderReference = existingOrder.order_reference;
        newTotal = Number(existingOrder.total_amount) + total;
        
        await supabase
          .from('commandes')
          .update({ total_amount: newTotal })
          .eq('id', commandeId);
        
        await supabase
          .from('factures')
          .update({ total_amount: newTotal })
          .eq('order_reference', orderReference);
      } else {
        orderReference = `CMD-${Date.now().toString().slice(-6)}`;
        const { data: commande, error: cmdErr } = await supabase
          .from('commandes')
          .insert([{ 
              table_name: selectedTable, 
              total_amount: total, 
              status: 'pending',
              user_id: session?.user?.id,
              order_reference: orderReference
          }])
          .select().single();
        
        if (cmdErr) throw cmdErr;
        commandeId = commande.id;
        
        await supabase.from('factures').insert([{ 
            order_reference: orderReference,
            commande_id: commandeId,
            number: `INV-${Date.now().toString().slice(-6)}`, 
            user_id: session?.user?.id, 
            total_amount: total, 
            paid_amount: 0,
            status: 'unpaid',
            depot_id: selectedDepotId,
            guest_name: selectedTable
        }]);
      }

      const itemsToInsert = cart.map(item => ({
        commande_id: commandeId,
        order_reference: orderReference,
        item_id: item.id,
        item_type: item.type || 'product',
        quantity: item.quantity,
        unit_price: item.price,
        is_additional: isExistingOrderReady
      }));

      const { error: itemsErr } = await supabase.from('commande_items').insert(itemsToInsert);
      if (itemsErr) throw itemsErr;

      fetchTableStatus();
      setCart([]);
      setSelectedTable(null);
      setShowTableSelect(true);
      setShowCartMobile(false);
      setPreviewOrder(null);
      alert("Commande envoyée en cuisine !");
    } catch (e) {
      alert("Erreur: " + e.message);
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendToKitchen = () => {
    if (!selectedTable || cart.length === 0) return;
    
    // We don't have the order_reference yet if it's a new order
    // But we can preview with a placeholder or fetch if existing
    const orderRef = existingOrderItems.length > 0 ? existingOrderItems[0].order_reference : `CMD-NEW`;

    // Prepare preview data
    const previewData = {
        table_name: selectedTable,
        order_reference: orderRef,
        items: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            total: item.quantity * item.price
        })),
        total_amount: total,
        date: new Date().toLocaleString('fr-FR')
    };
    
    setPreviewOrder(previewData);
  };

  const handleTableSelect = (table) => {
    setSelectedTable(table);
    setShowTableSelect(false);
    setCart([]); // Clear temporary cart when switching tables
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden relative selection:bg-red-200">
      <div className="flex flex-col lg:flex-row h-full overflow-hidden">
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 p-2 md:p-4 gap-4 overflow-hidden">
          
          {/* Header Bar */}
          <div className="flex items-center justify-between bg-white p-4 rounded-[2rem] shadow-sm border border-gray-200 shrink-0">
             <div className="flex items-center gap-3">
                <div className={`p-3 rounded-2xl ${selectedTable ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <Utensils size={24} />
                </div>
                <div>
                  <h3 className="font-black text-xs text-gray-400 uppercase tracking-widest leading-none mb-1">Service en cours</h3>
                  <p className="font-black text-xl text-gray-800 leading-none">{selectedTable || 'Choisir Table'}</p>
                </div>
             </div>
             {selectedTable && (
               <button 
                onClick={() => setShowTableSelect(true)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-6 py-3 rounded-xl font-black text-xs uppercase transition-all"
               >
                 Changer
               </button>
             )}
          </div>

          {/* Table Selection Overlay/Grid */}
          {showTableSelect ? (
            <div className="flex-1 bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-200 flex flex-col min-h-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black text-gray-800 uppercase tracking-tight flex items-center gap-3">
                  <LayoutGrid className="text-red-600" size={28} /> Plan des Tables
                </h3>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
                    <span className="text-[10px] font-black text-gray-400 uppercase">Libre</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                    <span className="text-[10px] font-black text-gray-400 uppercase">Occupée</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6 content-start pb-6">
                {TABLES.map(table => {
                  const tableData = tableStatus[table];
                  const isOccupied = !!tableData;
                  const status = tableData?.status;
                  return (
                    <button 
                      key={table} 
                      onClick={() => handleTableSelect(table)}
                      className={`relative group flex flex-col items-center justify-center gap-3 p-6 rounded-3xl border-2 transition-all duration-300 ${
                        isOccupied 
                        ? 'bg-gradient-to-br from-red-50 to-white border-red-200 text-red-600 shadow-lg shadow-red-100/50 hover:shadow-red-200/50' 
                        : 'bg-white border-gray-100 text-gray-700 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-50/50'
                      }`}
                    >
                      <div className={`p-4 rounded-2xl transition-colors duration-300 ${isOccupied ? 'bg-red-100' : 'bg-gray-50 group-hover:bg-emerald-50'}`}>
                          <Utensils size={28} className={isOccupied ? 'text-red-500' : 'text-gray-400 group-hover:text-emerald-500 transition-colors'} />
                      </div>
                      <span className="font-black text-xl uppercase tracking-tighter">Table {table.replace('Table ', '')}</span>
                      {isOccupied && (
                        <div className="flex flex-col items-center gap-1 mt-1 w-full">
                          <span className="text-[10px] font-black uppercase text-red-600 bg-red-100 px-3 py-0.5 rounded-full animate-pulse">
                            {status === 'pending' ? 'En attente' : status === 'ready' ? 'Prêt' : status}
                          </span>
                          {status === 'pending' && tableData.items && tableData.items.length > 0 && (
                            <div className="text-[9px] text-gray-500 mt-2 max-h-16 overflow-y-auto w-full text-left bg-white/50 p-2 rounded-lg border border-red-100">
                                {tableData.items.map((item, idx) => (
                                    <div key={idx} className="truncate">x{item.quantity} {item.produits?.name}</div>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Product Selection Area */
            <div className="flex-1 bg-white p-4 md:p-6 rounded-[2.5rem] shadow-sm border border-gray-200 flex flex-col min-h-0 overflow-hidden">
              
              {/* Category Bar */}
              <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-6 shrink-0">
                <CategoryButton 
                  active={selectedCategory === 'all'} 
                  onClick={() => setSelectedCategory('all')} 
                  label="Tous" 
                />
                <CategoryButton 
                  active={selectedCategory === 'menu'} 
                  onClick={() => setSelectedCategory('menu')} 
                  label="Menus" 
                />
                {categories
                  .filter(cat => cat.name.toLowerCase().includes('boisson'))
                  .map(cat => (
                    <CategoryButton 
                      key={cat.id}
                      active={selectedCategory === cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      label={cat.name}
                    />
                  ))}
              </div>

              {/* Search */}
              <div className="relative mb-6 shrink-0">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                <input 
                  type="text" 
                  placeholder="Recherche de plats ou boissons..." 
                  className="w-full pl-14 pr-6 py-5 bg-gray-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-red-500 focus:bg-white transition-all text-lg shadow-inner"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Product Grid */}
              <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3 content-start pb-4">
                {loading ? (
                  <div className="col-span-full h-40 flex items-center justify-center">
                    <Loader2 className="animate-spin text-red-600" size={40} />
                  </div>
                ) : filteredProducts.length > 0 ? (
                  filteredProducts.map(p => (
                    <ProductCard key={p.id} p={p} onClick={() => addToCart(p)} />
                  ))
                ) : (
                  <div className="col-span-full h-60 flex flex-col items-center justify-center text-gray-300">
                    <Search size={60} className="mb-4 opacity-20" />
                    <p className="font-black uppercase tracking-[0.2em] text-sm">Aucun résultat</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Cart - Desktop */}
        <div className="hidden lg:flex w-72 xl:w-80 bg-[#0f172a] text-white p-5 flex-col shadow-[0_0_50px_rgba(0,0,0,0.3)] border-l border-white/5 relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-600/10 blur-[100px] rounded-full"></div>
          
          <div className="relative z-10 flex flex-col h-full">
            <CartContent 
              selectedTable={selectedTable} 
              cart={cart}
              existingOrderItems={existingOrderItems}
              removeFromCart={removeFromCart} 
              updateQuantity={updateQuantity}
              total={total} 
              handleSendToKitchen={handleSendToKitchen} 
              isProcessing={isProcessing} 
              onClose={() => {}}
            />
          </div>
        </div>

        {/* Floating Cart Button - Mobile */}
        {!showTableSelect && (
          <div className="lg:hidden fixed bottom-6 right-6 z-[60]">
            <button 
              onClick={() => setShowCartMobile(true)}
              className="w-20 h-20 bg-red-600 text-white rounded-full shadow-[0_20px_50px_rgba(220,38,38,0.5)] flex items-center justify-center active:scale-90 transition-all border-4 border-white"
            >
              <div className="relative">
                <ShoppingCart size={32} />
                {(cart.length > 0 || existingOrderItems.length > 0) && (
                  <span className="absolute -top-3 -right-3 bg-gray-900 text-white text-xs font-black min-w-[24px] h-6 px-1 rounded-full flex items-center justify-center border-2 border-white">
                    {cart.reduce((a, b) => a + b.quantity, 0) + existingOrderItems.reduce((a, b) => a + b.quantity, 0)}
                  </span>
                )}
              </div>
            </button>
          </div>
        )}

        {/* Cart Drawer - Mobile */}
        {showCartMobile && (
          <div className="fixed inset-0 z-[100] flex justify-end">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowCartMobile(false)}></div>
            <div className="relative w-[85%] bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
               <CartContent 
                selectedTable={selectedTable} 
                cart={cart} 
                existingOrderItems={existingOrderItems}
                removeFromCart={removeFromCart} 
                updateQuantity={updateQuantity}
                total={total} 
                handleSendToKitchen={handleSendToKitchen} 
                isProcessing={isProcessing} 
                onClose={() => setShowCartMobile(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Ticket Preview Modal */}
      {previewOrder && createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <style>{`
            @media print {
              @page { margin: 0 !important; size: 80mm auto; }
              #root { display: none !important; }
              body, html { 
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
              }
              #printable-ticket {
                visibility: visible !important;
                display: block !important;
                width: 65mm !important;
                margin: 0 auto !important;
                padding: 10mm !important;
                font-family: 'Courier New', Courier, monospace !important;
                color: black !important;
              }
              .no-print { display: none !important; }
            }
          `}</style>

          <div className="bg-white text-black w-full max-w-[400px] max-h-[90vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 no-print">
               <h3 className="font-black uppercase text-xs tracking-widest text-gray-400">Aperçu Ticket</h3>
               <button onClick={() => setPreviewOrder(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={20}/></button>
            </div>

            <div id="printable-ticket" className="flex-1 overflow-y-auto p-8 font-mono text-[14px]">
               <div className="text-center mb-6">
                  {/* Logo */}
                  <div className="flex justify-center mb-4">
                     <img src="/logo.jpeg" alt="Logo" className="w-20 h-20 object-cover rounded-full border-2 border-black" onError={(e) => e.target.style.display='none'} />
                  </div>
                  <h2 className="text-xl font-black uppercase mb-1">{currentDepotInfo?.name || 'Extrême Buritos'}</h2>
                  <p className="text-[10px] uppercase opacity-60 font-bold">{currentDepotInfo?.address || 'Antananarivo'}</p>
                  <p className="text-[10px] uppercase opacity-60 font-bold">Tél: {currentDepotInfo?.phone || '---'}</p>
                  
                  <div className="my-4 border-t border-dashed border-black/20"></div>
                  
                  <div className="bg-gray-100 py-3 px-4 rounded-xl space-y-1 mb-4">
                      <h3 className="font-black text-lg uppercase leading-none">{previewOrder.table_name}</h3>
                      <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Bon de Commande</p>
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase opacity-60 pt-1">
                          <span>REF: {previewOrder.order_reference}</span>
                          <span>{previewOrder.date.split(' ')[0]}</span>
                      </div>
                  </div>
               </div>

               <div className="space-y-3">
                  <div className="flex justify-between font-black text-[10px] uppercase border-b-2 border-black pb-1">
                     <span>Désignation</span>
                     <span className="pr-2">Total</span>
                  </div>
                  {previewOrder.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-start text-sm border-b border-dashed border-black/5 pb-1">
                       <div className="flex flex-col flex-1 pr-2">
                          <span className="font-bold break-words">{item.name}</span>
                          <span className="text-[11px] opacity-60">{item.quantity} x {item.price.toLocaleString()}</span>
                       </div>
                       <span className="font-bold whitespace-nowrap">{item.total.toLocaleString()}</span>
                    </div>
                  ))}
               </div>

               <div className="my-6 border-t-2 border-dashed border-black"></div>

               <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center gap-1 bg-black text-white py-4 rounded-2xl">
                      <span className="text-[10px] font-black uppercase opacity-60">TOTAL COMMANDE</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black">{previewOrder.total_amount.toLocaleString()}</span>
                        <span className="text-sm font-bold uppercase">Ar</span>
                      </div>
                  </div>
               </div>

               <div className="mt-8 text-center text-[10px] uppercase opacity-40 font-bold border-t border-dashed border-black/20 pt-4">
                  <p>*** Bon de Cuisine ***</p>
                  <p>Heure: {previewOrder.date.split(' ')[1]}</p>
               </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-4 no-print">
               <button 
                onClick={() => window.print()}
                className="flex-1 py-4 bg-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-gray-300 transition-all"
               >
                 <Printer size={18}/> Imprimer
               </button>
               <button 
                onClick={confirmAndSend}
                disabled={isProcessing}
                className="flex-[2] py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-200"
               >
                 {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <><CheckCircle2 size={18}/> Confirmer l'envoi</>}
               </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

function CategoryButton({ active, onClick, label }) {
  return (
    <button 
      onClick={onClick}
      className={`px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all whitespace-nowrap border-2 ${
        active 
        ? 'bg-red-600 border-red-600 text-white shadow-lg shadow-red-200' 
        : 'bg-white border-gray-100 text-gray-400 hover:border-red-100 hover:text-red-500'
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({ p, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`group relative p-4 rounded-[1.5rem] text-left transition-all border-2 border-transparent active:scale-[0.98] flex flex-col justify-between h-32 md:h-36 shadow-sm overflow-hidden ${
        p.type === 'menu' ? 'bg-red-50 hover:bg-red-100' : 'bg-gray-50 hover:bg-gray-100'
      }`}
    >
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex justify-between items-start mb-1">
          <div className="font-black uppercase text-[10px] md:text-xs leading-tight line-clamp-2 flex-1 pr-2 text-gray-800">{p.name}</div>
          {p.type === 'menu' && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter shrink-0">Menu</span>}
        </div>
        
        <div className="mt-auto">
          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Prix Unitaire</p>
          <div className="font-black text-lg md:text-xl text-red-600 tracking-tighter">
            {p.price.toLocaleString()} <span className="text-[8px] md:text-[10px]">Ar</span>
          </div>
        </div>
      </div>
      
      {/* Decorative background icon */}
      <Utensils className="absolute -bottom-1 -right-1 text-gray-200/50 group-hover:text-red-200/50 transition-colors" size={64} />
      
      {/* Add indicator */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-white text-red-600 p-1.5 rounded-lg shadow-lg">
        <ChevronRight size={14} />
      </div>
    </button>
  );
}

function CartContent({ selectedTable, cart, existingOrderItems, removeFromCart, updateQuantity, total, handleSendToKitchen, isProcessing, onClose }) {
  return (
    <div className="flex flex-col h-full text-white">
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-col">
          <span className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Commande</span>
          <span className="text-3xl font-black text-white uppercase tracking-tighter">{selectedTable || '---'}</span>
        </div>
        <button onClick={onClose} className="lg:hidden w-12 h-12 flex items-center justify-center bg-white/5 rounded-2xl">
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 mb-6 pr-2 no-scrollbar">
        {existingOrderItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-white/10"></div>
              <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">Service en cours</h4>
              <div className="h-px flex-1 bg-white/10"></div>
            </div>
            <div className="space-y-2">
              {existingOrderItems.map(item => (
                <div key={item.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 opacity-50 flex justify-between items-center group">
                  <div className="flex flex-col">
                    <span className="font-black text-xs uppercase text-gray-300 leading-tight">{item.produits?.name}</span>
                    <span className="text-[10px] font-bold text-gray-500">Déjà envoyé</span>
                  </div>
                  <span className="bg-white/10 px-3 py-1 rounded-lg font-black text-sm">x{item.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cart.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px flex-1 bg-red-600/30"></div>
              <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest whitespace-nowrap">Nouveau à envoyer</h4>
              <div className="h-px flex-1 bg-red-600/30"></div>
            </div>
            <div className="space-y-3">
              {cart.map(item => (
                <div key={item.id} className="bg-white/5 p-5 rounded-[1.5rem] border border-white/10 group animate-in slide-in-from-right duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <span className="font-black text-sm uppercase leading-tight flex-1 pr-4">{item.name}</span>
                    <button onClick={() => removeFromCart(item.id)} className="text-gray-600 hover:text-red-500 transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4 bg-black/40 rounded-xl p-1 px-2 border border-white/5">
                      <button onClick={() => updateQuantity(item.id, -1)} className="w-10 h-10 flex items-center justify-center font-black text-2xl hover:text-red-500 transition-colors">-</button>
                      <span className="font-black text-xl w-6 text-center text-red-500">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="w-10 h-10 flex items-center justify-center font-black text-2xl hover:text-red-500 transition-colors">+</button>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Sous-total</p>
                      <span className="text-base font-black text-white">{(item.quantity * item.price).toLocaleString()} Ar</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {cart.length === 0 && existingOrderItems.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-gray-700 text-center opacity-30">
            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6">
              <Utensils size={40} />
            </div>
            <p className="font-black uppercase tracking-[0.2em] text-xs leading-loose">Votre panier est vide</p>
          </div>
        )}
      </div>

      <div className="pt-8 border-t border-white/10">
        <div className="bg-white/5 rounded-3xl p-4 mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-500 font-black uppercase text-[9px] tracking-widest">Total à envoyer</span>
            <span className="text-[9px] font-black text-emerald-500 uppercase bg-emerald-500/10 px-2 py-0.5 rounded-md">Ar</span>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-3xl font-black text-white tracking-tighter leading-none">{total.toLocaleString()}</span>
            <span className="text-xs font-black text-gray-500 uppercase">Total</span>
          </div>
        </div>
        
        <button 
          onClick={handleSendToKitchen}
          disabled={isProcessing || cart.length === 0 || !selectedTable}
          className="group relative w-full overflow-hidden bg-red-600 disabled:bg-gray-800 disabled:text-gray-600 py-4 rounded-2xl transition-all shadow-xl shadow-red-900/40 active:scale-[0.98]"
        >
          <div className="relative z-10 flex items-center justify-center gap-3">
            {isProcessing ? <Loader2 className="animate-spin" size={20} /> : (
              <>
                <span className="font-black uppercase tracking-[0.1em] text-xs">Envoyer Cuisine</span>
                <Send size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-300" />
              </>
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
        </button>
      </div>
    </div>
  );
}

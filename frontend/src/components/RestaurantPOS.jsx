import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabaseClient';
import { ShoppingCart, CheckCircle, Loader2, Utensils, Search, CreditCard, ChevronRight, X, LayoutGrid, Clock, AlertCircle, Printer } from 'lucide-react';

export default function RestaurantPOS({ session, selectedDepotId }) {
  const [readyOrders, setReadyOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewInvoice, setPreviewInvoice] = useState(null);
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

  const filteredOrders = readyOrders.filter(order => 
    order.table_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('commandes')
      .select(`
        *,
        commande_items (*)
      `)
      .in('status', ['pending', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Error fetching orders:", error);
      setLoading(false);
      return;
    }

    // Ensure unique orders by ID to prevent duplicates
    const uniqueOrders = Array.from(new Map((data || []).map(o => [o.id, o])).values());

    const ordersWithProducts = await Promise.all(uniqueOrders.map(async (order) => {
        // Fetch invoice number
        const { data: invData } = await supabase
            .from('factures')
            .select('number')
            .eq('order_reference', order.order_reference)
            .maybeSingle();

        const itemsWithNames = await Promise.all(order.commande_items.map(async (item) => {
            let name = 'Article Inconnu';
            let contains_pork = false;

            if (item.item_type === 'menu' && item.item_id) {
                const { data: menuData } = await supabase
                    .from('menus')
                    .select('name, contains_pork')
                    .eq('id', item.item_id)
                    .maybeSingle();
                name = menuData?.name || `Menu ${item.item_id.slice(0,4)}`;
                contains_pork = menuData?.contains_pork || false;
            } else if (item.item_id) { // Assume 'product' or default
                const { data: prodData } = await supabase
                    .from('produits')
                    .select('name, contains_pork')
                    .eq('id', item.item_id)
                    .maybeSingle();
                name = prodData?.name || `Produit ${item.item_id.slice(0,4)}`;
                contains_pork = prodData?.contains_pork || false;
            }
            
            return { ...item, produits: { name, contains_pork } };
        }));
        return { ...order, commande_items: itemsWithNames, invoice_number: invData?.number || '---' };
    }));

    setReadyOrders(ordersWithProducts);
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('all-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commandes' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commande_items' }, fetchOrders)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' or 'm_money'
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');

  const handleFinalizePayment = async () => {
    if (!selectedOrder || selectedOrder.status !== 'ready') {
        alert("Cette commande n'est pas encore prête à être encaissée.");
        return;
    }
    
    if (paymentMethod === 'm_money' && (!paymentRef || !paymentPhone)) {
        alert("Veuillez saisir la référence et le numéro de téléphone pour le Mobile Money.");
        return;
    }

    setIsProcessing(true);
    try {
      // 1. Update commande status to paid
      const { error: cmdErr } = await supabase
        .from('commandes')
        .update({ 
          status: 'paid',
          payment_method: paymentMethod,
          payment_ref: paymentRef,
          payment_phone: paymentPhone
        })
        .eq('order_reference', selectedOrder.order_reference); // Use ref
      
      if (cmdErr) throw cmdErr;

      // 2. Update existing invoice
      console.log('Querying factures with ref:', selectedOrder.order_reference);
      const { data: invoice, error: invErr } = await supabase
        .from('factures')
        .select('id, number')
        .eq('order_reference', selectedOrder.order_reference) // Use ref
        .maybeSingle();
      
      console.log('Invoice query result:', invoice, invErr);

      let invoiceNumber = invoice?.number || '---';

      if (invoice) {
        await supabase
          .from('factures')
          .update({ 
            status: 'COMPTANT',
            paid_amount: selectedOrder.total_amount,
            payment_mode: paymentMethod === 'cash' ? 'ESPECE' : 'MOBILE_MONEY'
          })
          .eq('id', invoice.id);
        
        // Add payment record
        await supabase.from('paiements').insert([{
          facture_id: invoice.id,
          montant: selectedOrder.total_amount,
          method: paymentMethod === 'cash' ? 'ESPECE' : 'MOBILE_MONEY',
          reference: paymentRef || null
        }]);
      }

      if (selectedOrder.commande_items) {
        for (const item of selectedOrder.commande_items) {
          if (item.item_type !== 'product') continue;

          const { data: stockData } = await supabase
            .from('stocks')
            .select('id, quantity')
            .eq('product_id', item.item_id)
            .eq('depot_id', selectedDepotId)
            .maybeSingle();

          if (stockData) {
            const newQuantity = Math.max(0, Number(stockData.quantity) - Number(item.quantity));
            await supabase
              .from('stocks')
              .update({ quantity: newQuantity })
              .eq('id', stockData.id);
          }

          await supabase.from('stock_movements').insert([{
            product_id: item.item_id,
            type: 'out',
            quantity: item.quantity,
            price_at_movement: item.unit_price,
            reason: `Vente Restaurant (Table ${selectedOrder.table_name})`,
            user_id: session?.user?.id,
            depot_id: selectedDepotId
          }]);
        }
      }

      alert('Encaissement réussi !');
      
      // Prepare invoice preview data
      console.log('Finalizing payment, invoiceNumber:', invoiceNumber);
      setPreviewInvoice({
        table_name: selectedOrder.table_name,
        invoice_number: invoiceNumber,
        items: selectedOrder.commande_items.map(item => ({
            name: item.produits?.name || 'Article',
            quantity: item.quantity,
            price: item.unit_price,
            total: item.quantity * item.unit_price
        })),
        total_amount: selectedOrder.total_amount,
        payment_method: paymentMethod,
        payment_ref: paymentRef,
        date: new Date().toLocaleString('fr-FR')
      });

      setSelectedOrder(null);
      setPaymentMethod('cash');
      setPaymentRef('');
      setPaymentPhone('');
      fetchOrders();
    } catch (e) {
      alert("Erreur lors de l'encaissement : " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };


  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-red-600" size={40} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden selection:bg-red-200">
      <div className="flex flex-col lg:flex-row h-full overflow-hidden">
        
        {/* Left Sidebar: Active Orders */}
        <div className={`w-full lg:w-72 xl:w-80 flex flex-col gap-4 p-4 md:p-6 border-r border-gray-200 bg-white shrink-0 ${selectedOrder ? 'hidden lg:flex' : 'flex'}`}>
          <div className="shrink-0 px-2">
            <h3 className="text-xl font-bold text-gray-800 uppercase tracking-tight flex items-center gap-3">
              <LayoutGrid className="text-red-600" size={22} /> Commandes
            </h3>
            <p className="text-[9px] font-semibold text-gray-400 uppercase mt-1 tracking-widest">Suivi & Encaissement</p>
          </div>
          
          <div className="relative shrink-0">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="N° de Table..." 
                className="w-full pl-11 pr-4 py-2.5 bg-gray-50 rounded-xl font-semibold outline-none border-2 border-transparent focus:border-red-500 transition-all text-sm shadow-inner"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar pb-10">
            {filteredOrders.length > 0 ? filteredOrders.map(order => (
              <button
                key={order.id}
                onClick={() => {
                  setSelectedOrder(order);
                  setPaymentMethod('cash');
                }}
                className={`w-full p-4 rounded-xl text-left transition-all border-2 flex justify-between items-center group active:scale-[0.98] ${
                  selectedOrder?.id === order.id 
                  ? 'bg-red-600 text-white border-red-600 shadow-lg shadow-red-200/50' 
                  : 'bg-white text-gray-800 border-gray-100 hover:border-red-100 hover:bg-red-50/30'
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="text-base font-bold tracking-tight uppercase">{order.table_name}</div>
                  <div className="text-[9px] font-black text-red-600 mb-0.5">{order.invoice_number}</div>
                  <div className={`flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest ${selectedOrder?.id === order.id ? 'text-white/60' : 'text-gray-400'}`}>
                    {order.status === 'ready' ? <CheckCircle size={8} /> : <Clock size={8} />}
                    {order.status === 'ready' ? 'Prête' : 'En Cuisine'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="text-sm font-bold tracking-tight">{Number(order.total_amount || 0).toLocaleString()} Ar</div>
                  <span className={`text-[7px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                    order.status === 'ready' 
                    ? (selectedOrder?.id === order.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700')
                    : (selectedOrder?.id === order.id ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700')
                  }`}>
                    {order.status === 'ready' ? 'PRÊT' : 'EN COURS'}
                  </span>
                </div>
              </button>
            )) : (
              <div className="flex flex-col items-center justify-center py-20 text-gray-300 opacity-40">
                <Utensils size={40} className="mb-3" />
                <p className="font-bold uppercase tracking-[0.2em] text-[9px]">Aucune commande</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Content: Details & Payment */}
        <div className={`flex-1 flex flex-col bg-gray-50 overflow-hidden ${!selectedOrder ? 'hidden lg:flex' : 'flex'}`}>
          {selectedOrder ? (
            <div className="flex-1 flex flex-col min-h-0 animate-in fade-in slide-in-from-right duration-300">
              {/* Header section (adapted for smaller screens) */}
              <div className="p-6 md:p-8 bg-gray-900 text-white shrink-0 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                   <CreditCard size={120} />
                </div>
                
                <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                  <div className="space-y-2">
                    <button 
                      onClick={() => setSelectedOrder(null)}
                      className="lg:hidden flex items-center gap-2 text-gray-400 font-bold text-[10px] uppercase tracking-widest mb-3 bg-white/5 px-3 py-1.5 rounded-xl"
                    >
                      <X size={14} /> Retour à la liste
                    </button>
                    
                    <div className="flex items-center gap-2">
                      <span className="bg-red-600 text-white px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest shadow-lg shadow-red-900/50">Details</span>
                      <span className="text-gray-500 font-semibold text-[9px] uppercase tracking-[0.2em]">REF: {selectedOrder.id.slice(-6).toUpperCase()}</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold uppercase tracking-tight leading-none">{selectedOrder.table_name}</h2>
                    <div className="flex items-center gap-3">
                       <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest ${
                         selectedOrder.status === 'ready' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-orange-500/20 text-orange-500'
                       }`}>
                         {selectedOrder.status === 'ready' ? <CheckCircle size={10} /> : <Clock size={10} />}
                         {selectedOrder.status === 'ready' ? 'Prêt' : 'En Cuisine'}
                       </div>
                    </div>
                  </div>
                  
                  <div className="bg-white/5 backdrop-blur-md p-4 md:p-6 rounded-[1.5rem] border border-white/5 flex flex-col items-end min-w-[200px]">
                    <p className="text-[8px] font-bold text-gray-500 uppercase tracking-[0.3em] mb-1">Total à encaisser</p>
                    <div className="flex items-end gap-1">
                      <span className="text-3xl md:text-4xl font-bold text-white tracking-tight leading-none">{Number(selectedOrder.total_amount || 0).toLocaleString()}</span>
                      <span className="text-sm font-bold text-red-500 mb-0.5 uppercase">Ar</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Section (scrollable content) */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                   {/* Items List (adapted) */}
                   <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-gray-200"></div>
                        <h4 className="text-[8px] font-bold text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">Articles</h4>
                        <div className="h-px flex-1 bg-gray-200"></div>
                      </div>
                      <div className="grid gap-1.5 max-h-32 md:max-h-48 overflow-y-auto pr-1 no-scrollbar">
                        {selectedOrder.commande_items.map(item => (
                          <div key={item.id} className="bg-white p-3 rounded-xl border border-gray-100 flex justify-between items-center text-[13px]">
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-gray-700 uppercase truncate pr-4">{item.produits?.name}</span>
                                {item.produits?.contains_pork !== undefined && (
                                    item.produits?.contains_pork ? (
                                        <span className="text-[8px] font-black text-red-600 bg-red-50 px-1 rounded">AP</span>
                                    ) : (
                                        <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1 rounded">SP</span>
                                    )
                                )}
                            </div>
                            <span className="text-gray-400 whitespace-nowrap">x{item.quantity} • {Number(item.quantity * item.unit_price).toLocaleString()} Ar</span>
                          </div>
                        ))}
                      </div>
                   </div>

                   {/* Payment Method Choice */}
                   <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-gray-200"></div>
                        <h4 className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">Mode de Paiement</h4>
                        <div className="h-px flex-1 bg-gray-200"></div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                         <button 
                          onClick={() => setPaymentMethod('cash')}
                          className={`p-6 rounded-[1.5rem] border-2 transition-all flex flex-col items-center gap-3 ${
                            paymentMethod === 'cash' 
                            ? 'bg-red-50 border-red-500 text-red-600 shadow-md' 
                            : 'bg-white border-gray-100 text-gray-400 hover:border-red-100'
                          }`}
                         >
                           <Utensils size={32} />
                           <span className="font-bold uppercase tracking-widest text-xs">Espèces</span>
                         </button>
                         <button 
                          onClick={() => setPaymentMethod('m_money')}
                          className={`p-6 rounded-[1.5rem] border-2 transition-all flex flex-col items-center gap-3 ${
                            paymentMethod === 'm_money' 
                            ? 'bg-red-50 border-red-500 text-red-600 shadow-md' 
                            : 'bg-white border-gray-100 text-gray-400 hover:border-red-100'
                          }`}
                         >
                           <CreditCard size={32} />
                           <span className="font-bold uppercase tracking-widest text-xs">Mobile Money</span>
                         </button>
                      </div>

                      {/* Mobile Money Fields */}
                      {paymentMethod === 'm_money' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-4 duration-300">
                          <div className="space-y-2">
                             <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-4">Référence Transaction</label>
                             <input 
                              type="text" 
                              placeholder="Ex: 57483920..."
                              className="w-full bg-white border-2 border-gray-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-red-500 transition-all shadow-sm"
                              value={paymentRef}
                              onChange={(e) => setPaymentRef(e.target.value)}
                             />
                          </div>
                          <div className="space-y-2">
                             <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-4">Numéro de Téléphone</label>
                             <input 
                              type="text" 
                              placeholder="03x xx xxx xx"
                              className="w-full bg-white border-2 border-gray-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-red-500 transition-all shadow-sm"
                              value={paymentPhone}
                              onChange={(e) => setPaymentPhone(e.target.value)}
                             />
                          </div>
                        </div>
                      )}
                   </div>
                </div>
              </div>

              {/* Bottom Payment Actions */}
              <div className="p-6 md:p-8 bg-white border-t border-gray-200 shrink-0">
                <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-5">
                  {selectedOrder.status !== 'ready' && (
                    <div className="flex-1 flex items-center gap-3 bg-orange-50 p-5 rounded-2xl border border-orange-100 text-orange-700">
                       <AlertCircle size={24} />
                       <p className="font-semibold text-xs leading-tight">Cette commande est toujours en préparation en cuisine. Attendez qu'elle soit prête avant l'encaissement.</p>
                    </div>
                  )}
                  
                  <button
                    onClick={handleFinalizePayment}
                    disabled={isProcessing || selectedOrder.status !== 'ready'}
                    className={`flex-[2] py-6 rounded-2xl font-bold text-xl md:text-2xl uppercase tracking-widest flex items-center justify-center gap-4 shadow-xl transition-all relative overflow-hidden group ${
                        selectedOrder.status !== 'ready' 
                        ? 'bg-gray-100 text-gray-300 cursor-not-allowed shadow-none' 
                        : 'bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white shadow-red-900/20'
                    }`}
                  >
                    {isProcessing ? <Loader2 className="animate-spin" size={28} /> : (
                      <>
                        <CheckCircle size={28} className="group-hover:rotate-6 transition-transform" />
                        <span>FINALISER {Number(selectedOrder.total_amount || 0).toLocaleString()} Ar</span>
                      </>
                    )}
                    <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  </button>
                  
                  <button 
                    onClick={() => setSelectedOrder(null)}
                    className="md:hidden flex-1 py-5 rounded-2xl font-bold text-gray-400 uppercase tracking-widest border-2 border-gray-100"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 p-10">
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-red-600/5 blur-[80px] rounded-full scale-125"></div>
                <div className="w-48 h-48 bg-white rounded-[2.5rem] flex items-center justify-center shadow-2xl relative z-10">
                  <CreditCard size={80} className="text-gray-100" />
                </div>
                <div className="absolute -bottom-4 -right-4 w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-lg rotate-12">
                  <Utensils size={28} />
                </div>
              </div>
              <div className="text-center max-w-sm space-y-3">
                <h3 className="text-3xl font-bold text-gray-800 uppercase tracking-tight">Caisse Restaurant</h3>
                <p className="text-gray-400 font-semibold leading-relaxed uppercase tracking-widest text-[9px]">Sélectionnez une table à gauche pour procéder à l'encaissement et finaliser la vente.</p>
                <div className="pt-6 flex items-center justify-center gap-2">
                   <div className="h-px w-6 bg-gray-200"></div>
                   <LayoutGrid size={16} className="text-red-600" />
                   <div className="h-px w-6 bg-gray-200"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Ticket Preview Modal */}
      {previewInvoice && createPortal(
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
              #printable-invoice-ticket {
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
               <h3 className="font-black uppercase text-xs tracking-widest text-gray-400">Facture Client</h3>
               <button onClick={() => setPreviewInvoice(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={20}/></button>
            </div>

            <div id="printable-invoice-ticket" className="flex-1 overflow-y-auto p-8 font-mono text-[14px]">
               <div className="text-center mb-6">
                  {/* Logo - assuming logo.jpeg exists in public/ */}
                  <div className="flex justify-center mb-4">
                     <img src="/logo.jpeg" alt="Logo" className="w-20 h-20 object-cover rounded-full border-2 border-black" onError={(e) => e.target.style.display='none'} />
                  </div>
                  <h2 className="text-xl font-black uppercase mb-1">{currentDepotInfo?.name || 'Extrême Buritos'}</h2>
                  <p className="text-[10px] uppercase opacity-60 font-bold">{currentDepotInfo?.address || 'Antananarivo'}</p>
                  <p className="text-[10px] uppercase opacity-60 font-bold">Tél: {currentDepotInfo?.phone || '---'}</p>
                  
                  <div className="my-4 border-t border-dashed border-black/20"></div>
                  
                  <div className="bg-gray-100 py-3 px-4 rounded-xl space-y-1 mb-4">
                      <h3 className="font-black text-lg uppercase leading-none">FACTURE</h3>
                      <p className="text-xs font-black text-red-600">N° {previewInvoice.invoice_number}</p>
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase opacity-60 pt-1">
                          <span>{previewInvoice.table_name}</span>
                          <span>{previewInvoice.date.split(' ')[0]}</span>
                      </div>
                  </div>
               </div>

               <div className="space-y-3">
                  <div className="flex justify-between font-black text-[10px] uppercase border-b-2 border-black pb-1">
                     <span>Désignation</span>
                     <span className="pr-2">Total</span>
                  </div>
                  {previewInvoice.items.map((item, idx) => (
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
                      <span className="text-[10px] font-black uppercase opacity-60">TOTAL À PAYER</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black">{previewInvoice.total_amount.toLocaleString()}</span>
                        <span className="text-sm font-bold uppercase">Ar</span>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 px-2">
                      <div className="flex flex-col">
                          <span className="text-[8px] font-black uppercase opacity-40">Mode</span>
                          <span className="text-[10px] font-black uppercase">{previewInvoice.payment_method === 'cash' ? 'Espèces' : 'Mobile Money'}</span>
                      </div>
                      <div className="flex flex-col text-right">
                          <span className="text-[8px] font-black uppercase opacity-40">Heure</span>
                          <span className="text-[10px] font-black uppercase">{previewInvoice.date.split(' ')[1]}</span>
                      </div>
                  </div>
               </div>

               <div className="mt-8 text-center text-[10px] uppercase opacity-40 font-bold border-t border-dashed border-black/20 pt-4">
                  <p>*** Merci de votre visite ***</p>
                  <p>À bientôt chez nous !</p>
               </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-4 no-print">
               <button 
                onClick={() => window.print()}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-200"
               >
                 <Printer size={18}/> Imprimer Facture
               </button>
               <button 
                onClick={() => setPreviewInvoice(null)}
                className="flex-1 py-4 bg-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-gray-300 transition-all"
               >
                 Fermer
               </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

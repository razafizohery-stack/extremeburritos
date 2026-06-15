import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Loader2, Plus, X } from 'lucide-react';

export default function MenuEditor({ menu, onSave }) {
  const [formData, setFormData] = useState(menu || { name: '', price: '', description: '', items: [], category_id: '', contains_pork: false });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchDependencies = async () => {
      const [prodRes, catRes] = await Promise.all([
        supabase.from('produits').select('id, name').order('name'),
        supabase.from('categories').select('id, name').eq('type', 'menu').order('name')
      ]);
      if (prodRes.data) setProducts(prodRes.data);
      if (catRes.data) setCategories(catRes.data);
    };
    fetchDependencies();
    
    // Si on édite un menu, charger ses items actuels
    if (menu) {
        const fetchItems = async () => {
            const { data } = await supabase
                .from('menu_items')
                .select('produit_id, produits(id, name)')
                .eq('menu_id', menu.id);
            if (data) {
                setFormData(prev => ({ ...prev, items: data.map(d => d.produits) }));
            }
        };
        fetchItems();
    }
  }, [menu]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const menuData = { 
        name: formData.name, 
        price: formData.price, 
        description: formData.description,
        category_id: formData.category_id || null,
        contains_pork: formData.contains_pork || false
    };

    try {
        if (menu) {
          // Update
          const { error: updateError } = await supabase.from('menus').update(menuData).eq('id', menu.id);
          if (updateError) throw updateError;
          
          await supabase.from('menu_items').delete().eq('menu_id', menu.id);
          const { error: itemsError } = await supabase.from('menu_items').insert(formData.items.map(item => ({ menu_id: menu.id, produit_id: item.id })));
          if (itemsError) throw itemsError;
        } else {
          // Create
          const { data: newMenu, error: insertError } = await supabase.from('menus').insert(menuData).select().single();
          if (insertError) throw insertError;
          
          const { error: itemsError } = await supabase.from('menu_items').insert(formData.items.map(item => ({ menu_id: newMenu.id, produit_id: item.id })));
          if (itemsError) throw itemsError;
        }
    } catch (error) {
        console.error("Menu save error:", error);
        alert("Erreur lors de l'enregistrement : " + error.message);
    }
    
    setLoading(false);
    onSave();
  };

  const addItem = (productId) => {
    const prod = products.find(p => p.id === productId);
    if (prod && !formData.items.find(i => i.id === productId)) {
        setFormData({...formData, items: [...formData.items, prod]});
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <input required placeholder="Nom du menu" className="col-span-2 p-4 bg-gray-50 rounded-xl outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
        <input required type="number" placeholder="Prix (Ar)" className="p-4 bg-gray-50 rounded-xl outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
        <select className="p-4 bg-gray-50 rounded-xl outline-none" value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})}>
            <option value="">Choisir une catégorie...</option>
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
        <label className="flex items-center gap-2 col-span-2 p-4 bg-gray-50 rounded-xl cursor-pointer">
            <input 
                type="checkbox" 
                className="w-5 h-5"
                checked={formData.contains_pork} 
                onChange={e => setFormData({...formData, contains_pork: e.target.checked})} 
            />
            <span className="font-bold text-gray-800">Contient du porc</span>
        </label>
        <input placeholder="Description" className="col-span-2 p-4 bg-gray-50 rounded-xl outline-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
      </div>

      <div className="space-y-4">
        <label className="block font-black text-gray-400 uppercase text-xs">Ajouter des produits au menu</label>
        <select onChange={(e) => addItem(e.target.value)} className="w-full p-4 bg-gray-50 rounded-xl outline-none">
            <option value="">Choisir un produit...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
            {(formData.items || []).map(item => (
                <div key={item.id} className="flex items-center gap-2 bg-red-100 text-red-700 px-3 py-1 rounded-full font-bold text-sm">
                    {item.name}
                    <button type="button" onClick={() => setFormData({...formData, items: (formData.items || []).filter(i => i.id !== item.id)})}><X size={14}/></button>
                </div>
            ))}
        </div>
      </div>

      <button disabled={loading} className="w-full bg-red-600 text-white p-4 rounded-xl font-black uppercase shadow-lg shadow-red-200">
        {loading ? <Loader2 className="animate-spin mx-auto"/> : 'Enregistrer le menu'}
      </button>
    </form>
  );
}

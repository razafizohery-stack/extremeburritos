import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Plus, Trash2, Save, Loader2, Package, Layers } from 'lucide-react';

export default function RecipeManager() {
  const [products, setProducts] = useState([]);
  const [menus, setMenus] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [ingredients, setIngredients] = useState([]);
  const [newIngredient, setNewIngredient] = useState({ ingredient_id: '', quantite_requise: '', unite_deduction: 'g' });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [prodsRes, menusRes] = await Promise.all([
        supabase.from('produits').select('id, name, type, unite_base, unite_superieure').order('name'),
        supabase.from('menus').select('id, name').order('name')
    ]);
    setProducts(prodsRes.data || []);
    setMenus(menusRes.data || []);
    setLoading(false);
  };

  const fetchRecipe = async (menuId) => {
    if (!menuId) {
      setIngredients([]);
      return;
    }
    const { data } = await supabase
      .from('recettes')
      .select('*, ingredient:ingredient_id(name)')
      .eq('produit_fini_id', menuId);
    setIngredients(data || []);
  };

  const handleIngredientChange = (e) => {
    const ingId = e.target.value;
    setNewIngredient({...newIngredient, ingredient_id: ingId});
    const ing = products.find(p => p.id === ingId);
    setSelectedIngredient(ing || null);
    if (ing) {
        setNewIngredient(prev => ({...prev, unite_deduction: ing.unite_base || 'g'}));
    }
  };

  const addIngredient = () => {
    if (!newIngredient.ingredient_id || !newIngredient.quantite_requise) return;
    const ingredient = products.find(p => p.id === newIngredient.ingredient_id);
    setIngredients([...ingredients, { ...newIngredient, ingredient: { name: ingredient.name } }]);
    setNewIngredient({ ingredient_id: '', quantite_requise: '', unite_deduction: 'g' });
    setSelectedIngredient(null);
  };

  const removeIngredient = (index) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const saveRecipe = async () => {
    setIsSaving(true);
    // Delete existing recipe
    await supabase.from('recettes').delete().eq('produit_fini_id', selectedProduct);
    // Insert new
    const toInsert = ingredients.map(ing => ({
      produit_fini_id: selectedProduct,
      ingredient_id: ing.ingredient_id,
      quantite_requise: parseFloat(ing.quantite_requise),
      unite_deduction: ing.unite_deduction
    }));
    const { error } = await supabase.from('recettes').insert(toInsert);
    setIsSaving(false);
    if (error) alert("Erreur: " + error.message);
    else alert("Recette enregistrée !");
  };

  return (
    <div className="p-8 space-y-6">
      <h2 className="text-3xl font-black text-gray-800">Gestion des Recettes</h2>
      
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <label className="block text-sm font-bold text-gray-500 uppercase tracking-widest">Sélectionner le Menu</label>
        <select 
          className="w-full bg-gray-50 rounded-xl px-4 py-3 font-bold"
          value={selectedProduct}
          onChange={e => { setSelectedProduct(e.target.value); fetchRecipe(e.target.value); }}
        >
          <option value="">Choisir un menu...</option>
          {menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {selectedProduct && (
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <select 
              className="md:col-span-2 bg-gray-50 rounded-xl px-4 py-3 font-bold"
              value={newIngredient.ingredient_id}
              onChange={handleIngredientChange}
            >
              <option value="">Sélectionner ingrédient...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input 
              type="number" placeholder="Quantité" className="bg-gray-50 rounded-xl px-4 py-3 font-bold"
              value={newIngredient.quantite_requise} onChange={e => setNewIngredient({...newIngredient, quantite_requise: e.target.value})}
            />
            <div className="bg-gray-50 rounded-xl px-4 py-3 font-bold flex items-center justify-center text-sm">
              {selectedIngredient ? `${selectedIngredient.unite_base || 'Unité'} / ${selectedIngredient.unite_superieure || 'Colis'}` : 'Unité'}
            </div>
          </div>
          <button 
            onClick={addIngredient} 
            disabled={!selectedProduct}
            className={`w-full bg-red-600 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2 ${!selectedProduct ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Plus size={20} /> Ajouter à la recette
          </button>
          
          <div className="space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex justify-between items-center bg-gray-50 p-4 rounded-xl">
                <span className="font-bold text-gray-800">{ing.ingredient?.name}</span>
                <div className="flex items-center gap-4">
                  <span className="font-black text-red-600">{ing.quantite_requise} {ing.unite_deduction}</span>
                  <button onClick={() => removeIngredient(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={18} /></button>
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={saveRecipe} 
            disabled={isSaving || ingredients.length === 0} 
            className={`w-full bg-emerald-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 text-lg ${isSaving || ingredients.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSaving ? <Loader2 className="animate-spin" /> : <><Save size={20} /> Enregistrer la recette</>}
          </button>
        </div>
      )}
    </div>
  );
}


import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Search, Package, ArrowDownCircle, ArrowUpCircle, Filter, Calendar } from 'lucide-react';

export default function StockMovementsHistory() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [filters, setFilters] = useState({
    depot_id: '',
    type: '',
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [depots, setDepots] = useState([]);

  useEffect(() => {
    fetchDepots();
    fetchMovements();
  }, [filters.startDate, filters.endDate]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.depot_id, filters.type]);

  const fetchDepots = async () => {
    const { data } = await supabase.from('depots').select('*');
    setDepots(data || []);
  };

  const fetchMovements = async () => {
    setLoading(true);
    let query = supabase
      .from('stock_movements')
      .select(`
        *,
        produits (name, unite_base, unite_superieure)
      `)
      .gte('created_at', `${filters.startDate}T00:00:00`)
      .lte('created_at', `${filters.endDate}T23:59:59`)
      .order('created_at', { ascending: false });

    if (filters.depot_id) query = query.eq('depot_id', filters.depot_id);
    if (filters.type) query = query.eq('type', filters.type);

    const { data, error } = await query;
    if (error) console.error("Error:", error);
    else setMovements(data || []);
    setLoading(false);
  };

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentMovements = movements.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(movements.length / itemsPerPage);

  return (
    <div className="p-8 space-y-6">
      <div className="bg-white/60 backdrop-blur-md border border-gray-100 rounded-3xl p-6 shadow-sm">
        <h1 className="text-3xl font-black text-gray-800 tracking-tight mb-6">Transparence des Mouvements</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input type="date" className="bg-gray-50 border-0 rounded-2xl px-4 py-3 font-bold" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} />
          <input type="date" className="bg-gray-50 border-0 rounded-2xl px-4 py-3 font-bold" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} />
          <select className="bg-gray-50 border-0 rounded-2xl px-4 py-3 font-bold" value={filters.depot_id} onChange={e => setFilters({...filters, depot_id: e.target.value})}>
            <option value="">Tous les Dépôts</option>
            {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="bg-gray-50 border-0 rounded-2xl px-4 py-3 font-bold" value={filters.type} onChange={e => setFilters({...filters, type: e.target.value})}>
            <option value="">Tous les Types</option>
            <option value="in">Entrées</option>
            <option value="out">Sorties</option>
          </select>
          <button onClick={fetchMovements} className="bg-red-600 text-white font-black rounded-2xl px-6 py-3 hover:bg-red-700">Filtrer</button>
        </div>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-50/50 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50/90 backdrop-blur-sm">
            <tr>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Date</th>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Produit</th>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Type</th>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Quantité</th>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Motif</th>
              <th className="px-6 py-4 font-bold text-gray-400 uppercase">Dépôt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
                <tr><td colSpan="6" className="p-10 text-center font-bold">Chargement...</td></tr>
            ) : currentMovements.length > 0 ? currentMovements.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="px-6 py-4 font-bold text-gray-600">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-6 py-4 font-bold text-gray-900">{m.produits?.name}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase ${m.type === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {m.type === 'in' ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                    {m.type === 'in' ? 'Entrée' : 'Sortie'}
                  </span>
                </td>
                <td className="px-6 py-4 font-black text-lg">
                  {m.quantity} <span className="text-sm font-medium text-gray-500">{m.produits?.unite_base || 'Unité'}</span>
                </td>
                <td className="px-6 py-4 text-gray-500 font-medium">{m.reason}</td>
                <td className="px-6 py-4 text-gray-600 font-bold">{m.depot_id ? (depots.find(d => d.id === m.depot_id)?.name || 'Inconnu') : m.destination_depot || '-'}</td>
              </tr>
            )) : (
              <tr><td colSpan="6" className="p-10 text-center font-bold text-gray-500">Aucun mouvement trouvé.</td></tr>
            )}
          </tbody>
        </table>
        
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-6 border-t border-gray-100">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="px-4 py-2 bg-gray-100 rounded-xl font-bold disabled:opacity-50"
            >
              Précédent
            </button>
            <span className="font-black text-lg">{currentPage} / {totalPages}</span>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="px-4 py-2 bg-gray-100 rounded-xl font-bold disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

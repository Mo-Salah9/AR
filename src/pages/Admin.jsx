import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const BLANK = { keyword: '', url: 'https://', active: true };

export default function Admin() {
  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(BLANK);
  const [editId,  setEditId]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('rules')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setRules(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function beginEdit(rule) {
    setEditId(rule.id);
    setForm({ keyword: rule.keyword, url: rule.url, active: rule.active });
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setForm(BLANK);
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.keyword.trim())                       { setError('Keyword is required.');      return; }
    if (!form.url.trim() || form.url === 'https://') { setError('A valid URL is required.'); return; }

    setSaving(true);
    setError(null);

    const payload = {
      keyword: form.keyword.trim(),
      url:     form.url.trim(),
      active:  form.active,
    };

    const { error } = editId
      ? await supabase.from('rules').update(payload).eq('id', editId)
      : await supabase.from('rules').insert(payload);

    if (error) { setError(error.message); setSaving(false); return; }

    cancelEdit();
    await load();
    setSaving(false);
  }

  async function remove(id) {
    if (!window.confirm('Delete this rule?')) return;
    const { error } = await supabase.from('rules').delete().eq('id', id);
    if (error) setError(error.message);
    else setRules(prev => prev.filter(r => r.id !== id));
  }

  async function toggleActive(rule) {
    const { error } = await supabase
      .from('rules')
      .update({ active: !rule.active })
      .eq('id', rule.id);
    if (error) setError(error.message);
    else setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
  }

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>AR Scanner — Admin Panel</h1>
        <Link to="/" className="btn-secondary">← Scanner</Link>
      </header>

      <main className="admin-main">

        {/* ── Form ── */}
        <section className="card">
          <h2>{editId ? 'Edit Rule' : 'New Rule'}</h2>

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={submit}>
            <div className="form-row">
              <label>
                Keyword
                <input
                  type="text"
                  placeholder="e.g. 2025"
                  value={form.keyword}
                  onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                />
              </label>

              <label>
                URL to open
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                />
              </label>

              <div className="toggle-wrap">
                Active
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Update Rule' : 'Add Rule'}
              </button>
              {editId && (
                <button type="button" className="btn-ghost" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        {/* ── Table ── */}
        <section className="card">
          <h2>All Rules ({rules.length})</h2>

          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
          ) : rules.length === 0 ? (
            <div className="empty-state">No rules yet. Add one above.</div>
          ) : (
            <table className="rules-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className={rule.active ? '' : 'inactive'}>
                    <td><code>{rule.keyword}</code></td>
                    <td className="url-cell">
                      <a href={rule.url} target="_blank" rel="noopener noreferrer">
                        {rule.url}
                      </a>
                    </td>
                    <td>
                      <button
                        className={`badge ${rule.active ? 'active' : 'inactive'}`}
                        onClick={() => toggleActive(rule)}
                        title="Click to toggle"
                      >
                        {rule.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="actions">
                      <button className="btn-sm" onClick={() => beginEdit(rule)}>Edit</button>
                      <button className="btn-sm danger" onClick={() => remove(rule.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

      </main>
    </div>
  );
}

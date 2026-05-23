import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const BLANK = { keyword: '', url: '', active: true, image_url: null, model_url: null };

async function uploadFile(bucket, file) {
  const ext = file.name.split('.').pop();
  const path = `${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

export default function Admin() {
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [form,       setForm]       = useState(BLANK);
  const [editId,     setEditId]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState(null);
  const [imageFile,  setImageFile]  = useState(null);
  const [modelFile,  setModelFile]  = useState(null);
  const [imgPreview, setImgPreview] = useState(null);

  const imageInputRef = useRef(null);
  const modelInputRef = useRef(null);

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
    setForm({ keyword: rule.keyword, url: rule.url ?? '', active: rule.active, image_url: rule.image_url, model_url: rule.model_url });
    setImageFile(null);
    setModelFile(null);
    setImgPreview(rule.image_url ?? null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setForm(BLANK);
    setImageFile(null);
    setModelFile(null);
    setImgPreview(null);
    setError(null);
  }

  function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImgPreview(URL.createObjectURL(file));
  }

  function pickModel(e) {
    const file = e.target.files?.[0];
    if (file) setModelFile(file);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.keyword.trim()) { setError('Keyword / name is required.'); return; }

    setSaving(true);
    setError(null);

    let image_url = form.image_url;
    let model_url = form.model_url;

    try {
      if (imageFile) image_url = await uploadFile('markers', imageFile);
      if (modelFile) model_url = await uploadFile('models', modelFile);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    const payload = {
      keyword:   form.keyword.trim(),
      url:       form.url.trim() || null,
      active:    form.active,
      image_url: image_url ?? null,
      model_url: model_url ?? null,
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
            {/* Row 1: keyword + URL + active */}
            <div className="form-row">
              <label>
                Keyword / Name
                <input
                  type="text"
                  placeholder="e.g. ProductA"
                  value={form.keyword}
                  onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                />
              </label>

              <label>
                URL to open <span className="field-optional">(optional)</span>
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

            {/* Row 2: image upload + model upload */}
            <div className="form-row upload-row">
              <div className="upload-field">
                <span className="upload-field-label">
                  Marker Image <span className="field-optional">(for image detection)</span>
                </span>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={pickImage}
                />
                <button
                  type="button"
                  className="upload-btn"
                  onClick={() => imageInputRef.current.click()}
                >
                  {imgPreview ? 'Change Image' : 'Upload Image'}
                </button>
                {imgPreview && (
                  <img src={imgPreview} alt="marker preview" className="img-preview" />
                )}
                {!imgPreview && form.image_url && (
                  <span className="file-badge">Image saved</span>
                )}
              </div>

              <div className="upload-field">
                <span className="upload-field-label">
                  3D Model (.glb) <span className="field-optional">(shown when detected)</span>
                </span>
                <input
                  ref={modelInputRef}
                  type="file"
                  accept=".glb,.gltf"
                  onChange={pickModel}
                />
                <button
                  type="button"
                  className="upload-btn"
                  onClick={() => modelInputRef.current.click()}
                >
                  {modelFile ? 'Change Model' : form.model_url ? 'Replace Model' : 'Upload Model'}
                </button>
                {modelFile && (
                  <span className="file-badge model">{modelFile.name}</span>
                )}
                {!modelFile && form.model_url && (
                  <span className="file-badge model">Model saved</span>
                )}
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
                  <th>Image</th>
                  <th>Model</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className={rule.active ? '' : 'inactive'}>
                    <td><code>{rule.keyword}</code></td>
                    <td>
                      {rule.image_url
                        ? <img src={rule.image_url} alt="" className="table-thumb" />
                        : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td>
                      {rule.model_url
                        ? <span className="file-badge model">3D</span>
                        : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td className="url-cell">
                      {rule.url
                        ? <a href={rule.url} target="_blank" rel="noopener noreferrer">{rule.url}</a>
                        : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      }
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

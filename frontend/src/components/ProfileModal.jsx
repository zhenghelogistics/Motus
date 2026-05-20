import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../lib/AuthContext'
import { getProfile, updateProfile } from '../api'

function SignatureCanvas({ value, onChange }) {
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPos = useRef(null)
  const [hasContent, setHasContent] = useState(false)

  // Load saved signature into canvas on mount
  useEffect(() => {
    if (value && canvasRef.current) {
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        setHasContent(true)
      }
      img.src = value
    }
  }, [])

  function getPos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const src = e.touches ? e.touches[0] : e
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    }
  }

  function startDraw(e) {
    e.preventDefault()
    isDrawing.current = true
    lastPos.current = getPos(e)
  }

  function draw(e) {
    if (!isDrawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
  }

  function stopDraw() {
    if (!isDrawing.current) return
    isDrawing.current = false
    setHasContent(true)
    onChange(canvasRef.current.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasContent(false)
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={480}
        height={140}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
        style={{
          width: '100%',
          height: 140,
          border: '1.5px solid var(--border-solid)',
          borderRadius: 8,
          cursor: 'crosshair',
          background: '#fff',
          touchAction: 'none',
          display: 'block',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        {hasContent && (
          <button className="btn btn-ghost btn-sm" onClick={clear} style={{ color: 'var(--red)' }}>
            Clear
          </button>
        )}
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          Upload Image
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = ev => {
                const canvas = canvasRef.current
                const ctx = canvas.getContext('2d')
                const img = new Image()
                img.onload = () => {
                  ctx.clearRect(0, 0, canvas.width, canvas.height)
                  // Scale image to fit canvas
                  const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.9
                  const x = (canvas.width - img.width * scale) / 2
                  const y = (canvas.height - img.height * scale) / 2
                  ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
                  setHasContent(true)
                  onChange(canvas.toDataURL('image/png'))
                }
                img.src = ev.target.result
              }
              reader.readAsDataURL(file)
              e.target.value = ''
            }}
          />
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Draw above or upload a PNG/JPG
        </span>
      </div>
    </div>
  )
}

export default function ProfileModal({ onClose }) {
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [designation, setDesignation] = useState('')
  const [signature, setSignature] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getProfile()
      .then(r => {
        setDisplayName(r.data.display_name || '')
        setDesignation(r.data.designation || '')
        setSignature(r.data.signature_data || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await updateProfile({ display_name: displayName, designation, signature_data: signature })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      alert('Failed to save: ' + (e?.response?.data?.error || e.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>My Account</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <span className="spinner spinner-dark" />
            </div>
          ) : (
            <>
              <div style={{
                fontSize: 12, color: 'var(--text-muted)', marginBottom: 20,
                padding: '8px 12px', background: 'var(--bg)', borderRadius: 7,
              }}>
                Signed in as <strong>{user?.email}</strong>
              </div>

              <div className="form-grid-2" style={{ marginBottom: 18 }}>
                <div className="form-group">
                  <label className="form-label">Display Name</label>
                  <input
                    className="form-control"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="e.g. Sarah Tan"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Appears on all exported PDFs
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Job Title / Designation</label>
                  <input
                    className="form-control"
                    value={designation}
                    onChange={e => setDesignation(e.target.value)}
                    placeholder="e.g. Operations Manager"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Shown under your name in PDFs
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Signature</label>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Draw your signature below — it will be embedded in all quotation and job PDFs.
                </p>
                <SignatureCanvas value={signature} onChange={setSignature} />
              </div>

              {signature && (
                <div style={{
                  marginTop: 16, padding: '12px 16px',
                  background: 'var(--bg)', borderRadius: 8,
                  border: '1px solid var(--border-solid)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    PDF Preview
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Yours sincerely</div>
                  <img src={signature} alt="signature" style={{ maxHeight: 50, display: 'block', marginBottom: 6, opacity: 0.9 }} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
                    {displayName || user?.email?.split('@')[0] || '—'}
                  </div>
                  {designation && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{designation}</div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)' }}>Zhenghe Logistics Pte Ltd</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving
              ? <><span className="spinner"></span> Saving...</>
              : saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

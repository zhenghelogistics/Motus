// Shared section heading + tinted sub-box wrapper used across detail views.
// Note: intentionally kept inline-styled (not the `.sub-box`/`.sub-box-label`
// CSS classes in index.css) because those classes use different padding,
// spacing, and label color — switching would change the visual output.

export function SectionHead({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  )
}

export function SectionBox({ children, style }) {
  return (
    <div style={{
      background: 'var(--sub-box-bg)', border: '1px solid var(--sub-box-border)',
      borderRadius: 10, padding: '14px 16px', marginBottom: 14, ...style,
    }}>
      {children}
    </div>
  )
}

import { Pencil } from 'lucide-react'
import type { Action, Product } from '../types'
import { useT } from '../context/LocaleContext'

type Props = {
  action: Action
  products: Product[]
  onEdit?: (action: Action) => void
}

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${day}/${month}`
}

function formatDetail(action: Action, products: Product[]): string {
  const product = products.find(p => p.id === action.product_id)
  if (!product) return '—'
  const qty = action.qty ? ` ${action.qty}` : ''
  const unit = action.unit ? `${action.unit}` : ''
  return `${product.name}${qty}${unit}`.trim() || '—'
}

function getActionBadgeClass(actionType: string): string {
  const t = actionType.toLowerCase()
  if (t.includes('cleaning') || t.includes('filter') || t.includes('cartridge')) return 'badge-ok'
  if (t.includes('ph') || t.includes('measurement') || t.includes('calibration')) return 'badge-warn'
  if (t.includes('add')) return 'badge-ok'
  return 'badge-ok'
}

export default function ActionEntry({ action, products, onEdit }: Props) {
  const { t } = useT()
  return (
    <tr>
      <td className="mono">{formatDate(action.date)}</td>
      <td>
        <span className={`badge-status ${getActionBadgeClass(action.action_type)}`}>
          {action.action_type}
        </span>
      </td>
      <td>{formatDetail(action, products)}</td>
      <td style={{ color: 'var(--pooly-muted)' }}>{action.notes || '—'}</td>
      <td style={{ width: 36, padding: '8px 8px 8px 4px', textAlign: 'center' }}>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(action)}
            title={t('modal_edit')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 4, color: 'var(--pooly-muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--pooly-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--pooly-muted)')}
          >
            <Pencil size={13} />
          </button>
        )}
      </td>
    </tr>
  )
}

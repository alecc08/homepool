import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Action, Recommendation, RecommendationsResponse } from '../types'
import { PARAM_GUIDANCE } from '../paramGuidance'
import { gramsToDisplay, mlToDisplay } from '../units'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { TranslationKey } from '../i18n/translations'
import SimulatorModal from './SimulatorModal'

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: '16px',
  marginBottom: 14,
}

function formatValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export default function RecommendationsPage({ actions }: { actions: Action[] }) {
  const { active } = useInstallation()
  const { t } = useT()
  const [data, setData] = useState<RecommendationsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSimulator, setShowSimulator] = useState(false)

  useEffect(() => {
    if (!active) return
    setLoading(true)
    fetch(`/api/installations/${active.id}/recommendations`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [active?.id])

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header-title">{t('recommendations_page_title')}</h1>
        <div className="page-header-actions">
          <Button type="button" variant="outline" onClick={() => setShowSimulator(true)}>
            {t('simulator_open_button')}
          </Button>
        </div>
      </div>

      <SimulatorModal open={showSimulator} onClose={() => setShowSimulator(false)} actions={actions} />

      {!loading && data && !data.volume_known && (
        <div style={{
          background: 'var(--status-warn-bg)', color: 'var(--status-warn-text)',
          border: '1px solid var(--status-warn-text)', borderRadius: 'var(--radius-md)',
          padding: '10px 14px', marginBottom: 14,
          fontFamily: '"Sora", sans-serif', fontSize: 12,
        }}>
          {t('recommendations_volume_unknown_banner')}
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--text-muted)' }}>
          {t('loading')}
        </div>
      )}

      {!loading && data && data.recommendations.length === 0 && (
        <div style={{ ...sectionCardStyle, textAlign: 'center' }}>
          <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-ok-text)', margin: 0 }}>
            {t('recommendations_empty')}
          </p>
        </div>
      )}

      {!loading && data && data.recommendations.map(rec => (
        <RecommendationCard key={rec.param} rec={rec} />
      ))}
    </div>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const { t } = useT()
  const guidance = PARAM_GUIDANCE[rec.param]
  const directionLabel = rec.direction === 'raise' ? t('recommendations_raise') : t('recommendations_lower')
  const directionColor = rec.direction === 'raise' ? 'var(--status-warn-text)' : 'var(--status-danger-text)'

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {guidance ? t(guidance.labelKey) : rec.param}
        </div>
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, fontWeight: 600,
          color: directionColor, background: 'var(--bg-surface-2)',
          padding: '2px 8px', borderRadius: 4,
        }}>
          {directionLabel}
        </span>
      </div>

      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {formatValue(rec.current_value)} → {formatValue(rec.target_value)}
        <span style={{ color: 'var(--text-muted)' }}> ({t('recommendations_target_label')})</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rec.options.map((opt, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface-2)',
          }}>
            {opt.product_id && (
              <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t(`dosage_product_${opt.product_id}` as TranslationKey)}
              </div>
            )}
            {opt.amount_grams !== null && (
              <AmountLine grams={opt.amount_grams} />
            )}
            {opt.amount_ml !== null && (
              <AmountLine mL={opt.amount_ml} />
            )}
            {opt.notes_key && (
              <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
                {t(opt.notes_key as TranslationKey)}
              </div>
            )}
            {opt.side_effect && (
              <SideEffectLine side={opt.side_effect} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// A product's secondary-parameter shift (issue #40): the translated caveat plus the
// signed estimate. pH shifts carry no unit; everything else is ppm.
function SideEffectLine({ side }: { side: NonNullable<Recommendation['options'][number]['side_effect']> }) {
  const { t } = useT()
  const sign = side.delta >= 0 ? '+' : '−'
  const magnitude = Math.abs(side.delta)
  const unit = side.param === 'ph' ? '' : ' ppm'
  return (
    <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>
      {t(side.notes_key as TranslationKey)} ({sign}{magnitude}{unit})
    </div>
  )
}

function AmountLine({ grams, mL }: { grams?: number; mL?: number }) {
  const { active } = useInstallation()
  const volumeUnit = active?.volume_unit
  const display = grams !== undefined ? gramsToDisplay(grams, volumeUnit) : mlToDisplay(mL as number, volumeUnit)
  return (
    <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
      {display.value} {display.unit === 'fl_oz' ? 'fl oz' : display.unit}
    </div>
  )
}

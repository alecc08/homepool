import { useState } from 'react'
import { Snowflake, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import { isSeasonOpen } from '../utils'

/** The pool/spa is closed for the season, so maintenance is paused and
 * chemistry alerts and dosing advice are silenced. The banner says so on every
 * page that would otherwise read as a quiet, well-kept pool — a paused pool and a
 * perfectly maintained one look identical in the data, and only the owner knows
 * which of the two is on the screen.
 *
 * Renders nothing while the pool is in season, so pages can place it
 * unconditionally. The Open button is owner-only: winterizing a pool is the
 * owner's call, same as every other installation setting (sharees read the state
 * in the installation sheet, SeasonBanner is not their lever). */
export default function SeasonBanner() {
  const { active, isOwner, refresh } = useInstallation()
  const { t } = useT()
  const [busy, setBusy] = useState(false)

  if (!active || isSeasonOpen(active)) return null

  const openPool = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/installations/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ is_open: true }),
      })
      if (res.ok) await refresh()
    } catch {
      /* leave the banner up; the owner can retry */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)',
        padding: '12px 14px', marginBottom: 14,
      }}
    >
      <span style={{
        width: 30, height: 30, borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: 'var(--bg-surface-2)', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Snowflake size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('season_closed_title')}
        </div>
        <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('season_closed_body')}
        </p>
      </div>
      {isOwner && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={openPool}
          style={{ flexShrink: 0 }}
        >
          <Sun size={14} strokeWidth={2} aria-hidden="true" />
          {t('season_open_pool')}
        </Button>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { TempUnit, SaltUnit, ConcUnit, HardnessUnit } from '../units'

type Props = {
  open: boolean
  onClose: () => void
}

export default function InstallationModal({ open, onClose }: Props) {
  const { t } = useT()
  const { addInstallation } = useInstallation()
  const [name, setName] = useState('')
  const [type, setType] = useState<'pool' | 'spa'>('pool')
  const [sanitizer, setSanitizer] = useState<'bromine' | 'chlorine' | 'salt'>('chlorine')
  const [volume, setVolume] = useState('')
  const [volumeUnit, setVolumeUnit] = useState<'L' | 'gal'>('L')
  const [tempUnit, setTempUnit] = useState<TempUnit>('C')
  const [saltUnit, setSaltUnit] = useState<SaltUnit>('ppm')
  const [concUnit, setConcUnit] = useState<ConcUnit>('mg/L')
  const [hardnessUnit, setHardnessUnit] = useState<HardnessUnit>('ppm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError(t('modal_install_nom_requis')); return }
    setLoading(true)
    setError(null)
    try {
      const parsedVolume = volume.trim() ? parseFloat(volume) : undefined
      await addInstallation({
        name: name.trim(),
        type,
        sanitizer,
        temp_unit: tempUnit,
        salt_unit: saltUnit,
        conc_unit: concUnit,
        hardness_unit: hardnessUnit,
        ...(parsedVolume !== undefined && !isNaN(parsedVolume) ? { volume: parsedVolume, volume_unit: volumeUnit } : {}),
      })
      setName('')
      setType('pool')
      setSanitizer('chlorine')
      setVolume('')
      setVolumeUnit('L')
      setTempUnit('C')
      setSaltUnit('ppm')
      setConcUnit('mg/L')
      setHardnessUnit('ppm')
      onClose()
    } catch {
      setError(t('modal_install_erreur_creation'))
    } finally {
      setLoading(false)
    }
  }

  const cardBase: React.CSSProperties = {
    flex: 1, padding: '14px 12px', borderRadius: 10, border: '2px solid',
    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
    transition: 'border-color 0.15s, background 0.15s',
  }

  const pillBase: React.CSSProperties = {
    flex: 1, padding: '8px 12px', borderRadius: 8, border: '2px solid',
    cursor: 'pointer', textAlign: 'center',
    fontFamily: '"Sora", sans-serif', fontSize: 12, fontWeight: 600,
    transition: 'border-color 0.15s, background 0.15s',
  }

  const unitRowLabel: React.CSSProperties = {
    flex: 1, fontFamily: '"Sora", sans-serif', fontSize: 12, color: 'var(--text-secondary)',
  }

  const unitPillStyle = (active: boolean): React.CSSProperties => ({
    ...pillBase,
    flex: 'none',
    minWidth: 48,
    padding: '5px 10px',
    fontSize: 11,
    borderColor: active ? 'rgba(56,189,248,0.35)' : 'var(--border)',
    background: active ? 'rgba(56,189,248,0.1)' : 'var(--bg-surface-2)',
    color: active ? '#38bdf8' : 'var(--text-secondary)',
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
            {t('modal_install_title')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 18, paddingTop: 4 }}>
          {/* Nom */}
          <div style={{ display: 'grid', gap: 6 }}>
            <Label htmlFor="inst-name">{t('modal_install_nom')}</Label>
            <Input
              id="inst-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('modal_install_nom_placeholder')}
            />
          </div>

          {/* Type */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_type')}</Label>
            <div style={{ display: 'flex', gap: 10 }}>
              {([['pool', '🏊', t('modal_install_piscine')], ['spa', '🛁', t('modal_install_spa')]] as const).map(([tp, icon, label]) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setType(tp)}
                  style={{
                    ...cardBase,
                    borderColor: type === tp ? 'rgba(56,189,248,0.35)' : 'var(--border)',
                    background: type === tp ? 'rgba(56,189,248,0.1)' : 'var(--bg-surface-2)',
                    color: type === tp ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{icon}</span>
                  {label.replace(/^.\s/, '')}
                </button>
              ))}
            </div>
          </div>

          {/* Désinfectant */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_desinfectant')}</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['chlorine', t('modal_install_chlore')], ['bromine', t('modal_install_brome')], ['salt', t('modal_install_sel')]] as const).map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSanitizer(s)}
                  style={{
                    ...pillBase,
                    borderColor: sanitizer === s ? 'rgba(56,189,248,0.35)' : 'var(--border)',
                    background: sanitizer === s ? 'rgba(56,189,248,0.1)' : 'var(--bg-surface-2)',
                    color: sanitizer === s ? '#38bdf8' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Capacité */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label htmlFor="inst-volume">{t('modal_install_capacite')}</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                id="inst-volume"
                type="number"
                min="0"
                step="any"
                value={volume}
                onChange={e => setVolume(e.target.value)}
                placeholder="45000"
                style={{ flex: 1 }}
              />
              {(['L', 'gal'] as const).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setVolumeUnit(u)}
                  style={{
                    ...pillBase,
                    flex: 'none',
                    minWidth: 56,
                    borderColor: volumeUnit === u ? 'rgba(56,189,248,0.35)' : 'var(--border)',
                    background: volumeUnit === u ? 'rgba(56,189,248,0.1)' : 'var(--bg-surface-2)',
                    color: volumeUnit === u ? '#38bdf8' : 'var(--text-secondary)',
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Unités de mesure */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_unites')}</Label>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={unitRowLabel}>{t('unit_temperature')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['C', 'F'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setTempUnit(u)} style={unitPillStyle(tempUnit === u)}>
                      °{u}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={unitRowLabel}>{t('unit_sel')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ppm', 'g/L'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setSaltUnit(u)} style={unitPillStyle(saltUnit === u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={unitRowLabel}>{t('unit_concentration')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['mg/L', 'ppm'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setConcUnit(u)} style={unitPillStyle(concUnit === u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={unitRowLabel}>{t('unit_durete')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ppm', '°dH', '°f'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setHardnessUnit(u)} style={unitPillStyle(hardnessUnit === u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? t('modal_install_creation') : t('modal_install_creer')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

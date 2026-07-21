import { useState } from 'react'
import { Waves, Bath } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import type { TempUnit, SaltUnit, ConcUnit, HardnessUnit } from '../units'
import type { Installation } from '../types'
import WaterChemistryTargets from './WaterChemistryTargets'

type Props = {
  open: boolean
  onClose: () => void
  installation?: Installation
}

type Tab = 'general' | 'water'

export default function InstallationModal({ open, onClose, installation }: Props) {
  const { t } = useT()
  const { addInstallation, refresh } = useInstallation()
  const isEdit = !!installation
  const [tab, setTab] = useState<Tab>('general')
  const [name, setName] = useState(installation?.name ?? '')
  const [type, setType] = useState<'pool' | 'spa'>(installation?.type ?? 'pool')
  const [sanitizer, setSanitizer] = useState<'bromine' | 'chlorine' | 'salt'>(installation?.sanitizer ?? 'chlorine')
  const [volume, setVolume] = useState(installation?.volume != null ? String(installation.volume) : '')
  const [volumeUnit, setVolumeUnit] = useState<'L' | 'gal'>(installation?.volume_unit ?? 'L')
  const [tempUnit, setTempUnit] = useState<TempUnit>(installation?.temp_unit ?? 'C')
  const [saltUnit, setSaltUnit] = useState<SaltUnit>(installation?.salt_unit ?? 'ppm')
  const [concUnit, setConcUnit] = useState<ConcUnit>(installation?.conc_unit ?? 'mg/L')
  const [hardnessUnit, setHardnessUnit] = useState<HardnessUnit>(installation?.hardness_unit ?? 'ppm')
  const [address, setAddress] = useState(installation?.address ?? '')
  const [contactName, setContactName] = useState(installation?.contact_name ?? '')
  const [phone, setPhone] = useState(installation?.phone ?? '')
  const [email, setEmail] = useState(installation?.email ?? '')
  const [notes, setNotes] = useState(installation?.notes ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setType('pool')
    setSanitizer('chlorine')
    setVolume('')
    setVolumeUnit('L')
    setTempUnit('C')
    setSaltUnit('ppm')
    setConcUnit('mg/L')
    setHardnessUnit('ppm')
    setAddress('')
    setContactName('')
    setPhone('')
    setEmail('')
    setNotes('')
    setTab('general')
  }

  const handleClose = () => {
    if (!isEdit) resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError(t('modal_install_name_required')); return }
    setLoading(true)
    setError(null)
    try {
      const parsedVolume = volume.trim() ? parseFloat(volume) : undefined
      const payload = {
        name: name.trim(),
        type,
        sanitizer,
        temp_unit: tempUnit,
        salt_unit: saltUnit,
        conc_unit: concUnit,
        hardness_unit: hardnessUnit,
        address: address.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(parsedVolume !== undefined && !isNaN(parsedVolume) ? { volume: parsedVolume, volume_unit: volumeUnit } : {}),
      }
      if (isEdit && installation) {
        const res = await fetch(`/api/installations/${installation.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('failed')
        await refresh()
      } else {
        await addInstallation(payload)
        resetForm()
      }
      onClose()
    } catch {
      setError(isEdit ? t('modal_install_update_error') : t('modal_install_create_error'))
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
    borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className={isEdit ? 'sm:max-w-md' : 'sm:max-w-sm'}>
        <DialogHeader>
          <DialogTitle style={{ fontFamily: '"Sora", sans-serif', fontWeight: 600 }}>
            {isEdit ? t('modal_install_title_edit') : t('modal_install_title')}
          </DialogTitle>
        </DialogHeader>

        {isEdit && (
          <div className="flex-shrink-0" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            {(['general', 'water'] as Tab[]).map(tb => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                style={{
                  padding: '8px 4px', background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: '"Sora", sans-serif', fontSize: 13, fontWeight: 600,
                  color: tab === tb ? 'var(--accent)' : 'var(--text-secondary)',
                  borderBottom: tab === tb ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {tb === 'general' ? t('modal_tab_general') : t('modal_tab_water_chemistry')}
              </button>
            ))}
          </div>
        )}

        {isEdit && tab === 'water' && installation ? (
          <WaterChemistryTargets installation={installation} onSaved={handleClose} />
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto overscroll-contain grid gap-4" style={{ paddingTop: 4 }}>
          {/* Name */}
          <div style={{ display: 'grid', gap: 6 }}>
            <Label htmlFor="inst-name">{t('modal_install_name')}</Label>
            <Input
              id="inst-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('modal_install_name_placeholder')}
            />
          </div>

          {/* Type */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_type')}</Label>
            <div style={{ display: 'flex', gap: 10 }}>
              {([['pool', Waves, t('modal_install_pool')], ['spa', Bath, t('modal_install_spa')]] as const).map(([tp, Icon, label]) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setType(tp)}
                  style={{
                    ...cardBase,
                    borderColor: type === tp ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                    background: type === tp ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
                    color: type === tp ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" style={{ color: type === tp ? 'var(--accent)' : 'var(--text-muted)' }} />
                  {label.replace(/^.\s/, '')}
                </button>
              ))}
            </div>
          </div>

          {/* Sanitizer */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_sanitizer')}</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['chlorine', t('modal_install_chlorine')], ['bromine', t('modal_install_bromine')], ['salt', t('modal_install_salt')]] as const).map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSanitizer(s)}
                  style={{
                    ...pillBase,
                    borderColor: sanitizer === s ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                    background: sanitizer === s ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
                    color: sanitizer === s ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Capacity */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label htmlFor="inst-volume">{t('modal_install_capacity')}</Label>
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
                    borderColor: volumeUnit === u ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                    background: volumeUnit === u ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
                    color: volumeUnit === u ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Measurement units */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_units')}</Label>
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
                <span style={unitRowLabel}>{t('unit_salt')}</span>
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
                <span style={unitRowLabel}>{t('unit_hardness')}</span>
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

          {/* Contact / location (all optional) */}
          <div style={{ display: 'grid', gap: 8 }}>
            <Label>{t('modal_install_contact_section')}</Label>
            <Input
              id="inst-address"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder={t('modal_install_address')}
            />
            <Input
              id="inst-contact-name"
              value={contactName}
              onChange={e => setContactName(e.target.value)}
              placeholder={t('modal_install_contact_name')}
            />
            <Input
              id="inst-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder={t('modal_install_phone')}
            />
            <Input
              id="inst-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('modal_install_email')}
            />
            <textarea
              id="inst-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('modal_install_notes')}
              rows={2}
              style={{
                width: '100%', resize: 'vertical', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                color: 'var(--text-primary)', padding: '8px 10px',
                fontFamily: '"Sora", sans-serif', fontSize: 14,
              }}
            />
          </div>

          {error && (
            <p style={{ fontFamily: '"Sora", sans-serif', fontSize: 13, color: 'var(--status-danger-text)', margin: 0 }}>
              {error}
            </p>
          )}
          </div>

          <Button type="submit" disabled={loading} className="w-full" style={{ marginTop: 18, flexShrink: 0 }}>
            {loading
              ? (isEdit ? t('modal_install_saving') : t('modal_install_creating'))
              : (isEdit ? t('modal_install_save') : t('modal_install_create'))}
          </Button>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

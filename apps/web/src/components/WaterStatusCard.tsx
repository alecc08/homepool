import type { Action } from '../types'
import { extractWaterParams, getWaterStatus } from '../utils'
import { useInstallation } from '../context/InstallationContext'
import { useT } from '../context/LocaleContext'
import { useTheme, type Theme } from '../hooks/useTheme'

type Props = {
  actions: Action[]
}

function getIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ── Inline isometric pool SVGs ─────────────────────────────────────────────

type SvgProps = {
  isDark: boolean
  opacity: number
}

function PoolClearSvg({ isDark, opacity }: SvgProps) {
  const deckStyle   = { fill: isDark ? 'var(--bg-surface)' : '#f0f4f8' }
  const deckStroke  = isDark ? '#1e2d3d' : '#dde3ec'
  const bodyLeft    = isDark ? '#0d3050' : '#a8d8f0'
  const bodyRight   = isDark ? '#091e3a' : '#98c8e0'
  const waveFill    = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(200,236,255,0.9)'
  const railStroke  = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(255,255,255,0.6)'
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity }}>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" style={deckStyle} stroke={deckStroke} strokeWidth="0.5"/>
      <path d="M10 52 L10 64 L60 88 L60 76 Z" fill={bodyLeft}/>
      <path d="M110 52 L110 64 L60 88 L60 76 Z" fill={bodyRight}/>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" fill="#2dd4bf" opacity="0.9"/>
      <path d="M10 52 L30 42 L50 52 L30 62 Z" fill="rgba(255,255,255,0.18)"/>
      <path d="M18 54 Q35 48 52 54 Q69 60 86 54 Q100 49 106 53" stroke={waveFill} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M22 62 Q38 57 54 62 Q70 67 86 62" stroke={waveFill} strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.6"/>
      <line x1="88" y1="42" x2="88" y2="58" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="93" y1="45" x2="93" y2="61" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="88" y1="47" x2="93" y2="49" stroke={railStroke} strokeWidth="1" strokeLinecap="round"/>
      <line x1="88" y1="53" x2="93" y2="55" stroke={railStroke} strokeWidth="1" strokeLinecap="round"/>
      <path d="M88 42 Q87 38 89 37" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M93 45 Q94 41 92 40" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="106" cy="32" r="5" fill="#10b981"/>
      <circle cx="106" cy="32" r="2.5" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

function PoolCloudySvg({ isDark, opacity }: SvgProps) {
  const deckStyle   = { fill: isDark ? 'var(--bg-surface)' : '#f0f4f8' }
  const deckStroke  = isDark ? '#1e2d3d' : '#dde3ec'
  const bodyLeft    = isDark ? '#0d3050' : '#a8d8f0'
  const bodyRight   = isDark ? '#091e3a' : '#98c8e0'
  const waveFill    = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(200,236,255,0.9)'
  const railStroke  = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(255,255,255,0.6)'
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity }}>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" style={deckStyle} stroke={deckStroke} strokeWidth="0.5"/>
      <path d="M10 52 L10 64 L60 88 L60 76 Z" fill={bodyLeft}/>
      <path d="M110 52 L110 64 L60 88 L60 76 Z" fill={bodyRight}/>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" fill="#3a9aaa" opacity="0.9"/>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" fill="rgba(180,210,180,0.18)"/>
      <circle cx="35" cy="54" r="1.5" fill="rgba(255,255,255,0.35)"/>
      <circle cx="58" cy="48" r="1" fill="rgba(255,255,255,0.3)"/>
      <circle cx="74" cy="58" r="1.5" fill="rgba(255,255,255,0.3)"/>
      <circle cx="88" cy="52" r="1" fill="rgba(255,255,255,0.35)"/>
      <circle cx="46" cy="66" r="1.5" fill="rgba(255,255,255,0.25)"/>
      <path d="M18 54 Q35 49 52 54 Q69 59 86 54" stroke={waveFill} strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      <line x1="88" y1="42" x2="88" y2="58" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="93" y1="45" x2="93" y2="61" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="88" y1="47" x2="93" y2="49" stroke={railStroke} strokeWidth="1" strokeLinecap="round"/>
      <line x1="88" y1="53" x2="93" y2="55" stroke={railStroke} strokeWidth="1" strokeLinecap="round"/>
      <path d="M88 42 Q87 38 89 37" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M93 45 Q94 41 92 40" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="106" cy="32" r="5" fill="#f59e0b"/>
      <circle cx="106" cy="32" r="2.5" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

function PoolGreenSvg({ isDark, opacity }: SvgProps) {
  const deckStyle   = { fill: isDark ? 'var(--bg-surface)' : '#f0f4f8' }
  const deckStroke  = isDark ? '#1e2d3d' : '#dde3ec'
  const bodyLeft    = isDark ? '#0d3050' : '#a8d8f0'
  const bodyRight   = isDark ? '#091e3a' : '#98c8e0'
  const waveFill    = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(200,236,255,0.9)'
  const railStroke  = isDark ? 'rgba(45,212,191,0.3)' : 'rgba(255,255,255,0.6)'
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity }}>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" style={deckStyle} stroke={deckStroke} strokeWidth="0.5"/>
      <path d="M10 52 L10 64 L60 88 L60 76 Z" fill={bodyLeft}/>
      <path d="M110 52 L110 64 L60 88 L60 76 Z" fill={bodyRight}/>
      <path d="M10 52 L60 28 L110 52 L60 76 Z" fill="#4a7a3a" opacity="0.95"/>
      <ellipse cx="38" cy="56" rx="8" ry="4" fill="#3a6a2a" opacity="0.6"/>
      <ellipse cx="70" cy="48" rx="6" ry="3" fill="#3a6a2a" opacity="0.5"/>
      <ellipse cx="85" cy="62" rx="7" ry="3.5" fill="#3a6a2a" opacity="0.55"/>
      <ellipse cx="52" cy="68" rx="5" ry="2.5" fill="#3a6a2a" opacity="0.45"/>
      <path d="M18 54 Q35 51 52 54 Q69 57 86 54" stroke={waveFill} strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5"/>
      <line x1="88" y1="42" x2="88" y2="58" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <line x1="93" y1="45" x2="93" y2="61" stroke={railStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <line x1="88" y1="47" x2="93" y2="49" stroke={railStroke} strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
      <line x1="88" y1="53" x2="93" y2="55" stroke={railStroke} strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
      <path d="M88 42 Q87 38 89 37" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5"/>
      <path d="M93 45 Q94 41 92 40" stroke={railStroke} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5"/>
      <circle cx="106" cy="32" r="5" fill="#ef4444"/>
      <circle cx="106" cy="32" r="2.5" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

// ── Inline isometric spa SVGs (hexagonal hot tub v3) ───────────────────────

function SpaClearSvg({ opacity }: SvgProps) {
  return (
    <svg width="140" height="125" viewBox="0 0 140 125" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity, width: '100%', height: 'auto', maxWidth: 140 }}>
      {/* steam */}
      <path d="M54 24 Q52 18 54 12 Q56 18 54 24" stroke="rgba(45,212,191,0.4)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M70 20 Q68 14 70 8 Q72 14 70 20" stroke="rgba(45,212,191,0.35)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M86 24 Q84 18 86 12 Q88 18 86 24" stroke="rgba(45,212,191,0.3)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      {/* front-left face */}
      <path d="M22 65 L22 79 L46 99 L46 85 Z" fill="#9ac4d8"/>
      {/* front face */}
      <path d="M46 85 L46 99 L94 99 L94 85 Z" fill="#88b8cc"/>
      {/* front-right face */}
      <path d="M94 85 L94 99 L118 79 L118 65 Z" fill="#7aacc0"/>
      {/* hexagonal water surface */}
      <path d="M22 65 L46 45 L94 45 L118 65 L94 85 L46 85 Z" fill="#2dd4bf" opacity="0.9"/>
      {/* reflection */}
      <path d="M22 65 L38 57 L54 65 L38 73 Z" fill="rgba(255,255,255,0.15)"/>
      {/* wave 1 */}
      <path d="M30 66 Q50 59 68 66 Q86 73 104 66 Q114 62 116 65" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      {/* wave 2 */}
      <path d="M34 74 Q52 68 70 74 Q88 80 106 74" stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none" strokeLinecap="round"/>
      {/* left-wall jets */}
      <circle cx="26" cy="67" r="2.5" fill="rgba(255,255,255,0.55)"/>
      <circle cx="26" cy="74" r="2" fill="rgba(255,255,255,0.4)"/>
      {/* right-wall jets */}
      <circle cx="114" cy="67" r="2.5" fill="rgba(255,255,255,0.55)"/>
      <circle cx="114" cy="74" r="2" fill="rgba(255,255,255,0.4)"/>
      {/* corner jets */}
      <circle cx="34" cy="56" r="2" fill="rgba(255,255,255,0.4)"/>
      <circle cx="106" cy="56" r="2" fill="rgba(255,255,255,0.4)"/>
      {/* bubbles */}
      <circle cx="52" cy="74" r="2" fill="rgba(255,255,255,0.45)"/>
      <circle cx="68" cy="68" r="1.5" fill="rgba(255,255,255,0.4)"/>
      <circle cx="84" cy="75" r="2" fill="rgba(255,255,255,0.4)"/>
      <circle cx="96" cy="70" r="1.5" fill="rgba(255,255,255,0.35)"/>
      {/* status */}
      <circle cx="126" cy="44" r="6" fill="#10b981"/>
      <circle cx="126" cy="44" r="3" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

function SpaClouddySvg({ opacity }: SvgProps) {
  return (
    <svg width="140" height="125" viewBox="0 0 140 125" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity, width: '100%', height: 'auto', maxWidth: 140 }}>
      {/* faded steam */}
      <path d="M54 24 Q52 18 54 12 Q56 18 54 24" stroke="rgba(56,150,170,0.25)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M70 20 Q68 14 70 8 Q72 14 70 20" stroke="rgba(56,150,170,0.2)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      {/* faces */}
      <path d="M22 65 L22 79 L46 99 L46 85 Z" fill="#4a8490"/>
      <path d="M46 85 L46 99 L94 99 L94 85 Z" fill="#407880"/>
      <path d="M94 85 L94 99 L118 79 L118 65 Z" fill="#386c74"/>
      {/* cloudy water surface */}
      <path d="M22 65 L46 45 L94 45 L118 65 L94 85 L46 85 Z" fill="#3a9aaa" opacity="0.9"/>
      <path d="M22 65 L46 45 L94 45 L118 65 L94 85 L46 85 Z" fill="rgba(180,210,180,0.18)"/>
      {/* turbidity particles */}
      <circle cx="44" cy="66" r="1.5" fill="rgba(255,255,255,0.28)"/>
      <circle cx="62" cy="60" r="1" fill="rgba(255,255,255,0.25)"/>
      <circle cx="80" cy="68" r="1.5" fill="rgba(255,255,255,0.28)"/>
      <circle cx="98" cy="62" r="1" fill="rgba(255,255,255,0.22)"/>
      <circle cx="58" cy="76" r="1.5" fill="rgba(255,255,255,0.2)"/>
      {/* faded wave */}
      <path d="M30 66 Q50 60 68 66 Q86 72 104 66" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      {/* jets */}
      <circle cx="26" cy="67" r="2.5" fill="rgba(255,255,255,0.28)"/>
      <circle cx="114" cy="67" r="2.5" fill="rgba(255,255,255,0.28)"/>
      <circle cx="34" cy="56" r="2" fill="rgba(255,255,255,0.22)"/>
      <circle cx="106" cy="56" r="2" fill="rgba(255,255,255,0.22)"/>
      {/* status */}
      <circle cx="126" cy="44" r="6" fill="#f59e0b"/>
      <circle cx="126" cy="44" r="3" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

function SpaGreenSvg({ opacity }: SvgProps) {
  return (
    <svg width="140" height="125" viewBox="0 0 140 125" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity, width: '100%', height: 'auto', maxWidth: 140 }}>
      {/* faces */}
      <path d="M22 65 L22 79 L46 99 L46 85 Z" fill="#3a6a3a"/>
      <path d="M46 85 L46 99 L94 99 L94 85 Z" fill="#345e34"/>
      <path d="M94 85 L94 99 L118 79 L118 65 Z" fill="#2e5430"/>
      {/* green water surface */}
      <path d="M22 65 L46 45 L94 45 L118 65 L94 85 L46 85 Z" fill="#4a7a3a" opacity="0.95"/>
      {/* algae */}
      <ellipse cx="50" cy="68" rx="9" ry="4" fill="#3a6a2a" opacity="0.6"/>
      <ellipse cx="76" cy="60" rx="7" ry="3" fill="#3a6a2a" opacity="0.5"/>
      <ellipse cx="94" cy="72" rx="8" ry="3.5" fill="#3a6a2a" opacity="0.55"/>
      <ellipse cx="64" cy="78" rx="5" ry="2.5" fill="#3a6a2a" opacity="0.45"/>
      {/* nearly invisible wave */}
      <path d="M30 66 Q50 63 68 66 Q86 69 104 66" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none" strokeLinecap="round"/>
      {/* nearly invisible jets */}
      <circle cx="26" cy="67" r="2.5" fill="rgba(255,255,255,0.12)"/>
      <circle cx="114" cy="67" r="2.5" fill="rgba(255,255,255,0.12)"/>
      {/* status */}
      <circle cx="126" cy="44" r="6" fill="#ef4444"/>
      <circle cx="126" cy="44" r="3" style={{ fill: 'var(--bg-surface)' }}/>
    </svg>
  )
}

// ── Config ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  clear:  { labelKey: 'water_clear',  statusKey: 'status_normal',        color: 'var(--status-ok-text)'     },
  cloudy: { labelKey: 'water_cloudy', statusKey: 'status_watch',         color: 'var(--status-warn-text)'   },
  green:  { labelKey: 'water_green',  statusKey: 'status_out_of_range',  color: 'var(--status-danger-text)' },
} as const

// ── Component ──────────────────────────────────────────────────────────────

export default function WaterStatusCard({ actions }: Props) {
  const { active, ranges } = useInstallation()
  const { t } = useT()
  const { theme } = useTheme()
  const params = extractWaterParams(actions)
  const { status, hasData } = getWaterStatus(params, ranges ?? undefined)
  const isDark = getIsDark(theme)

  const svgOpacity = hasData ? 1 : 0.4
  const isSpa = active?.type === 'spa'

  const cfg = STATUS_CONFIG[status]
  const label     = t(cfg.labelKey)
  const indicator = `● ${t(cfg.statusKey)}`
  const color     = cfg.color

  return (
    <div
      className="stat-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {isSpa ? (
        <div className="spa-indicator">
          {status === 'clear'  && <SpaClearSvg   isDark={isDark} opacity={svgOpacity} />}
          {status === 'cloudy' && <SpaClouddySvg isDark={isDark} opacity={svgOpacity} />}
          {status === 'green'  && <SpaGreenSvg   isDark={isDark} opacity={svgOpacity} />}
        </div>
      ) : (
        <>
          {status === 'clear'  && <PoolClearSvg  isDark={isDark} opacity={svgOpacity} />}
          {status === 'cloudy' && <PoolCloudySvg isDark={isDark} opacity={svgOpacity} />}
          {status === 'green'  && <PoolGreenSvg  isDark={isDark} opacity={svgOpacity} />}
        </>
      )}
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <div
          style={{
            fontFamily: '"Sora", sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            color,
            marginTop: 3,
          }}
        >
          {indicator}
        </div>
      </div>
    </div>
  )
}

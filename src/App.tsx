import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import {
  Camera,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Mic,
  Video,
  Battery,
  Lightbulb,
  History,
  Lock,
  Unlock,
  LogOut,
  Pencil,
  Check,
  Trash2,
  Radio,
  Package,
  Tag,
  ShieldCheck,
  Cloud,
  CloudOff,
} from 'lucide-react'
import {
  DEFAULT_ACCESSORIES,
  DEFAULT_CAMERAS,
  DEFAULT_TEAM_NAMES,
  type AccessoryId,
  type AccessoryItem,
  type CameraId,
  type CameraInfo,
  type Reservation,
  type ReservationStatus,
  type TeamId,
} from './lib/types'
import { isSupabaseConfigured } from './lib/supabase'
import {
  fetchAllCloudData,
  persistAccessory,
  persistCamera,
  persistReservation,
  persistTeamName,
  deleteAccessoryRemote,
  deleteCameraRemote,
  deleteReservationRemote,
  rowToReservation,
  subscribeToCloudChanges,
  type ReservationRow,
  type TeamNameRow,
} from './lib/cloudSync'

// ----------------------------------------------------------------------------------
// 타입 정의 (UI 전용 - 도메인 타입은 ./lib/types 참고)
// ----------------------------------------------------------------------------------

interface Team {
  id: TeamId
  label: string
  color: string
  textColor: string
  borderColor: string
  softBg: string
  ring: string
}

type ReservationModalState =
  | { mode: 'create'; presetDate?: string; presetCameraId?: CameraId }
  | { mode: 'edit'; reservation: Reservation }

type CloudStatus = 'checking' | 'online' | 'offline'

// ----------------------------------------------------------------------------------
// 상수 데이터
// ----------------------------------------------------------------------------------

const TOSS_BLUE = '#3182f6'
const TOSS_BLUE_HOVER = '#2272eb'
const TOSS_BG = '#f2f4f6'

const TEAMS: Team[] = [
  {
    id: '1조',
    label: '1조',
    color: 'bg-cyan-500',
    textColor: 'text-cyan-700',
    borderColor: 'border-cyan-400',
    softBg: 'bg-cyan-50',
    ring: 'ring-cyan-200',
  },
  {
    id: '2조',
    label: '2조',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-400',
    softBg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
  },
  {
    id: '3조',
    label: '3조',
    color: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-400',
    softBg: 'bg-amber-50',
    ring: 'ring-amber-200',
  },
  {
    id: '4조',
    label: '4조',
    color: 'bg-violet-500',
    textColor: 'text-violet-700',
    borderColor: 'border-violet-400',
    softBg: 'bg-violet-50',
    ring: 'ring-violet-200',
  },
  {
    id: '5조',
    label: '5조',
    color: 'bg-rose-500',
    textColor: 'text-rose-700',
    borderColor: 'border-rose-400',
    softBg: 'bg-rose-50',
    ring: 'ring-rose-200',
  },
]

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

const STORAGE_KEY = 'camera-reservation-data-v3'
const TEAM_NAMES_STORAGE_KEY = 'camera-team-names-v1'
const CAMERAS_STORAGE_KEY = 'camera-equipment-cameras-v1'
const ACCESSORIES_STORAGE_KEY = 'camera-equipment-accessories-v2'
const ADMIN_SESSION_KEY = 'camera-admin-session-v1'
const MY_TEAM_STORAGE_KEY = 'camera-my-team-v1'
const ADMIN_PASSWORD = '9126'

// ----------------------------------------------------------------------------------
// 유틸 함수
// ----------------------------------------------------------------------------------

function getTeam(teamId: TeamId): Team {
  return TEAMS.find((t) => t.id === teamId)!
}

function formatDateTime(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function isOverlapping(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const sA = new Date(startA).getTime()
  const eA = new Date(endA).getTime()
  const sB = new Date(startB).getTime()
  const eB = new Date(endB).getTime()
  return sA < eB && sB < eA
}

function generateId(): string {
  return `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatAccessory(item: AccessoryItem): string {
  return `${item.category} (${item.label})`
}

function groupAccessoriesByCategory(
  items: AccessoryItem[],
): { category: string; items: AccessoryItem[] }[] {
  const map = new Map<string, AccessoryItem[]>()
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, [])
    map.get(item.category)!.push(item)
  }
  return Array.from(map.entries()).map(([category, categoryItems]) => ({
    category,
    items: categoryItems,
  }))
}

function getAccessoryIcon(category: string) {
  if (category.includes('배터리')) return Battery
  if (category.includes('마이크')) return Mic
  if (category.includes('조명')) return Lightbulb
  return Package
}

function findCameraConflict(
  reservations: Reservation[],
  cameraId: CameraId,
  startAt: string,
  endAt: string,
  excludeReservationId?: string,
): Reservation | undefined {
  return reservations.find(
    (r) =>
      r.id !== excludeReservationId &&
      r.cameraId === cameraId &&
      r.status === '대여중' &&
      isOverlapping(startAt, endAt, r.startAt, r.endAt),
  )
}

function findAccessoryConflict(
  reservations: Reservation[],
  accessoryId: AccessoryId,
  startAt: string,
  endAt: string,
  excludeReservationId?: string,
): Reservation | undefined {
  return reservations.find(
    (r) =>
      r.id !== excludeReservationId &&
      r.status === '대여중' &&
      r.accessories.includes(accessoryId) &&
      isOverlapping(startAt, endAt, r.startAt, r.endAt),
  )
}

function findBroadcastConflict(
  reservations: Reservation[],
  startAt: string,
  endAt: string,
  excludeReservationId?: string,
): Reservation | undefined {
  return reservations.find(
    (r) =>
      r.id !== excludeReservationId &&
      r.status === '대여중' &&
      r.isBroadcast &&
      isOverlapping(startAt, endAt, r.startAt, r.endAt),
  )
}

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getCalendarGridDays(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

function reservationOverlapsDay(r: Reservation, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return isOverlapping(
    r.startAt,
    r.endAt,
    dayStart.toISOString(),
    dayEnd.toISOString(),
  )
}

function formatTimeOnly(value: string): string {
  const idx = value.indexOf('T')
  return idx >= 0 ? value.slice(idx + 1, idx + 6) : value
}

// Date 객체를 datetime-local input과 동일한 "yyyy-MM-ddTHH:mm" 로컬 문자열로 변환
function toLocalInputValue(d: Date): string {
  const copy = new Date(d)
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset())
  return copy.toISOString().slice(0, 16)
}

// 예약 폼 기본값은 초 단위 현재 시각까지 정밀할 필요가 없으므로 5분 단위로 내림한다.
function nowLocalInput(offsetHours = 0): string {
  const d = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0)
  return toLocalInputValue(d)
}

// "yyyy-MM-ddTHH:mm" 문자열을 날짜/시/분으로 분리 (커스텀 시간 선택 UI용)
function splitDateTime(value: string): { date: string; hour: string; minute: string } {
  const [date, time] = value.split('T')
  const [hour, minute] = (time ?? '00:00').split(':')
  return { date: date ?? '', hour: hour ?? '00', minute: minute ?? '00' }
}

function combineDateTime(date: string, hour: string, minute: string): string {
  return `${date}T${hour}:${minute}`
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => `${h}`.padStart(2, '0'))
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, m) => `${m * 5}`.padStart(2, '0'))
const QUICK_DURATION_HOURS = [1, 2, 3]

// ----------------------------------------------------------------------------------
// 더미 데이터 (localStorage 전용 모드에서만 사용)
// ----------------------------------------------------------------------------------

function buildDummyData(): Reservation[] {
  return [
    {
      id: generateId(),
      teamId: '1조',
      cameraId: 'A',
      accessories: ['tri-01', 'mic-1'],
      isBroadcast: false,
      startAt: nowLocalInput(1),
      endAt: nowLocalInput(4),
      purpose: '캠퍼스 홍보 영상 촬영',
      status: '대여중',
      createdAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      teamId: '2조',
      cameraId: 'B',
      accessories: ['mic-1', 'bat-01'],
      isBroadcast: false,
      startAt: nowLocalInput(-6),
      endAt: nowLocalInput(-3),
      purpose: '인터뷰 촬영',
      status: '반납완료',
      createdAt: new Date().toISOString(),
      returnedAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      teamId: '3조',
      cameraId: 'C',
      accessories: ['bat-02', 'sd-02'],
      isBroadcast: true,
      startAt: nowLocalInput(24),
      endAt: nowLocalInput(27),
      purpose: '방송국 스튜디오 제품 촬영',
      status: '대여중',
      createdAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      teamId: '4조',
      cameraId: 'A',
      accessories: ['sd-01'],
      isBroadcast: false,
      startAt: nowLocalInput(30),
      endAt: nowLocalInput(33),
      purpose: '단편 영화 촬영 - 실내 씬',
      status: '대여중',
      createdAt: new Date().toISOString(),
    },
  ]
}

function loadReservations(): Reservation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const dummy = buildDummyData()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dummy))
      return dummy
    }
    return JSON.parse(raw) as Reservation[]
  } catch {
    const dummy = buildDummyData()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dummy))
    return dummy
  }
}

function loadTeamNames(): Record<TeamId, string> {
  try {
    const raw = localStorage.getItem(TEAM_NAMES_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(
        TEAM_NAMES_STORAGE_KEY,
        JSON.stringify(DEFAULT_TEAM_NAMES),
      )
      return { ...DEFAULT_TEAM_NAMES }
    }
    return { ...DEFAULT_TEAM_NAMES, ...(JSON.parse(raw) as Record<TeamId, string>) }
  } catch {
    return { ...DEFAULT_TEAM_NAMES }
  }
}

function loadCameras(): CameraInfo[] {
  try {
    const raw = localStorage.getItem(CAMERAS_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(CAMERAS_STORAGE_KEY, JSON.stringify(DEFAULT_CAMERAS))
      return [...DEFAULT_CAMERAS]
    }
    return JSON.parse(raw) as CameraInfo[]
  } catch {
    return [...DEFAULT_CAMERAS]
  }
}

function loadAccessories(): AccessoryItem[] {
  try {
    const raw = localStorage.getItem(ACCESSORIES_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(
        ACCESSORIES_STORAGE_KEY,
        JSON.stringify(DEFAULT_ACCESSORIES),
      )
      return [...DEFAULT_ACCESSORIES]
    }
    return JSON.parse(raw) as AccessoryItem[]
  } catch {
    return [...DEFAULT_ACCESSORIES]
  }
}

function loadMyTeam(): TeamId {
  try {
    const raw = localStorage.getItem(MY_TEAM_STORAGE_KEY)
    if (raw && TEAMS.some((t) => t.id === raw)) return raw as TeamId
    localStorage.setItem(MY_TEAM_STORAGE_KEY, '1조')
    return '1조'
  } catch {
    return '1조'
  }
}

// ----------------------------------------------------------------------------------
// 공용 데이터 컨텍스트
// ----------------------------------------------------------------------------------

interface AppDataContextValue {
  teamNames: Record<TeamId, string>
  cameras: CameraInfo[]
  accessories: AccessoryItem[]
  myTeam: TeamId
  isAdmin: boolean
  getTeamLabel: (id: TeamId) => string
  getCameraById: (id: string) => CameraInfo
  getAccessoryById: (id: AccessoryId) => AccessoryItem
  renameTeam: (id: TeamId, name: string) => void
  addCamera: (label: string, model: string) => void
  removeCamera: (id: string) => void
  addAccessory: (category: string, label: string) => void
  removeAccessory: (id: AccessoryId) => void
  confirmAction: (opts: {
    message: string
    confirmLabel?: string
    danger?: boolean
    onConfirm: () => void
  }) => void
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) {
    throw new Error('useAppData must be used within AppDataContext.Provider')
  }
  return ctx
}

// ----------------------------------------------------------------------------------
// 공통 UI 컴포넌트
// ----------------------------------------------------------------------------------

const PRIMARY_BTN =
  'inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-5 text-base font-bold text-white transition active:scale-[0.98]'
const SECONDARY_BTN =
  'inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]'
const CARD = 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.03]'
const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-800 outline-none transition focus:border-[#3182f6] focus:ring-4 focus:ring-[#3182f6]/10'

function TeamBadge({ teamId, size = 'md' }: { teamId: TeamId; size?: 'sm' | 'md' }) {
  const team = getTeam(teamId)
  const { getTeamLabel } = useAppData()
  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-1 text-xs gap-1'
      : 'px-3 py-1.5 text-sm gap-1.5'
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold text-white ${sizeClasses} ${team.color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {getTeamLabel(teamId)}
    </span>
  )
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  const styles: Record<ReservationStatus, string> = {
    대여중: 'bg-sky-100 text-sky-700',
    반납완료: 'bg-slate-100 text-slate-500',
    취소됨: 'bg-red-100 text-red-600',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function BroadcastBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">
      <Radio size={12} />
      방송국
    </span>
  )
}

function CloudStatusBadge({ status }: { status: CloudStatus }) {
  if (status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-400">
        연결 확인 중...
      </span>
    )
  }
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">
        <Cloud size={12} />
        실시간 동기화 중
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-600">
      <CloudOff size={12} />
      오프라인 (이 브라우저에만 저장)
    </span>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b border-slate-100 bg-white/95 px-6 py-5 backdrop-blur">
          <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={22} />
          </button>
        </div>
        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  title = '확인',
  message,
  confirmLabel = '확인',
  danger,
  onCancel,
  onConfirm,
}: {
  title?: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div
            className={`rounded-2xl p-2.5 ${danger ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-[#3182f6]'}`}
          >
            <AlertTriangle size={22} />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
            <p className="mt-1.5 text-base text-slate-600">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className={SECONDARY_BTN}>
            취소
          </button>
          <button
            onClick={onConfirm}
            className={PRIMARY_BTN}
            style={{ backgroundColor: danger ? '#ef4444' : TOSS_BLUE }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = danger ? '#dc2626' : TOSS_BLUE_HOVER
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = danger ? '#ef4444' : TOSS_BLUE
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 내 조 선택 드롭다운
// ----------------------------------------------------------------------------------

function MyTeamSwitcher({
  myTeam,
  onChange,
}: {
  myTeam: TeamId
  onChange: (id: TeamId) => void
}) {
  const { getTeamLabel } = useAppData()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const team = getTeam(myTeam)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-12 items-center gap-2 rounded-xl border px-4 text-base font-bold transition ${team.softBg} ${team.borderColor} ${team.textColor}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${team.color}`} />
        내 조: {getTeamLabel(myTeam)}
        <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onChange(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-base font-semibold transition hover:bg-slate-50 ${
                t.id === myTeam ? t.textColor : 'text-slate-600'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${t.color}`} />
              {getTeamLabel(t.id)}
              {t.id === myTeam && <Check size={16} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 부가 장비 - 품목별 아코디언 + 라벨 칩 선택 UI (예약 폼에서 사용)
// ----------------------------------------------------------------------------------

function AccessoryPickerAccordion({
  availableAccessories,
  selected,
  reservations,
  startAt,
  endAt,
  hasValidRange,
  excludeId,
  onToggle,
}: {
  availableAccessories: AccessoryItem[]
  selected: AccessoryId[]
  reservations: Reservation[]
  startAt: string
  endAt: string
  hasValidRange: boolean
  excludeId?: string
  onToggle: (id: AccessoryId) => void
}) {
  const { getTeamLabel } = useAppData()
  const groups = useMemo(
    () => groupAccessoriesByCategory(availableAccessories),
    [availableAccessories],
  )

  if (groups.length === 0) {
    return <p className="text-sm text-slate-400">등록된 부속 기자재가 없습니다.</p>
  }

  return (
    <div className="space-y-2">
      {groups.map(({ category, items }) => {
        const Icon = getAccessoryIcon(category)
        const selectedCount = items.filter((i) => selected.includes(i.id)).length
        return (
          <details
            key={category}
            className="group overflow-hidden rounded-xl border border-slate-200"
            open
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-base font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
              <Icon size={16} className="text-slate-500" />
              {category}
              {selectedCount > 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-[#3182f6]">
                  {selectedCount}개 선택
                </span>
              )}
              <ChevronDown
                size={16}
                className="ml-auto shrink-0 text-slate-400 transition group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3.5 py-3">
              {items.map((item) => {
                const checked = selected.includes(item.id)
                const conflict = hasValidRange
                  ? findAccessoryConflict(reservations, item.id, startAt, endAt, excludeId)
                  : undefined
                const disabled = !!conflict && !checked
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggle(item.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition ${
                      disabled
                        ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
                        : checked
                          ? 'border-[#3182f6] bg-[#3182f6] text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                    title={
                      disabled && conflict
                        ? `${getTeamLabel(conflict.teamId)} 예약중 (${formatDateTime(conflict.startAt)} ~ ${formatDateTime(conflict.endAt)})`
                        : undefined
                    }
                  >
                    <Tag size={12} />
                    {item.label}
                    {disabled && conflict && (
                      <span className="text-[10px] font-semibold text-red-400">
                        {getTeamLabel(conflict.teamId)} 예약중
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </details>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 토스 스타일 날짜/시간 선택 (날짜 + 시/분 드롭다운, 10분 단위)
// ----------------------------------------------------------------------------------

function DateTimePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const { date, hour, minute } = splitDateTime(value)
  // 기존 데이터의 분이 5분 단위가 아닐 수 있으므로(과거 datetime-local 입력값 등), 드롭다운에 없으면 임시로 추가해 값이 사라지지 않게 한다.
  const minuteOptions = MINUTE_OPTIONS.includes(minute)
    ? MINUTE_OPTIONS
    : [...MINUTE_OPTIONS, minute].sort()

  return (
    <div>
      <label className="mb-2 block text-base font-bold text-slate-700">{label}</label>
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(combineDateTime(e.target.value, hour, minute))}
          className={`${INPUT} h-12 min-w-[152px] flex-1`}
        />
        <select
          value={hour}
          onChange={(e) => onChange(combineDateTime(date, e.target.value, minute))}
          className={`${INPUT} h-12 w-[84px]`}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}시
            </option>
          ))}
        </select>
        <select
          value={minute}
          onChange={(e) => onChange(combineDateTime(date, hour, e.target.value))}
          className={`${INPUT} h-12 w-[84px]`}
        >
          {minuteOptions.map((m) => (
            <option key={m} value={m}>
              {m}분
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 예약 등록 / 변경 모달
// ----------------------------------------------------------------------------------

function ReservationModal({
  reservations,
  myTeam,
  state,
  onClose,
  onSubmit,
}: {
  reservations: Reservation[]
  myTeam: TeamId
  state: ReservationModalState
  onClose: () => void
  onSubmit: (reservation: Reservation) => void
}) {
  const isEdit = state.mode === 'edit'
  const existing = isEdit ? state.reservation : undefined
  const { cameras, accessories: availableAccessories, getTeamLabel, getCameraById } =
    useAppData()

  const [teamId, setTeamId] = useState<TeamId>(existing?.teamId ?? myTeam)
  const [cameraId, setCameraId] = useState<CameraId>(
    () =>
      existing?.cameraId ??
      (state.mode === 'create' ? state.presetCameraId : undefined) ??
      cameras[0]?.id ??
      '',
  )
  const [accessories, setAccessories] = useState<AccessoryId[]>(
    existing?.accessories ?? [],
  )
  const [isBroadcast, setIsBroadcast] = useState(existing?.isBroadcast ?? false)
  const [startAt, setStartAt] = useState(
    existing?.startAt ??
      (state.mode === 'create' && state.presetDate
        ? `${state.presetDate}T09:00`
        : nowLocalInput()),
  )
  const [endAt, setEndAt] = useState(
    existing?.endAt ??
      (state.mode === 'create' && state.presetDate
        ? `${state.presetDate}T11:00`
        : nowLocalInput(2)),
  )
  const [purpose, setPurpose] = useState(existing?.purpose ?? '')
  const [error, setError] = useState('')

  const excludeId = existing?.id
  const hasValidRange =
    !!startAt && !!endAt && new Date(startAt).getTime() < new Date(endAt).getTime()

  function toggleAccessory(item: AccessoryId) {
    setAccessories((prev) =>
      prev.includes(item) ? prev.filter((a) => a !== item) : [...prev, item],
    )
  }

  function handleSubmit() {
    setError('')

    if (!startAt || !endAt) {
      setError('시작 및 종료 일시를 모두 입력해주세요.')
      return
    }
    if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      setError('종료 일시는 시작 일시보다 이후여야 합니다.')
      return
    }
    if (!purpose.trim()) {
      setError('촬영 목적을 입력해주세요.')
      return
    }
    if (!cameraId) {
      setError('카메라를 선택해주세요.')
      return
    }

    const conflict = findCameraConflict(
      reservations,
      cameraId,
      startAt,
      endAt,
      excludeId,
    )
    if (conflict) {
      const cam = getCameraById(cameraId)
      setError(
        `⚠ 예약 충돌: ${cam.label}(${cam.model})는 ${getTeamLabel(conflict.teamId)}이(가) ` +
          `${formatDateTime(conflict.startAt)} ~ ${formatDateTime(conflict.endAt)} 동안 이미 예약했습니다. ` +
          `해당 시간과 1분이라도 겹치는 예약은 등록할 수 없습니다.`,
      )
      return
    }

    for (const accessoryId of accessories) {
      const accConflict = findAccessoryConflict(
        reservations,
        accessoryId,
        startAt,
        endAt,
        excludeId,
      )
      if (accConflict) {
        const item = availableAccessories.find((a) => a.id === accessoryId)
        setError(
          `⚠ 예약 충돌: ${item ? formatAccessory(item) : accessoryId}는 ${getTeamLabel(accConflict.teamId)}이(가) ` +
            `${formatDateTime(accConflict.startAt)} ~ ${formatDateTime(accConflict.endAt)} 동안 이미 예약했습니다.`,
        )
        return
      }
    }

    if (
      isBroadcast &&
      findBroadcastConflict(reservations, startAt, endAt, excludeId)
    ) {
      setError('해당 시간대에 방송국 예약이 이미 차 있습니다.')
      return
    }

    const reservation: Reservation = {
      id: existing?.id ?? generateId(),
      teamId,
      cameraId,
      accessories,
      isBroadcast,
      startAt,
      endAt,
      purpose: purpose.trim(),
      status: existing?.status ?? '대여중',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      returnedAt: existing?.returnedAt,
    }
    onSubmit(reservation)
  }

  return (
    <Modal title={isEdit ? '예약 변경' : '장비 예약 등록'} onClose={onClose}>
      <div className="space-y-6">
        <div>
          <label className="mb-2 block text-base font-bold text-slate-700">
            예약 조
          </label>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map((team) => (
              <button
                key={team.id}
                onClick={() => setTeamId(team.id)}
                className={`rounded-full border px-4 py-2 text-base font-bold transition ${
                  teamId === team.id
                    ? `${team.color} border-transparent text-white`
                    : `${team.softBg} ${team.textColor} ${team.borderColor}`
                }`}
              >
                {getTeamLabel(team.id)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-base font-bold text-slate-700">
            카메라 선택
          </label>
          {cameras.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
              등록된 카메라가 없습니다. 관리자 설정에서 카메라를 먼저 추가해주세요.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {cameras.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setCameraId(cam.id)}
                  className={`flex flex-col items-start rounded-xl border-2 px-3.5 py-3 text-left transition ${
                    cameraId === cam.id
                      ? 'border-[#3182f6] bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-base font-bold text-slate-800">
                    <Video size={16} />
                    {cam.label}
                  </span>
                  <span className="text-sm text-slate-500">{cam.model}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="mb-2 block text-base font-bold text-slate-700">
            부속 기자재 (품목별 아코디언 · 라벨 번호 단위 다중 선택)
          </label>
          <AccessoryPickerAccordion
            availableAccessories={availableAccessories}
            selected={accessories}
            reservations={reservations}
            startAt={startAt}
            endAt={endAt}
            hasValidRange={hasValidRange}
            excludeId={excludeId}
            onToggle={toggleAccessory}
          />
        </div>

        <div>
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-4 py-3.5 transition ${
              isBroadcast
                ? 'border-violet-400 bg-violet-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              checked={isBroadcast}
              onChange={(e) => setIsBroadcast(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-violet-600"
            />
            <span>
              <span className="flex items-center gap-1.5 text-base font-bold text-slate-700">
                <Radio size={15} className="text-violet-600" />
                방송국 사용
              </span>
              <span className="mt-0.5 block text-sm text-slate-400">
                방송국은 동시간대에 1개 조만 단독 사용할 수 있습니다. 야외·일반
                촬영은 체크하지 않아도 됩니다.
              </span>
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateTimePicker label="시작 일시" value={startAt} onChange={setStartAt} />
          <DateTimePicker label="종료 일시" value={endAt} onChange={setEndAt} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-500">빠른 선택</span>
          {QUICK_DURATION_HOURS.map((hours) => (
            <button
              key={hours}
              type="button"
              onClick={() => {
                const start = new Date(startAt)
                if (Number.isNaN(start.getTime())) return
                setEndAt(toLocalInputValue(new Date(start.getTime() + hours * 60 * 60 * 1000)))
              }}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:border-[#3182f6] hover:text-[#3182f6]"
            >
              +{hours}시간
            </button>
          ))}
        </div>

        <div>
          <label className="mb-2 block text-base font-bold text-slate-700">
            촬영 목적
          </label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={2}
            placeholder="예) 캠퍼스 홍보 영상 촬영"
            className={`${INPUT} resize-none py-3`}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={SECONDARY_BTN}>
            취소
          </button>
          <button
            onClick={handleSubmit}
            className={PRIMARY_BTN}
            style={{ backgroundColor: TOSS_BLUE }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE_HOVER)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE)}
          >
            {isEdit ? '변경 사항 저장' : '예약 등록'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 반납 확인 모달 (2종 필수 체크)
// ----------------------------------------------------------------------------------

function ReturnChecklistModal({
  reservation,
  onClose,
  onConfirm,
}: {
  reservation: Reservation
  onClose: () => void
  onConfirm: (id: string) => void
}) {
  const { getCameraById, getAccessoryById } = useAppData()
  const [batteryChecked, setBatteryChecked] = useState(false)
  const [cleanupChecked, setCleanupChecked] = useState(false)
  const cam = getCameraById(reservation.cameraId)
  const canConfirm = batteryChecked && cleanupChecked

  return (
    <Modal title="반납 확인" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-base text-slate-600">
          아래 대여 장비를 반납 처리하기 전, 두 항목을 모두 확인해주세요.
        </p>

        <div className="rounded-2xl bg-slate-50 px-4 py-3.5">
          <p className="flex items-center gap-1.5 text-base font-bold text-slate-800">
            <Video size={16} />
            {cam.label} ({cam.model})
          </p>
          {reservation.accessories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reservation.accessories.map((id) => {
                const item = getAccessoryById(id)
                return (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500"
                  >
                    <Tag size={11} />
                    {formatAccessory(item)}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition ${
              batteryChecked
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              checked={batteryChecked}
              onChange={(e) => setBatteryChecked(e.target.checked)}
              className="h-5 w-5 rounded accent-emerald-600"
            />
            <span className="flex items-center gap-1.5 text-base font-bold text-slate-700">
              <Battery size={17} />
              배터리 충전 완료
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition ${
              cleanupChecked
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              checked={cleanupChecked}
              onChange={(e) => setCleanupChecked(e.target.checked)}
              className="h-5 w-5 rounded accent-emerald-600"
            />
            <span className="flex items-center gap-1.5 text-base font-bold text-slate-700">
              <Package size={17} />
              카메라 및 장비 정리 완료 (가방 정리/전원 OFF)
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={SECONDARY_BTN}>
            취소
          </button>
          <button
            onClick={() => onConfirm(reservation.id)}
            disabled={!canConfirm}
            className={`${PRIMARY_BTN} ${
              canConfirm ? 'bg-emerald-600 hover:bg-emerald-700' : 'cursor-not-allowed bg-slate-300'
            }`}
          >
            <CheckCircle2 size={18} />
            반납 완료
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 예약 상세 팝업
// ----------------------------------------------------------------------------------

function ReservationDetailModal({
  reservation,
  myTeam,
  isAdmin,
  onClose,
  onEdit,
  onReturnClick,
  onCancel,
}: {
  reservation: Reservation
  myTeam: TeamId
  isAdmin: boolean
  onClose: () => void
  onEdit: (r: Reservation) => void
  onReturnClick: (r: Reservation) => void
  onCancel: (id: string) => void
}) {
  const { getCameraById, getAccessoryById, getTeamLabel } = useAppData()
  const cam = getCameraById(reservation.cameraId)
  const canManage = isAdmin || reservation.teamId === myTeam

  return (
    <Modal title="예약 상세 정보" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <TeamBadge teamId={reservation.teamId} />
          <span className="flex items-center gap-1 text-base font-bold text-slate-800">
            <Video size={15} />
            {cam.label} ({cam.model})
          </span>
          <StatusBadge status={reservation.status} />
          {reservation.isBroadcast && <BroadcastBadge />}
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3.5 text-base text-slate-600">
          <p className="font-bold text-slate-700">
            {formatDateTime(reservation.startAt)} ~ {formatDateTime(reservation.endAt)}
          </p>
          <p className="mt-1">{reservation.purpose}</p>
        </div>

        <div>
          <p className="mb-1.5 text-base font-bold text-slate-700">부속 기자재</p>
          {reservation.accessories.length === 0 ? (
            <p className="text-sm text-slate-400">선택된 기자재 없음</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {reservation.accessories.map((id) => {
                const item = getAccessoryById(id)
                return (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500"
                  >
                    <Tag size={11} />
                    {formatAccessory(item)}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-base font-bold text-slate-700">반납 여부</p>
          {reservation.returnedAt ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 size={14} />
              반납 완료:{' '}
              {new Date(reservation.returnedAt).toLocaleString('ko-KR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              {reservation.status === '취소됨'
                ? '취소된 예약입니다.'
                : '아직 반납되지 않았습니다.'}
            </p>
          )}
        </div>

        {reservation.status === '대여중' && !canManage && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3.5 text-sm font-semibold text-amber-700">
            <AlertTriangle size={16} className="shrink-0" />
            {getTeamLabel(reservation.teamId)}만 예약 변경 및 취소가 가능합니다.
          </div>
        )}

        {reservation.status === '대여중' && canManage && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-5">
            {isAdmin && reservation.teamId !== myTeam && (
              <span className="mr-auto flex items-center gap-1 self-center text-xs font-bold text-[#3182f6]">
                <ShieldCheck size={14} />
                관리자 권한으로 조작 중
              </span>
            )}
            <button
              onClick={() => onEdit(reservation)}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700 hover:bg-slate-200"
            >
              <Pencil size={15} />
              예약 변경
            </button>
            <button
              onClick={() => onCancel(reservation.id)}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-red-50 px-4 text-sm font-bold text-red-600 hover:bg-red-100"
            >
              <X size={15} />
              예약 취소
            </button>
            <button
              onClick={() => onReturnClick(reservation)}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              <CheckCircle2 size={15} />
              반납 처리
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 대한민국 공휴일 (달력 스타일링 전용 - 예약 로직에는 영향 없음)
// ----------------------------------------------------------------------------------
// 신정/삼일절/어린이날/현충일/광복절/개천절/한글날/크리스마스는 매년 고정된 양력 날짜라
// 아래에서 대체공휴일 규정(설날·추석·어린이날·삼일절·광복절·개천절·한글날이 토·일 또는
// 다른 공휴일과 겹치면 다음 평일을 대체공휴일로 지정)까지 함께 계산한다.
// 설날 연휴/추석 연휴/부처님오신날은 음력 기준이라 연도마다 날짜가 달라 계산이 불가능하므로
// 확정된 공식 날짜를 LUNAR_HOLIDAYS에 직접 지정한다 (2024~2026년 확정 기준, 이후 연도는
// 정부 발표 후 갱신 필요).

interface HolidayEntry {
  date: string
  name: string
}

const FIXED_HOLIDAYS: { month: number; day: number; name: string; substitutable: boolean }[] = [
  { month: 1, day: 1, name: '신정', substitutable: false },
  { month: 3, day: 1, name: '삼일절', substitutable: true },
  { month: 5, day: 5, name: '어린이날', substitutable: true },
  { month: 6, day: 6, name: '현충일', substitutable: false },
  { month: 8, day: 15, name: '광복절', substitutable: true },
  { month: 10, day: 3, name: '개천절', substitutable: true },
  { month: 10, day: 9, name: '한글날', substitutable: true },
  { month: 12, day: 25, name: '크리스마스', substitutable: false },
]

const LUNAR_HOLIDAYS: Record<number, HolidayEntry[]> = {
  2024: [
    { date: '2024-02-09', name: '설날 연휴' },
    { date: '2024-02-10', name: '설날' },
    { date: '2024-02-11', name: '설날 연휴' },
    { date: '2024-02-12', name: '대체공휴일' },
    { date: '2024-05-15', name: '부처님오신날' },
    { date: '2024-09-16', name: '추석 연휴' },
    { date: '2024-09-17', name: '추석' },
    { date: '2024-09-18', name: '추석 연휴' },
  ],
  2025: [
    { date: '2025-01-28', name: '설날 연휴' },
    { date: '2025-01-29', name: '설날' },
    { date: '2025-01-30', name: '설날 연휴' },
    { date: '2025-05-05', name: '부처님오신날' },
    { date: '2025-05-06', name: '대체공휴일' },
    { date: '2025-10-05', name: '추석 연휴' },
    { date: '2025-10-06', name: '추석' },
    { date: '2025-10-07', name: '추석 연휴' },
    { date: '2025-10-08', name: '대체공휴일' },
  ],
  2026: [
    { date: '2026-02-16', name: '설날 연휴' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 연휴' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-09-24', name: '추석 연휴' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 연휴' },
  ],
}

function buildFixedHolidaysForYear(year: number): HolidayEntry[] {
  const entries: HolidayEntry[] = []
  const occupied = new Set<string>((LUNAR_HOLIDAYS[year] ?? []).map((h) => h.date))

  for (const fh of FIXED_HOLIDAYS) {
    const dateObj = new Date(year, fh.month - 1, fh.day)
    const dateStr = toDateKey(dateObj)
    entries.push({ date: dateStr, name: fh.name })
    occupied.add(dateStr)

    if (fh.substitutable && (dateObj.getDay() === 0 || dateObj.getDay() === 6)) {
      const sub = new Date(dateObj)
      do {
        sub.setDate(sub.getDate() + 1)
      } while (sub.getDay() === 0 || sub.getDay() === 6 || occupied.has(toDateKey(sub)))
      const subStr = toDateKey(sub)
      entries.push({ date: subStr, name: '대체공휴일' })
      occupied.add(subStr)
    }
  }
  return entries
}

const HOLIDAY_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>()
  const addEntry = (date: string, name: string) => {
    const arr = map.get(date) ?? []
    arr.push(name)
    map.set(date, arr)
  }
  for (let year = 2024; year <= 2027; year++) {
    for (const h of buildFixedHolidaysForYear(year)) addEntry(h.date, h.name)
    for (const h of LUNAR_HOLIDAYS[year] ?? []) addEntry(h.date, h.name)
  }
  return map
})()

function getHolidayNames(dateKey: string): string[] {
  return HOLIDAY_MAP.get(dateKey) ?? []
}

// ----------------------------------------------------------------------------------
// 화면 폭 감지 (모바일 미니 달력 vs PC/태블릿 그리드 분기)
// ----------------------------------------------------------------------------------

function useIsMobile(breakpointPx = 640): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpointPx,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const handler = () => setIsMobile(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpointPx])
  return isMobile
}

// ----------------------------------------------------------------------------------
// 다중 일자(연속) 예약 - 주 단위 연결 바 계산
// ----------------------------------------------------------------------------------

const BAR_LANE_HEIGHT = 24
const BAR_ROW_TOP = 40

function getOccupiedDateRange(r: Reservation): { start: Date; end: Date } {
  const startRaw = new Date(r.startAt)
  let endRaw = new Date(r.endAt)
  // 종료 시각이 정각 자정이면 그 날짜를 실제로 점유하지 않으므로 전날을 마지막 점유일로 본다.
  if (endRaw.getHours() === 0 && endRaw.getMinutes() === 0 && endRaw.getTime() > startRaw.getTime()) {
    endRaw = new Date(endRaw.getTime() - 60 * 1000)
  }
  const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate())
  const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate())
  return { start, end }
}

function isMultiDayReservation(r: Reservation): boolean {
  const { start, end } = getOccupiedDateRange(r)
  return end.getTime() > start.getTime()
}

interface BarSegment {
  reservation: Reservation
  startCol: number
  endCol: number
  isActualStart: boolean
  isActualEnd: boolean
  lane: number
}

function buildWeekBarSegments(weekDays: Date[], reservations: Reservation[]): BarSegment[] {
  const weekStart = weekDays[0].getTime()
  const weekEnd = weekDays[6].getTime()

  const segments: BarSegment[] = reservations
    .filter(isMultiDayReservation)
    .map((r) => ({ r, ...getOccupiedDateRange(r) }))
    .filter(({ start, end }) => start.getTime() <= weekEnd && end.getTime() >= weekStart)
    .map(({ r, start, end }) => {
      const clampedStartTime = Math.max(start.getTime(), weekStart)
      const clampedEndTime = Math.min(end.getTime(), weekEnd)
      const startCol = Math.round((clampedStartTime - weekStart) / 86400000)
      const endCol = Math.round((clampedEndTime - weekStart) / 86400000)
      return {
        reservation: r,
        startCol,
        endCol,
        isActualStart: start.getTime() === clampedStartTime,
        isActualEnd: end.getTime() === clampedEndTime,
        lane: 0,
      }
    })
    .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol)

  const laneEnds: number[] = []
  for (const seg of segments) {
    let laneIndex = laneEnds.findIndex((end) => end < seg.startCol)
    if (laneIndex === -1) {
      laneIndex = laneEnds.length
      laneEnds.push(seg.endCol)
    } else {
      laneEnds[laneIndex] = seg.endCol
    }
    seg.lane = laneIndex
  }
  return segments
}

// ----------------------------------------------------------------------------------
// 월간 달력 뷰
// ----------------------------------------------------------------------------------

function CalendarView({
  reservations,
  onDayClick,
  onChipClick,
}: {
  reservations: Reservation[]
  onDayClick: (dateKey: string) => void
  onChipClick: (reservation: Reservation) => void
}) {
  const { cameras, getTeamLabel, getCameraById } = useAppData()
  const isMobile = useIsMobile()
  const today = new Date()
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  )
  const [cameraFilter, setCameraFilter] = useState<'전체' | CameraId>('전체')
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const todayKey = toDateKey(today)

  const gridDays = useMemo(() => getCalendarGridDays(year, month), [year, month])
  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < gridDays.length; i += 7) result.push(gridDays.slice(i, i + 7))
    return result
  }, [gridDays])

  const visibleReservations = useMemo(
    () =>
      reservations.filter(
        (r) =>
          r.status !== '취소됨' &&
          (cameraFilter === '전체' || r.cameraId === cameraFilter),
      ),
    [reservations, cameraFilter],
  )

  function goToPrevMonth() {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  }
  function goToNextMonth() {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
  }
  function goToToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  function dateNumberColorClass(day: Date, isToday: boolean, isCurrentMonth: boolean): string {
    if (isToday) return 'text-white'
    if (!isCurrentMonth) return 'text-slate-300'
    const dateKey = toDateKey(day)
    const isHoliday = getHolidayNames(dateKey).length > 0
    if (day.getDay() === 0 || isHoliday) return 'text-red-500'
    if (day.getDay() === 6) return 'text-blue-500'
    return 'text-slate-700'
  }

  const selectedDayReservations = useMemo(() => {
    if (!selectedDateKey) return []
    const [y, m, d] = selectedDateKey.split('-').map(Number)
    const selectedDate = new Date(y, m - 1, d)
    return visibleReservations
      .filter((r) => reservationOverlapsDay(r, selectedDate))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }, [selectedDateKey, visibleReservations])

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-3 p-3.5 ${CARD}`}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToPrevMonth}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
            aria-label="이전 달"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="w-32 text-center text-lg font-extrabold text-slate-800">
            {year}년 {month + 1}월
          </span>
          <button
            onClick={goToNextMonth}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
            aria-label="다음 달"
          >
            <ChevronRight size={20} />
          </button>
          <button
            onClick={goToToday}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            오늘
          </button>
        </div>

        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            onClick={() => setCameraFilter('전체')}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition ${
              cameraFilter === '전체'
                ? 'border-[#3182f6] bg-[#3182f6] text-white'
                : 'border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            전체 보기
          </button>
          {cameras.map((cam) => (
            <button
              key={cam.id}
              onClick={() => setCameraFilter(cam.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition ${
                cameraFilter === cam.id
                  ? 'border-[#3182f6] bg-[#3182f6] text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {cam.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`overflow-hidden ${CARD}`}>
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`px-2 py-3 text-center text-base font-bold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-500'
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        {weeks.map((week, weekIndex) => {
          const segments = isMobile ? [] : buildWeekBarSegments(week, visibleReservations)
          const maxLanes = segments.length > 0 ? Math.max(...segments.map((s) => s.lane)) + 1 : 0
          const barsHeight = maxLanes * BAR_LANE_HEIGHT

          return (
            <div key={weekIndex} className="relative grid grid-cols-7">
              {week.map((day) => {
                const dateKey = toDateKey(day)
                const isCurrentMonth = day.getMonth() === month
                const isToday = dateKey === todayKey
                const holidayNames = getHolidayNames(dateKey)
                const isSelected = selectedDateKey === dateKey

                const dayReservations = isMobile
                  ? visibleReservations.filter((r) => reservationOverlapsDay(r, day))
                  : visibleReservations.filter(
                      (r) => reservationOverlapsDay(r, day) && !isMultiDayReservation(r),
                    )

                const dotTeams = isMobile
                  ? Array.from(new Set(dayReservations.map((r) => r.teamId))).map(getTeam)
                  : []

                return (
                  <div
                    key={dateKey}
                    onClick={() =>
                      isMobile
                        ? setSelectedDateKey((prev) => (prev === dateKey ? null : dateKey))
                        : onDayClick(dateKey)
                    }
                    className={`min-h-16 cursor-pointer border-b border-r border-slate-100 p-2 transition hover:bg-slate-50 sm:min-h-[132px] sm:p-2 md:min-h-[168px] ${
                      isCurrentMonth ? 'bg-white' : 'bg-slate-50/60'
                    } ${isSelected ? 'ring-2 ring-inset ring-[#3182f6]' : ''}`}
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold sm:h-9 sm:w-9 sm:text-lg ${dateNumberColorClass(day, isToday, isCurrentMonth)}`}
                        style={isToday ? { backgroundColor: TOSS_BLUE } : undefined}
                      >
                        {day.getDate()}
                      </span>
                      {!isMobile && holidayNames.length > 0 && (
                        <span className="truncate text-[10px] font-bold text-red-500 sm:text-xs">
                          {holidayNames[0]}
                        </span>
                      )}
                    </div>

                    {isMobile ? (
                      dotTeams.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {dotTeams.slice(0, 4).map((t) => (
                            <span key={t.id} className={`h-2 w-2 rounded-full ${t.color}`} />
                          ))}
                          {dotTeams.length > 4 && (
                            <span className="text-[10px] font-bold text-slate-400">
                              +{dotTeams.length - 4}
                            </span>
                          )}
                        </div>
                      )
                    ) : (
                      <>
                        {barsHeight > 0 && <div style={{ height: barsHeight }} />}
                        <div className="mt-1.5 max-h-[94px] space-y-1.5 overflow-y-auto pr-0.5 sm:max-h-[124px]">
                          {dayReservations.map((r) => {
                            const team = getTeam(r.teamId)
                            const teamLabel = getTeamLabel(r.teamId)
                            const camLabel = getCameraById(r.cameraId).model
                            return (
                              <button
                                key={r.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onChipClick(r)
                                }}
                                title={`[${teamLabel}] ${camLabel} (${formatTimeOnly(r.startAt)}~${formatTimeOnly(r.endAt)})${
                                  r.isBroadcast ? ' · 방송국' : ''
                                }`}
                                className={`flex w-full items-center gap-1 truncate rounded-lg px-1.5 py-1 text-left text-xs font-bold text-white sm:text-sm ${team.color} hover:opacity-90`}
                              >
                                <span className="truncate">
                                  [{teamLabel}] {camLabel} ({formatTimeOnly(r.startAt)}~
                                  {formatTimeOnly(r.endAt)})
                                </span>
                                {r.isBroadcast && (
                                  <span className="flex shrink-0 items-center gap-0.5 rounded bg-white/25 px-1 py-0.5 text-[9px] font-bold">
                                    <Radio size={9} />
                                    방송국
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}

              {!isMobile && maxLanes > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0"
                  style={{ top: BAR_ROW_TOP }}
                >
                  {segments.map((seg) => {
                    const team = getTeam(seg.reservation.teamId)
                    const teamLabel = getTeamLabel(seg.reservation.teamId)
                    const camLabel = getCameraById(seg.reservation.cameraId).model
                    return (
                      <button
                        key={seg.reservation.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          onChipClick(seg.reservation)
                        }}
                        title={`[${teamLabel}] ${camLabel} (${formatDateTime(seg.reservation.startAt)} ~ ${formatDateTime(seg.reservation.endAt)})${
                          seg.reservation.isBroadcast ? ' · 방송국' : ''
                        }`}
                        className={`pointer-events-auto absolute flex items-center overflow-hidden text-xs font-bold text-white sm:text-sm ${team.color} ${
                          seg.isActualStart ? 'rounded-l-lg pl-1.5' : ''
                        } ${seg.isActualEnd ? 'rounded-r-lg' : ''} hover:opacity-90`}
                        style={{
                          left: `${(seg.startCol / 7) * 100}%`,
                          width: `${((seg.endCol - seg.startCol + 1) / 7) * 100}%`,
                          top: seg.lane * BAR_LANE_HEIGHT,
                          height: BAR_LANE_HEIGHT - 4,
                        }}
                      >
                        {seg.isActualStart && (
                          <span className="truncate">
                            [{teamLabel}] {camLabel}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isMobile && (
        <div className={`space-y-3 p-4 ${CARD}`}>
          {selectedDateKey ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-slate-800">
                  {selectedDateKey.slice(5).replace('-', '월 ')}일
                  {getHolidayNames(selectedDateKey).length > 0 && (
                    <span className="ml-2 text-sm font-bold text-red-500">
                      {getHolidayNames(selectedDateKey).join(' · ')}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => onDayClick(selectedDateKey)}
                  className="flex h-10 items-center gap-1 rounded-xl bg-[#3182f6] px-3.5 text-sm font-bold text-white"
                >
                  <Plus size={15} />
                  새 예약
                </button>
              </div>
              {selectedDayReservations.length === 0 ? (
                <p className="py-6 text-center text-base text-slate-400">
                  이 날짜에 등록된 예약이 없습니다.
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedDayReservations.map((r) => (
                    <ReservationRow
                      key={r.id}
                      reservation={r}
                      showCamera
                      onClick={() => onChipClick(r)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="py-6 text-center text-base text-slate-400">
              날짜를 선택하면 예약 상세 목록이 여기에 표시됩니다.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 px-1 text-sm font-medium text-slate-500">
        {TEAMS.map((t) => (
          <span key={t.id} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${t.color}`} />
            {getTeamLabel(t.id)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 예약 내역 한 줄
// ----------------------------------------------------------------------------------

function ReservationRow({
  reservation,
  showCamera,
  onClick,
}: {
  reservation: Reservation
  showCamera?: boolean
  onClick: () => void
}) {
  const { getCameraById, getAccessoryById } = useAppData()
  const team = getTeam(reservation.teamId)
  const cam = getCameraById(reservation.cameraId)
  const now = Date.now()
  const start = new Date(reservation.startAt).getTime()
  const end = new Date(reservation.endAt).getTime()
  const timing =
    reservation.status !== '대여중'
      ? null
      : end < now
        ? '지난 예약'
        : start > now
          ? '예정'
          : '진행 중'

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border-l-4 px-4 py-3 text-left transition hover:brightness-95 ${team.borderColor} ${team.softBg}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TeamBadge teamId={reservation.teamId} size="sm" />
        {showCamera && (
          <span className="flex items-center gap-1 text-sm font-bold text-slate-700">
            <Video size={13} />
            {cam.label}
          </span>
        )}
        <StatusBadge status={reservation.status} />
        {reservation.isBroadcast && <BroadcastBadge />}
        {timing && (
          <span className="text-xs font-bold text-slate-400">{timing}</span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-bold text-slate-600">
        {formatDateTime(reservation.startAt)} ~ {formatDateTime(reservation.endAt)}
      </p>
      <p className="mt-0.5 text-sm text-slate-500">{reservation.purpose}</p>
      {reservation.accessories.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {reservation.accessories.map((id) => (
            <span
              key={id}
              className="rounded-full bg-white/70 px-1.5 py-0.5 text-xs text-slate-500"
            >
              {formatAccessory(getAccessoryById(id))}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

// ----------------------------------------------------------------------------------
// 장비별 현황 뷰
// ----------------------------------------------------------------------------------

function EquipmentStatusView({
  reservations,
  onSelect,
}: {
  reservations: Reservation[]
  onSelect: (r: Reservation) => void
}) {
  const { cameras, accessories } = useAppData()
  const now = Date.now()
  const accessoryGroups = useMemo(
    () => groupAccessoriesByCategory(accessories),
    [accessories],
  )

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h2 className="flex items-center gap-1.5 text-xl font-extrabold text-slate-800">
          <Video size={18} />
          카메라
        </h2>
        {cameras.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-16 text-slate-400 ${CARD}`}>
            <Video size={36} className="mb-2" />
            <p className="text-base">
              등록된 카메라가 없습니다. 관리자 설정에서 카메라를 추가해주세요.
            </p>
          </div>
        )}
        {cameras.map((cam) => {
          const history = reservations
            .filter((r) => r.cameraId === cam.id && r.status !== '취소됨')
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
          const inUse = history.some(
            (r) =>
              r.status === '대여중' &&
              new Date(r.startAt).getTime() <= now &&
              new Date(r.endAt).getTime() >= now,
          )

          return (
            <div key={cam.id} className={`p-5 ${CARD}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-600">
                    <Video size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-800">{cam.label}</h3>
                    <p className="text-sm text-slate-400">{cam.model}</p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${
                    inUse ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {inUse ? '사용 중' : '대여 가능'}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-1.5 text-sm font-bold text-slate-500">
                <History size={14} />
                예약 히스토리 ({history.length}건)
              </div>

              {history.length === 0 ? (
                <p className="mt-2 py-3 text-center text-base text-slate-400">
                  예약 내역이 없습니다.
                </p>
              ) : (
                <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {history.map((r) => (
                    <ReservationRow key={r.id} reservation={r} onClick={() => onSelect(r)} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-4">
        <h2 className="flex items-center gap-1.5 text-xl font-extrabold text-slate-800">
          <Package size={18} />
          부가 장비 (품목별 아코디언 · 라벨 번호)
        </h2>
        {accessoryGroups.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-16 text-slate-400 ${CARD}`}>
            <Package size={36} className="mb-2" />
            <p className="text-base">등록된 부가 장비가 없습니다. 관리자 설정에서 추가해주세요.</p>
          </div>
        )}
        {accessoryGroups.map(({ category, items }) => {
          const Icon = getAccessoryIcon(category)
          const availableCount = items.filter((item) => {
            const history = reservations.filter(
              (r) => r.accessories.includes(item.id) && r.status !== '취소됨',
            )
            return !history.some(
              (r) =>
                r.status === '대여중' &&
                new Date(r.startAt).getTime() <= now &&
                new Date(r.endAt).getTime() >= now,
            )
          }).length

          return (
            <details key={category} className={`group overflow-hidden ${CARD}`} open>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-600">
                  <Icon size={20} />
                </div>
                <h3 className="text-lg font-extrabold text-slate-800">{category}</h3>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
                  {availableCount}/{items.length} 대여 가능
                </span>
                <ChevronDown
                  size={18}
                  className="ml-auto text-slate-400 transition group-open:rotate-180"
                />
              </summary>
              <div className="space-y-3 border-t border-slate-100 px-5 pb-5 pt-4">
                {items.map((item) => {
                  const history = reservations
                    .filter((r) => r.accessories.includes(item.id) && r.status !== '취소됨')
                    .sort(
                      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
                    )
                  const inUse = history.some(
                    (r) =>
                      r.status === '대여중' &&
                      new Date(r.startAt).getTime() <= now &&
                      new Date(r.endAt).getTime() >= now,
                  )

                  return (
                    <div key={item.id} className="rounded-xl border border-slate-100 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-base font-bold text-slate-700">
                          <Tag size={14} />
                          {item.label}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            inUse
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {inUse ? '사용 중' : '대여 가능'}
                        </span>
                      </div>

                      {history.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-400">예약 내역이 없습니다.</p>
                      ) : (
                        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                          {history.map((r) => (
                            <ReservationRow
                              key={r.id}
                              reservation={r}
                              showCamera
                              onClick={() => onSelect(r)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 조별 현황 뷰
// ----------------------------------------------------------------------------------

function TeamStatusView({
  reservations,
  onSelect,
}: {
  reservations: Reservation[]
  onSelect: (r: Reservation) => void
}) {
  const { getTeamLabel, renameTeam } = useAppData()
  const [activeTeam, setActiveTeam] = useState<TeamId>('1조')
  const [editingTeam, setEditingTeam] = useState<TeamId | null>(null)
  const [draftName, setDraftName] = useState('')
  const team = getTeam(activeTeam)

  const teamReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.teamId === activeTeam)
        .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()),
    [reservations, activeTeam],
  )

  function startEdit(t: TeamId) {
    setEditingTeam(t)
    setDraftName(getTeamLabel(t))
  }

  function saveEdit(t: TeamId) {
    const trimmed = draftName.trim()
    if (trimmed) renameTeam(t, trimmed)
    setEditingTeam(null)
  }

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap gap-2 p-3.5 ${CARD}`}>
        {TEAMS.map((t) => {
          const label = getTeamLabel(t.id)
          const active = activeTeam === t.id

          if (editingTeam === t.id) {
            return (
              <div
                key={t.id}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 ${t.softBg} ${t.borderColor}`}
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(t.id)
                    if (e.key === 'Escape') setEditingTeam(null)
                  }}
                  maxLength={20}
                  className="w-24 rounded border border-slate-300 bg-white px-1.5 py-1 text-base focus:border-[#3182f6] focus:outline-none"
                />
                <button
                  onClick={() => saveEdit(t.id)}
                  className="rounded p-1 text-emerald-600 hover:bg-white"
                  aria-label="이름 저장"
                >
                  <Check size={15} />
                </button>
                <button
                  onClick={() => setEditingTeam(null)}
                  className="rounded p-1 text-slate-400 hover:bg-white"
                  aria-label="편집 취소"
                >
                  <X size={15} />
                </button>
              </div>
            )
          }

          return (
            <div
              key={t.id}
              className={`flex items-center gap-1 rounded-full border py-1.5 pl-4 pr-1.5 text-base font-bold transition ${
                active
                  ? `${t.color} border-transparent text-white`
                  : `${t.softBg} ${t.textColor} ${t.borderColor}`
              }`}
            >
              <button onClick={() => setActiveTeam(t.id)}>{label}</button>
              <button
                onClick={() => startEdit(t.id)}
                className="rounded-full p-1.5 opacity-70 hover:bg-black/10 hover:opacity-100"
                aria-label={`${label} 이름 수정`}
              >
                <Pencil size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className={`rounded-2xl border-2 p-5 ${team.borderColor} ${team.softBg}`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-xl font-extrabold ${team.textColor}`}>
            {getTeamLabel(activeTeam)} 예약 내역
          </h3>
          <span className="text-sm font-bold text-slate-500">
            총 {teamReservations.length}건
          </span>
        </div>

        {teamReservations.length === 0 ? (
          <p className="mt-6 py-6 text-center text-base text-slate-400">
            등록된 예약이 없습니다.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {teamReservations.map((r) => (
              <ReservationRow
                key={r.id}
                reservation={r}
                showCamera
                onClick={() => onSelect(r)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 관리자 비밀번호 인증 모달
// ----------------------------------------------------------------------------------

function PasswordModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleSubmit() {
    if (password === ADMIN_PASSWORD) {
      onSuccess()
    } else {
      setError('비밀번호가 일치하지 않습니다.')
      setPassword('')
    }
  }

  return (
    <Modal title="관리자 인증" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-base text-slate-500">
          관리자 설정에 접근하려면 비밀번호를 입력하세요.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
          placeholder="비밀번호 입력"
          className={`${INPUT} h-12`}
        />
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={SECONDARY_BTN}>
            취소
          </button>
          <button
            onClick={handleSubmit}
            className={PRIMARY_BTN}
            style={{ backgroundColor: TOSS_BLUE }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE_HOVER)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE)}
          >
            확인
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 관리자 설정 패널
// ----------------------------------------------------------------------------------

function AdminPanel({
  onClose,
  onLogout,
}: {
  onClose: () => void
  onLogout: () => void
}) {
  const {
    cameras,
    accessories,
    addCamera,
    removeCamera,
    addAccessory,
    removeAccessory,
    confirmAction,
  } = useAppData()
  const [newCameraLabel, setNewCameraLabel] = useState('')
  const [newCameraModel, setNewCameraModel] = useState('')
  const [newAccessoryCategory, setNewAccessoryCategory] = useState('')
  const [newAccessoryLabel, setNewAccessoryLabel] = useState('')
  const [error, setError] = useState('')

  function handleAddCamera() {
    if (!newCameraLabel.trim() || !newCameraModel.trim()) {
      setError('장비 식별 코드와 장비명을 모두 입력해주세요.')
      return
    }
    addCamera(newCameraLabel.trim(), newCameraModel.trim())
    setNewCameraLabel('')
    setNewCameraModel('')
    setError('')
  }

  function handleRemoveCamera(cam: CameraInfo) {
    confirmAction({
      message: `"${cam.label}" 장비를 삭제하시겠습니까? 이 장비를 참조하는 기존 예약 기록은 남아있지만, 더 이상 새 예약에 선택할 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => removeCamera(cam.id),
    })
  }

  function handleAddAccessory() {
    const category = newAccessoryCategory.trim()
    const label = newAccessoryLabel.trim()
    if (!category || !label) {
      setError('품목명과 라벨 관리번호를 모두 입력해주세요.')
      return
    }
    if (accessories.some((a) => a.label.toLowerCase() === label.toLowerCase())) {
      setError('이미 등록된 라벨 번호입니다.')
      return
    }
    addAccessory(category, label)
    setNewAccessoryCategory('')
    setNewAccessoryLabel('')
    setError('')
  }

  function handleRemoveAccessory(item: AccessoryItem) {
    confirmAction({
      message: `"${formatAccessory(item)}" 장비를 삭제하시겠습니까? 이 장비를 참조하는 기존 예약 기록은 남아있지만, 더 이상 새 예약에 선택할 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => removeAccessory(item.id),
    })
  }

  return (
    <Modal title="관리자 설정" onClose={onClose}>
      <div className="space-y-7">
        <div className="flex justify-end">
          <button
            onClick={onLogout}
            className="flex items-center gap-1 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200"
          >
            <LogOut size={14} />
            로그아웃
          </button>
        </div>

        <div>
          <h3 className="mb-2.5 flex items-center gap-1.5 text-lg font-extrabold text-slate-700">
            <Video size={17} />
            카메라 관리
          </h3>
          <div className="space-y-2">
            {cameras.length === 0 && (
              <p className="text-base text-slate-400">등록된 카메라가 없습니다.</p>
            )}
            {cameras.map((cam) => (
              <div
                key={cam.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
              >
                <div>
                  <p className="text-base font-bold text-slate-700">{cam.label}</p>
                  <p className="text-sm text-slate-400">{cam.model}</p>
                </div>
                <button
                  onClick={() => handleRemoveCamera(cam)}
                  className="rounded-xl p-2 text-red-500 hover:bg-red-50"
                  aria-label={`${cam.label} 삭제`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={newCameraLabel}
              onChange={(e) => setNewCameraLabel(e.target.value)}
              placeholder="장비 식별 코드 (예: Camera D)"
              className={`${INPUT} h-12 flex-1`}
            />
            <input
              value={newCameraModel}
              onChange={(e) => setNewCameraModel(e.target.value)}
              placeholder="장비명 (예: Sony A7M4)"
              className={`${INPUT} h-12 flex-1`}
            />
            <button
              onClick={handleAddCamera}
              className={PRIMARY_BTN}
              style={{ backgroundColor: TOSS_BLUE }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE)}
            >
              <Plus size={16} />
              추가
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-2.5 flex items-center gap-1.5 text-lg font-extrabold text-slate-700">
            <Tag size={17} />
            부가 장비 관리 (라벨 번호)
          </h3>
          <div className="space-y-2">
            {accessories.length === 0 && (
              <p className="text-base text-slate-400">등록된 기자재가 없습니다.</p>
            )}
            {accessories.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
              >
                <div>
                  <p className="text-base font-bold text-slate-700">
                    {formatAccessory(item)}
                  </p>
                  <p className="text-sm text-slate-400">{item.category}</p>
                </div>
                <button
                  onClick={() => handleRemoveAccessory(item)}
                  className="rounded-xl p-2 text-red-500 hover:bg-red-50"
                  aria-label={`${formatAccessory(item)} 삭제`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={newAccessoryCategory}
              onChange={(e) => setNewAccessoryCategory(e.target.value)}
              placeholder="품목명 (예: SD카드)"
              className={`${INPUT} h-12 flex-1`}
            />
            <input
              value={newAccessoryLabel}
              onChange={(e) => setNewAccessoryLabel(e.target.value)}
              placeholder="라벨 관리번호 (예: SD-03)"
              className={`${INPUT} h-12 flex-1`}
            />
            <button
              onClick={handleAddAccessory}
              className={PRIMARY_BTN}
              style={{ backgroundColor: TOSS_BLUE }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE)}
            >
              <Plus size={16} />
              추가
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 메인 App 컴포넌트
// ----------------------------------------------------------------------------------

export default function App() {
  const [reservations, setReservations] = useState<Reservation[]>(loadReservations)
  const [teamNames, setTeamNames] = useState<Record<TeamId, string>>(loadTeamNames)
  const [cameras, setCameras] = useState<CameraInfo[]>(loadCameras)
  const [accessories, setAccessories] = useState<AccessoryItem[]>(loadAccessories)
  const [myTeam, setMyTeam] = useState<TeamId>(loadMyTeam)
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(
    isSupabaseConfigured ? 'checking' : 'offline',
  )
  const [tab, setTab] = useState<'calendar' | 'equipment' | 'team'>('calendar')
  const [reservationModalState, setReservationModalState] =
    useState<ReservationModalState | null>(null)
  const [detailTarget, setDetailTarget] = useState<Reservation | null>(null)
  const [returnTarget, setReturnTarget] = useState<Reservation | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string
    confirmLabel?: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)
  const [adminAuthed, setAdminAuthed] = useState(
    () => sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true',
  )
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)

  // ---- localStorage는 항상 최신 상태의 로컬 캐시 겸 폴백으로 유지한다 ----
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reservations))
  }, [reservations])

  useEffect(() => {
    localStorage.setItem(TEAM_NAMES_STORAGE_KEY, JSON.stringify(teamNames))
  }, [teamNames])

  useEffect(() => {
    localStorage.setItem(CAMERAS_STORAGE_KEY, JSON.stringify(cameras))
  }, [cameras])

  useEffect(() => {
    localStorage.setItem(ACCESSORIES_STORAGE_KEY, JSON.stringify(accessories))
  }, [accessories])

  useEffect(() => {
    localStorage.setItem(MY_TEAM_STORAGE_KEY, myTeam)
  }, [myTeam])

  // ---- Supabase 초기 로드 + 실시간 구독 (설정이 없거나 실패하면 localStorage 폴백 유지) ----
  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    fetchAllCloudData()
      .then((data) => {
        if (cancelled) return
        setReservations(data.reservations)
        setCameras(data.cameras)
        setAccessories(data.accessories)
        setTeamNames(data.teamNames)
        setCloudStatus('online')
      })
      .catch((err) => {
        console.error('[Supabase] 초기 데이터 로드 실패, 이 브라우저의 localStorage로 계속합니다.', err)
        if (!cancelled) setCloudStatus('offline')
      })

    const unsubscribe = subscribeToCloudChanges({
      onReservationChange: (payload: RealtimePostgresChangesPayload<ReservationRow>) => {
        setReservations((prev) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id
            return prev.filter((r) => r.id !== oldId)
          }
          const next = rowToReservation(payload.new as ReservationRow)
          const exists = prev.some((r) => r.id === next.id)
          return exists ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next]
        })
      },
      onCameraChange: (payload) => {
        setCameras((prev) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id
            return prev.filter((c) => c.id !== oldId)
          }
          const next = payload.new as CameraInfo
          const exists = prev.some((c) => c.id === next.id)
          return exists ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next]
        })
      },
      onAccessoryChange: (payload) => {
        setAccessories((prev) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id
            return prev.filter((a) => a.id !== oldId)
          }
          const next = payload.new as AccessoryItem
          const exists = prev.some((a) => a.id === next.id)
          return exists ? prev.map((a) => (a.id === next.id ? next : a)) : [...prev, next]
        })
      },
      onTeamNameChange: (payload) => {
        if (payload.eventType === 'DELETE') return
        const row = payload.new as TeamNameRow
        setTeamNames((prev) => ({ ...prev, [row.id]: row.name }))
      },
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const availableCameraCount = useMemo(() => {
    const now = Date.now()
    const cameraIds = new Set(cameras.map((c) => c.id))
    const busy = new Set(
      reservations
        .filter(
          (r) =>
            r.status === '대여중' &&
            cameraIds.has(r.cameraId) &&
            new Date(r.startAt).getTime() <= now &&
            new Date(r.endAt).getTime() >= now,
        )
        .map((r) => r.cameraId),
    )
    return cameras.length - busy.size
  }, [reservations, cameras])

  function handleSaveReservation(reservation: Reservation) {
    setReservations((prev) => {
      const exists = prev.some((r) => r.id === reservation.id)
      return exists
        ? prev.map((r) => (r.id === reservation.id ? reservation : r))
        : [...prev, reservation]
    })
    persistReservation(reservation)
    setReservationModalState(null)
    setDetailTarget(null)
  }

  function openNewReservation(presetDate?: string) {
    setReservationModalState({ mode: 'create', presetDate })
  }

  function openEditReservation(reservation: Reservation) {
    setReservationModalState({ mode: 'edit', reservation })
    setDetailTarget(null)
  }

  function handleReturnConfirmed(id: string) {
    const returnedAt = new Date().toISOString()
    const nowInput = nowLocalInput()
    let updated: Reservation | undefined
    setReservations((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        // 조기 반납이면 종료 시각을 실제 반납 시점으로 단축해 잔여 시간을 즉시 해제한다.
        const isEarlyReturn = new Date(nowInput).getTime() < new Date(r.endAt).getTime()
        updated = {
          ...r,
          status: '반납완료',
          returnedAt,
          endAt: isEarlyReturn ? nowInput : r.endAt,
        }
        return updated
      }),
    )
    if (updated) persistReservation(updated)
    setReturnTarget(null)
    setDetailTarget(null)
  }

  function handleCancel(id: string) {
    setConfirmDialog({
      message: '이 예약을 취소하시겠습니까? 취소된 예약은 기록 없이 완전히 삭제되며 복구할 수 없습니다.',
      confirmLabel: '예약 취소',
      danger: true,
      onConfirm: () => {
        setReservations((prev) => prev.filter((r) => r.id !== id))
        deleteReservationRemote(id)
        setDetailTarget(null)
      },
    })
  }

  function getTeamLabel(id: TeamId): string {
    return teamNames[id] ?? id
  }

  function getCameraById(id: string): CameraInfo {
    return cameras.find((c) => c.id === id) ?? { id, label: '삭제된 장비', model: '' }
  }

  function getAccessoryById(id: AccessoryId): AccessoryItem {
    return (
      accessories.find((a) => a.id === id) ?? {
        id,
        category: '삭제된 장비',
        label: id,
      }
    )
  }

  function renameTeam(id: TeamId, name: string) {
    setTeamNames((prev) => ({ ...prev, [id]: name }))
    persistTeamName(id, name)
  }

  function addCamera(label: string, model: string) {
    const camera: CameraInfo = { id: generateId(), label, model }
    setCameras((prev) => [...prev, camera])
    persistCamera(camera)
  }

  function removeCamera(id: string) {
    setCameras((prev) => prev.filter((c) => c.id !== id))
    deleteCameraRemote(id)
  }

  function addAccessory(category: string, label: string) {
    const item: AccessoryItem = { id: generateId(), category, label }
    setAccessories((prev) => [...prev, item])
    persistAccessory(item)
  }

  function removeAccessory(id: AccessoryId) {
    setAccessories((prev) => prev.filter((a) => a.id !== id))
    deleteAccessoryRemote(id)
  }

  function handleAdminLogin() {
    setAdminAuthed(true)
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true')
    setShowPasswordModal(false)
    setShowAdminPanel(true)
  }

  function handleAdminLogout() {
    setAdminAuthed(false)
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setShowAdminPanel(false)
  }

  const appDataValue: AppDataContextValue = {
    teamNames,
    cameras,
    accessories,
    myTeam,
    isAdmin: adminAuthed,
    getTeamLabel,
    getCameraById,
    getAccessoryById,
    renameTeam,
    addCamera,
    removeCamera,
    addAccessory,
    removeAccessory,
    confirmAction: setConfirmDialog,
  }

  return (
    <AppDataContext.Provider value={appDataValue}>
      <div className="min-h-screen" style={{ backgroundColor: TOSS_BG }}>
        <header className="border-b border-slate-200/70 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-5">
            <div className="flex items-center gap-2.5">
              <div className="rounded-2xl p-2.5 text-white" style={{ backgroundColor: TOSS_BLUE }}>
                <Camera size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
                  영상 촬영 장비 예약 관리
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <p className="text-sm text-slate-400">
                    지금 대여 가능 카메라 {availableCameraCount} / {cameras.length}
                  </p>
                  <CloudStatusBadge status={cloudStatus} />
                </div>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <MyTeamSwitcher myTeam={myTeam} onChange={setMyTeam} />
              <button
                onClick={() =>
                  adminAuthed ? setShowAdminPanel(true) : setShowPasswordModal(true)
                }
                className={`${SECONDARY_BTN} ${adminAuthed ? 'border-[#3182f6] text-[#3182f6]' : ''}`}
              >
                {adminAuthed ? <Unlock size={17} /> : <Lock size={17} />}
                관리자 모드
              </button>
              <button
                onClick={() => openNewReservation()}
                className={PRIMARY_BTN}
                style={{ backgroundColor: TOSS_BLUE }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE_HOVER)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = TOSS_BLUE)}
              >
                <Plus size={18} />
                새 예약 등록
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">
          <div className={`mb-5 flex gap-1.5 p-1.5 ${CARD}`}>
            <button
              onClick={() => setTab('calendar')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-base font-bold transition ${
                tab === 'calendar' ? 'text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
              style={tab === 'calendar' ? { backgroundColor: TOSS_BLUE } : undefined}
            >
              <CalendarDays size={17} />
              달력 뷰
            </button>
            <button
              onClick={() => setTab('equipment')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-base font-bold transition ${
                tab === 'equipment' ? 'text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
              style={tab === 'equipment' ? { backgroundColor: TOSS_BLUE } : undefined}
            >
              <Video size={17} />
              장비별 현황
            </button>
            <button
              onClick={() => setTab('team')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-base font-bold transition ${
                tab === 'team' ? 'text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
              style={tab === 'team' ? { backgroundColor: TOSS_BLUE } : undefined}
            >
              <Users size={17} />
              조별 현황
            </button>
          </div>

          {tab === 'calendar' && (
            <CalendarView
              reservations={reservations}
              onDayClick={(dateKey) => openNewReservation(dateKey)}
              onChipClick={(r) => setDetailTarget(r)}
            />
          )}
          {tab === 'equipment' && (
            <EquipmentStatusView
              reservations={reservations}
              onSelect={(r) => setDetailTarget(r)}
            />
          )}
          {tab === 'team' && (
            <TeamStatusView
              reservations={reservations}
              onSelect={(r) => setDetailTarget(r)}
            />
          )}
        </main>

        <footer className="border-t border-slate-200/70 py-6 text-center text-sm text-slate-400">
          <span className="flex items-center justify-center gap-1">
            {cloudStatus === 'online' ? (
              <>
                <Cloud size={13} />
                모든 데이터는 Supabase 클라우드에 실시간으로 저장 및 공유됩니다.
              </>
            ) : (
              <>
                <Mic size={13} />
                <Lightbulb size={13} />
                모든 데이터는 브라우저 localStorage에 저장됩니다.
              </>
            )}
          </span>
        </footer>

        {reservationModalState && (
          <ReservationModal
            reservations={reservations}
            myTeam={myTeam}
            state={reservationModalState}
            onClose={() => setReservationModalState(null)}
            onSubmit={handleSaveReservation}
          />
        )}

        {detailTarget && (
          <ReservationDetailModal
            reservation={detailTarget}
            myTeam={myTeam}
            isAdmin={adminAuthed}
            onClose={() => setDetailTarget(null)}
            onEdit={openEditReservation}
            onReturnClick={(r) => setReturnTarget(r)}
            onCancel={handleCancel}
          />
        )}

        {returnTarget && (
          <ReturnChecklistModal
            reservation={returnTarget}
            onClose={() => setReturnTarget(null)}
            onConfirm={handleReturnConfirmed}
          />
        )}

        {confirmDialog && (
          <ConfirmDialog
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            danger={confirmDialog.danger}
            onCancel={() => setConfirmDialog(null)}
            onConfirm={() => {
              confirmDialog.onConfirm()
              setConfirmDialog(null)
            }}
          />
        )}

        {showPasswordModal && (
          <PasswordModal
            onClose={() => setShowPasswordModal(false)}
            onSuccess={handleAdminLogin}
          />
        )}

        {showAdminPanel && (
          <AdminPanel
            onClose={() => setShowAdminPanel(false)}
            onLogout={handleAdminLogout}
          />
        )}
      </div>
    </AppDataContext.Provider>
  )
}

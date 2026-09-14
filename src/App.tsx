import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  CalendarClock,
  ListChecks,
  Plus,
  X,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Mic,
  Video,
  Battery,
  Lightbulb,
} from 'lucide-react'

// ----------------------------------------------------------------------------------
// 타입 정의
// ----------------------------------------------------------------------------------

type TeamId = '1조' | '2조' | '3조' | '4조' | '5조'
type CameraId = 'A' | 'B' | 'C'
type AccessoryId =
  | '무선 마이크 세트'
  | '삼각대'
  | '추가 배터리(2구)'
  | 'LED 지속광 조명'
  | '샷건 마이크'
type ReservationStatus = '대여중' | '반납완료' | '취소됨'

interface Team {
  id: TeamId
  label: string
  color: string // tailwind bg 계열 accent
  textColor: string
  borderColor: string
  softBg: string
}

interface CameraInfo {
  id: CameraId
  label: string
  model: string
}

interface ReturnInfo {
  sdCardFormatted: boolean
  batteryCharged: boolean
  note: string
  returnedAt: string
}

interface Reservation {
  id: string
  teamId: TeamId
  cameraId: CameraId
  accessories: AccessoryId[]
  startAt: string // datetime-local 문자열
  endAt: string
  purpose: string
  status: ReservationStatus
  createdAt: string
  returnInfo?: ReturnInfo
}

// ----------------------------------------------------------------------------------
// 상수 데이터
// ----------------------------------------------------------------------------------

const TEAMS: Team[] = [
  {
    id: '1조',
    label: '1조',
    color: 'bg-blue-500',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-400',
    softBg: 'bg-blue-50',
  },
  {
    id: '2조',
    label: '2조',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-400',
    softBg: 'bg-emerald-50',
  },
  {
    id: '3조',
    label: '3조',
    color: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-400',
    softBg: 'bg-amber-50',
  },
  {
    id: '4조',
    label: '4조',
    color: 'bg-purple-500',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-400',
    softBg: 'bg-purple-50',
  },
  {
    id: '5조',
    label: '5조',
    color: 'bg-rose-500',
    textColor: 'text-rose-700',
    borderColor: 'border-rose-400',
    softBg: 'bg-rose-50',
  },
]

const CAMERAS: CameraInfo[] = [
  { id: 'A', label: 'Camera A', model: 'Sony FX3' },
  { id: 'B', label: 'Camera B', model: 'Canon R6 Mark II' },
  { id: 'C', label: 'Camera C', model: 'Lumix S5II' },
]

const ACCESSORIES: AccessoryId[] = [
  '무선 마이크 세트',
  '삼각대',
  '추가 배터리(2구)',
  'LED 지속광 조명',
  '샷건 마이크',
]

const STORAGE_KEY = 'camera-reservation-data-v1'

// ----------------------------------------------------------------------------------
// 유틸 함수
// ----------------------------------------------------------------------------------

function getTeam(teamId: TeamId): Team {
  return TEAMS.find((t) => t.id === teamId)!
}

function getCamera(cameraId: CameraId): CameraInfo {
  return CAMERAS.find((c) => c.id === cameraId)!
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

// 두 예약 시간대가 1분이라도 겹치는지 확인 (종료==시작인 맞닿는 경우는 겹침 아님)
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

function nowLocalInput(offsetHours = 0): string {
  const d = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

// ----------------------------------------------------------------------------------
// 더미 데이터 (최초 실행 시 기본 세팅)
// ----------------------------------------------------------------------------------

function buildDummyData(): Reservation[] {
  return [
    {
      id: generateId(),
      teamId: '1조',
      cameraId: 'A',
      accessories: ['삼각대', '샷건 마이크'],
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
      accessories: ['무선 마이크 세트', '추가 배터리(2구)'],
      startAt: nowLocalInput(-6),
      endAt: nowLocalInput(-3),
      purpose: '인터뷰 촬영',
      status: '반납완료',
      createdAt: new Date().toISOString(),
      returnInfo: {
        sdCardFormatted: true,
        batteryCharged: true,
        note: '이상 없음',
        returnedAt: new Date().toISOString(),
      },
    },
    {
      id: generateId(),
      teamId: '3조',
      cameraId: 'C',
      accessories: ['LED 지속광 조명'],
      startAt: nowLocalInput(24),
      endAt: nowLocalInput(27),
      purpose: '스튜디오 제품 촬영',
      status: '대여중',
      createdAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      teamId: '4조',
      cameraId: 'A',
      accessories: ['삼각대', '무선 마이크 세트', 'LED 지속광 조명'],
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

// ----------------------------------------------------------------------------------
// 공통 UI 컴포넌트
// ----------------------------------------------------------------------------------

function TeamBadge({ teamId }: { teamId: TeamId }) {
  const team = getTeam(teamId)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${team.color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {team.label}
    </span>
  )
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  const styles: Record<ReservationStatus, string> = {
    대여중: 'bg-sky-100 text-sky-700 border-sky-300',
    반납완료: 'bg-slate-100 text-slate-600 border-slate-300',
    취소됨: 'bg-red-100 text-red-600 border-red-300',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {status}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 예약 등록 모달
// ----------------------------------------------------------------------------------

function ReservationModal({
  reservations,
  onClose,
  onSubmit,
}: {
  reservations: Reservation[]
  onClose: () => void
  onSubmit: (reservation: Reservation) => void
}) {
  const [teamId, setTeamId] = useState<TeamId>('1조')
  const [cameraId, setCameraId] = useState<CameraId>('A')
  const [accessories, setAccessories] = useState<AccessoryId[]>([])
  const [startAt, setStartAt] = useState(nowLocalInput())
  const [endAt, setEndAt] = useState(nowLocalInput(2))
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState('')

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

    const conflict = reservations.find(
      (r) =>
        r.cameraId === cameraId &&
        r.status !== '취소됨' &&
        isOverlapping(startAt, endAt, r.startAt, r.endAt),
    )

    if (conflict) {
      const cam = getCamera(cameraId)
      alert(
        `⚠ 예약 충돌 발생!\n\n${cam.label}(${cam.model})는 ${getTeam(conflict.teamId).label}이(가) ` +
          `${formatDateTime(conflict.startAt)} ~ ${formatDateTime(conflict.endAt)} 동안 이미 예약했습니다.\n` +
          `해당 시간과 1분이라도 겹치는 예약은 등록할 수 없습니다.`,
      )
      return
    }

    const reservation: Reservation = {
      id: generateId(),
      teamId,
      cameraId,
      accessories,
      startAt,
      endAt,
      purpose: purpose.trim(),
      status: '대여중',
      createdAt: new Date().toISOString(),
    }
    onSubmit(reservation)
  }

  return (
    <Modal title="장비 예약 등록" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            조 선택
          </label>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map((team) => (
              <button
                key={team.id}
                onClick={() => setTeamId(team.id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  teamId === team.id
                    ? `${team.color} border-transparent text-white`
                    : `${team.softBg} ${team.textColor} ${team.borderColor}`
                }`}
              >
                {team.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            카메라 선택
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CAMERAS.map((cam) => (
              <button
                key={cam.id}
                onClick={() => setCameraId(cam.id)}
                className={`flex flex-col items-start rounded-xl border-2 px-3 py-2 text-left transition ${
                  cameraId === cam.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  <Video size={15} />
                  {cam.label}
                </span>
                <span className="text-xs text-slate-500">{cam.model}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            부속 기자재 (다중 선택)
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ACCESSORIES.map((item) => (
              <label
                key={item}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  accessories.includes(item)
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={accessories.includes(item)}
                  onChange={() => toggleAccessory(item)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                {item}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              시작 일시
            </label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              종료 일시
            </label>
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            촬영 목적
          </label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={2}
            placeholder="예) 캠퍼스 홍보 영상 촬영"
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            예약 등록
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 반납 모달
// ----------------------------------------------------------------------------------

function ReturnModal({
  reservation,
  onClose,
  onConfirm,
}: {
  reservation: Reservation
  onClose: () => void
  onConfirm: (id: string, info: ReturnInfo) => void
}) {
  const [sdCardFormatted, setSdCardFormatted] = useState(false)
  const [batteryCharged, setBatteryCharged] = useState(false)
  const [note, setNote] = useState('')

  const cam = getCamera(reservation.cameraId)

  return (
    <Modal title="장비 반납 처리" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <div className="mb-1 flex items-center gap-2">
            <TeamBadge teamId={reservation.teamId} />
            <span className="text-sm font-semibold text-slate-700">
              {cam.label} ({cam.model})
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {formatDateTime(reservation.startAt)} ~{' '}
            {formatDateTime(reservation.endAt)}
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:border-slate-300">
            <input
              type="checkbox"
              checked={sdCardFormatted}
              onChange={(e) => setSdCardFormatted(e.target.checked)}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            SD카드 포맷 완료
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:border-slate-300">
            <input
              type="checkbox"
              checked={batteryCharged}
              onChange={(e) => setBatteryCharged(e.target.checked)}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            배터리 충전 완료
          </label>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            특이사항 메모
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="예) 렌즈 외관 스크래치 발견"
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() =>
              onConfirm(reservation.id, {
                sdCardFormatted,
                batteryCharged,
                note: note.trim(),
                returnedAt: new Date().toISOString(),
              })
            }
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <CheckCircle2 size={16} />
            반납 처리
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------
// 타임라인 뷰
// ----------------------------------------------------------------------------------

function TimelineView({ reservations }: { reservations: Reservation[] }) {
  const activeReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.status !== '취소됨')
        .sort(
          (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        ),
    [reservations],
  )

  const byCamera = useMemo(() => {
    const map: Record<CameraId, Reservation[]> = { A: [], B: [], C: [] }
    for (const r of activeReservations) {
      map[r.cameraId].push(r)
    }
    return map
  }, [activeReservations])

  if (activeReservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-slate-400">
        <CalendarClock size={36} className="mb-2" />
        <p>등록된 예약이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {CAMERAS.map((cam) => (
        <div key={cam.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Video size={17} className="text-slate-500" />
            <h3 className="font-bold text-slate-800">{cam.label}</h3>
            <span className="text-sm text-slate-400">{cam.model}</span>
          </div>
          {byCamera[cam.id].length === 0 ? (
            <p className="py-3 text-sm text-slate-400">예약 없음</p>
          ) : (
            <div className="space-y-2">
              {byCamera[cam.id].map((r) => {
                const team = getTeam(r.teamId)
                return (
                  <div
                    key={r.id}
                    className={`flex flex-col gap-1 rounded-xl border-l-4 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${team.borderColor} ${team.softBg}`}
                  >
                    <div className="flex items-center gap-2">
                      <TeamBadge teamId={r.teamId} />
                      <span className="text-sm font-medium text-slate-700">
                        {r.purpose}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">
                        {formatDateTime(r.startAt)} ~ {formatDateTime(r.endAt)}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 목록 관리 뷰
// ----------------------------------------------------------------------------------

function ListView({
  reservations,
  onReturn,
  onCancel,
  onDelete,
}: {
  reservations: Reservation[]
  onReturn: (r: Reservation) => void
  onCancel: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [statusFilter, setStatusFilter] = useState<'전체' | ReservationStatus>(
    '전체',
  )
  const [teamFilter, setTeamFilter] = useState<'전체' | TeamId>('전체')

  const filtered = useMemo(() => {
    return reservations
      .filter((r) => statusFilter === '전체' || r.status === statusFilter)
      .filter((r) => teamFilter === '전체' || r.teamId === teamFilter)
      .sort(
        (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
      )
  }, [reservations, statusFilter, teamFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500">상태</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as '전체' | ReservationStatus)
            }
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="전체">전체</option>
            <option value="대여중">대여중</option>
            <option value="반납완료">반납완료</option>
            <option value="취소됨">취소됨</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500">조</span>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value as '전체' | TeamId)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="전체">전체</option>
            {TEAMS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <span className="ml-auto text-xs text-slate-400">
          총 {filtered.length}건
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-slate-400">
          <ListChecks size={36} className="mb-2" />
          <p>조건에 맞는 예약이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const cam = getCamera(r.cameraId)
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TeamBadge teamId={r.teamId} />
                  <span className="flex items-center gap-1 text-sm font-bold text-slate-800">
                    <Video size={14} />
                    {cam.label}
                  </span>
                  <span className="text-xs text-slate-400">{cam.model}</span>
                  <StatusBadge status={r.status} />
                  <div className="ml-auto flex gap-2">
                    {r.status === '대여중' && (
                      <>
                        <button
                          onClick={() => onReturn(r)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <CheckCircle2 size={14} />
                          반납
                        </button>
                        <button
                          onClick={() => onCancel(r.id)}
                          className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                        >
                          <X size={14} />
                          취소
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onDelete(r.id)}
                      className="flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      <Trash2 size={14} />
                      삭제
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-sm text-slate-600">{r.purpose}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDateTime(r.startAt)} ~ {formatDateTime(r.endAt)}
                </p>

                {r.accessories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.accessories.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                {r.returnInfo && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <CheckCircle2
                        size={13}
                        className={
                          r.returnInfo.sdCardFormatted
                            ? 'text-emerald-500'
                            : 'text-slate-300'
                        }
                      />
                      SD카드 포맷
                    </span>
                    <span className="flex items-center gap-1">
                      <Battery
                        size={13}
                        className={
                          r.returnInfo.batteryCharged
                            ? 'text-emerald-500'
                            : 'text-slate-300'
                        }
                      />
                      배터리 충전
                    </span>
                    {r.returnInfo.note && (
                      <span>메모: {r.returnInfo.note}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 메인 App 컴포넌트
// ----------------------------------------------------------------------------------

export default function App() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [tab, setTab] = useState<'timeline' | 'list'>('timeline')
  const [showReservationModal, setShowReservationModal] = useState(false)
  const [returnTarget, setReturnTarget] = useState<Reservation | null>(null)

  useEffect(() => {
    setReservations(loadReservations())
  }, [])

  useEffect(() => {
    if (reservations.length > 0 || localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reservations))
    }
  }, [reservations])

  const availableCameraCount = useMemo(() => {
    const now = Date.now()
    const busy = new Set(
      reservations
        .filter(
          (r) =>
            r.status === '대여중' &&
            new Date(r.startAt).getTime() <= now &&
            new Date(r.endAt).getTime() >= now,
        )
        .map((r) => r.cameraId),
    )
    return CAMERAS.length - busy.size
  }, [reservations])

  function handleAddReservation(reservation: Reservation) {
    setReservations((prev) => [...prev, reservation])
    setShowReservationModal(false)
  }

  function handleReturnConfirm(id: string, info: ReturnInfo) {
    setReservations((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: '반납완료', returnInfo: info } : r,
      ),
    )
    setReturnTarget(null)
  }

  function handleCancel(id: string) {
    if (!confirm('이 예약을 취소하시겠습니까?')) return
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: '취소됨' } : r)),
    )
  }

  function handleDelete(id: string) {
    if (!confirm('이 예약 기록을 완전히 삭제하시겠습니까?')) return
    setReservations((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-indigo-600 p-2 text-white">
              <Camera size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-slate-800">
                영상 촬영 장비 예약 관리
              </h1>
              <p className="text-xs text-slate-400">
                지금 대여 가능 카메라 {availableCameraCount} / {CAMERAS.length}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowReservationModal(true)}
            className="ml-auto flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus size={17} />
            새 예약 등록
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5 flex gap-2 rounded-xl bg-white p-1.5 shadow-sm">
          <button
            onClick={() => setTab('timeline')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
              tab === 'timeline'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <CalendarClock size={16} />
            타임라인 뷰
          </button>
          <button
            onClick={() => setTab('list')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
              tab === 'list'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <ListChecks size={16} />
            목록 관리 뷰
          </button>
        </div>

        {tab === 'timeline' ? (
          <TimelineView reservations={reservations} />
        ) : (
          <ListView
            reservations={reservations}
            onReturn={(r) => setReturnTarget(r)}
            onCancel={handleCancel}
            onDelete={handleDelete}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <span className="flex items-center justify-center gap-1">
          <Mic size={12} />
          <Lightbulb size={12} />
          모든 데이터는 브라우저 localStorage에 저장됩니다.
        </span>
      </footer>

      {showReservationModal && (
        <ReservationModal
          reservations={reservations}
          onClose={() => setShowReservationModal(false)}
          onSubmit={handleAddReservation}
        />
      )}

      {returnTarget && (
        <ReturnModal
          reservation={returnTarget}
          onClose={() => setReturnTarget(null)}
          onConfirm={handleReturnConfirm}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------------
// 공용 도메인 타입 & 기본값 (App.tsx / cloudSync.ts 공유)
// ----------------------------------------------------------------------------------

export type TeamId = '1조' | '2조' | '3조' | '4조' | '5조'
export type CameraId = string
export type AccessoryId = string
export type ReservationStatus = '대여중' | '반납완료' | '취소됨'

export interface CameraInfo {
  id: CameraId
  label: string
  model: string
}

export interface AccessoryItem {
  id: AccessoryId
  category: string
  label: string
}

export interface Reservation {
  id: string
  teamId: TeamId
  cameraIds: CameraId[]
  accessories: AccessoryId[]
  isBroadcast: boolean
  startAt: string
  endAt: string
  purpose: string
  status: ReservationStatus
  createdAt: string
  returnedAt?: string
}

// 과거 버전(카메라 1대만 예약 가능)은 localStorage에 단일 문자열 cameraId로 저장했다.
// 이미 저장된 예약 데이터를 잃지 않도록 로드 시점에 배열 형태(cameraIds)로 정규화한다.
export function normalizeReservation(
  raw: Reservation & { cameraId?: CameraId },
): Reservation {
  const cameraIds =
    Array.isArray(raw.cameraIds) && raw.cameraIds.length > 0
      ? raw.cameraIds
      : raw.cameraId
        ? [raw.cameraId]
        : []
  return {
    id: raw.id,
    teamId: raw.teamId,
    cameraIds,
    accessories: raw.accessories ?? [],
    isBroadcast: raw.isBroadcast,
    startAt: raw.startAt,
    endAt: raw.endAt,
    purpose: raw.purpose,
    status: raw.status,
    createdAt: raw.createdAt,
    returnedAt: raw.returnedAt,
  }
}

export const TEAM_IDS: TeamId[] = ['1조', '2조', '3조', '4조', '5조']

export const DEFAULT_CAMERAS: CameraInfo[] = [
  { id: 'A', label: 'Camera A', model: 'Sony FX3' },
  { id: 'B', label: 'Camera B', model: 'Canon R6 Mark II' },
  { id: 'C', label: 'Camera C', model: 'Lumix S5II' },
]

export const DEFAULT_TEAM_NAMES: Record<TeamId, string> = {
  '1조': '1조',
  '2조': '2조',
  '3조': '3조',
  '4조': '4조',
  '5조': '5조',
}

export const DEFAULT_ACCESSORIES: AccessoryItem[] = [
  { id: 'sd-01', category: 'SD카드', label: 'SD-01' },
  { id: 'sd-02', category: 'SD카드', label: 'SD-02' },
  { id: 'bat-01', category: '배터리', label: 'BAT-01' },
  { id: 'bat-02', category: '배터리', label: 'BAT-02' },
  { id: 'mic-1', category: '무선 마이크', label: 'MIC-1' },
  { id: 'tri-01', category: '삼각대', label: 'TRI-01' },
]

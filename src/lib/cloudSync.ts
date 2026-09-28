import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  DEFAULT_ACCESSORIES,
  DEFAULT_CAMERAS,
  DEFAULT_TEAM_NAMES,
  TEAM_IDS,
  type AccessoryItem,
  type CameraInfo,
  type Reservation,
  type TeamId,
} from './types'

// ----------------------------------------------------------------------------------
// DB row <-> 앱 모델 매핑
// ----------------------------------------------------------------------------------

interface ReservationRow {
  id: string
  team_id: TeamId
  camera_id: string
  accessories: string[] | null
  is_broadcast: boolean
  start_at: string
  end_at: string
  purpose: string
  status: Reservation['status']
  created_at: string
  returned_at: string | null
}

// 카메라 다중 선택 기능 이전에는 camera_id 컬럼에 단일 문자열만 저장했다.
// DB 스키마 변경 없이 하위 호환을 유지하기 위해 카메라가 2대 이상이면 이 컬럼에
// JSON 배열 문자열을 저장하고, 1대뿐이면 기존과 완전히 동일하게 평범한 문자열로 저장한다.
function encodeCameraIds(cameraIds: string[]): string {
  if (cameraIds.length <= 1) return cameraIds[0] ?? ''
  return JSON.stringify(cameraIds)
}

function decodeCameraIds(value: string): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    // JSON으로 파싱되지 않으면 과거 방식대로 저장된 단일 카메라 id 문자열이다.
  }
  return [value]
}

function rowToReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    teamId: row.team_id,
    cameraIds: decodeCameraIds(row.camera_id),
    accessories: row.accessories ?? [],
    isBroadcast: row.is_broadcast,
    startAt: row.start_at,
    endAt: row.end_at,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    returnedAt: row.returned_at ?? undefined,
  }
}

function reservationToRow(r: Reservation): ReservationRow {
  return {
    id: r.id,
    team_id: r.teamId,
    camera_id: encodeCameraIds(r.cameraIds),
    accessories: r.accessories,
    is_broadcast: r.isBroadcast,
    start_at: r.startAt,
    end_at: r.endAt,
    purpose: r.purpose,
    status: r.status,
    created_at: r.createdAt,
    returned_at: r.returnedAt ?? null,
  }
}

interface TeamNameRow {
  id: TeamId
  name: string
}

// ----------------------------------------------------------------------------------
// 초기 데이터 로드 (+ 빈 테이블이면 기본값으로 시드)
// ----------------------------------------------------------------------------------

export interface CloudBootstrapResult {
  reservations: Reservation[]
  cameras: CameraInfo[]
  accessories: AccessoryItem[]
  teamNames: Record<TeamId, string>
}

export async function fetchAllCloudData(): Promise<CloudBootstrapResult> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')

  const [reservationsRes, camerasRes, accessoriesRes, teamNamesRes] = await Promise.all([
    supabase.from('reservations').select('*'),
    supabase.from('cameras').select('*'),
    supabase.from('accessories').select('*'),
    supabase.from('team_names').select('*'),
  ])

  if (reservationsRes.error) throw reservationsRes.error
  if (camerasRes.error) throw camerasRes.error
  if (accessoriesRes.error) throw accessoriesRes.error
  if (teamNamesRes.error) throw teamNamesRes.error

  const reservations = (reservationsRes.data as ReservationRow[]).map(rowToReservation)

  let cameras = camerasRes.data as CameraInfo[]
  if (cameras.length === 0) {
    await supabase.from('cameras').upsert(DEFAULT_CAMERAS)
    cameras = DEFAULT_CAMERAS
  }

  let accessories = accessoriesRes.data as AccessoryItem[]
  if (accessories.length === 0) {
    await supabase.from('accessories').upsert(DEFAULT_ACCESSORIES)
    accessories = DEFAULT_ACCESSORIES
  }

  const teamNameRows = teamNamesRes.data as TeamNameRow[]
  const teamNames: Record<TeamId, string> = { ...DEFAULT_TEAM_NAMES }
  if (teamNameRows.length === 0) {
    await supabase
      .from('team_names')
      .upsert(TEAM_IDS.map((id) => ({ id, name: DEFAULT_TEAM_NAMES[id] })))
  } else {
    for (const row of teamNameRows) teamNames[row.id] = row.name
  }

  return { reservations, cameras, accessories, teamNames }
}

// ----------------------------------------------------------------------------------
// 실시간 구독
// ----------------------------------------------------------------------------------

export interface CloudChangeHandlers {
  onReservationChange: (
    payload: RealtimePostgresChangesPayload<ReservationRow>,
  ) => void
  onCameraChange: (payload: RealtimePostgresChangesPayload<CameraInfo>) => void
  onAccessoryChange: (payload: RealtimePostgresChangesPayload<AccessoryItem>) => void
  onTeamNameChange: (payload: RealtimePostgresChangesPayload<TeamNameRow>) => void
}

export function subscribeToCloudChanges(handlers: CloudChangeHandlers): () => void {
  const client = supabase
  if (!client) return () => {}

  const channel = client
    .channel('camera-app-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reservations' },
      handlers.onReservationChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cameras' },
      handlers.onCameraChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'accessories' },
      handlers.onAccessoryChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_names' },
      handlers.onTeamNameChange,
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}

export { rowToReservation }
export type { ReservationRow, TeamNameRow }

// ----------------------------------------------------------------------------------
// 쓰기 (upsert / delete) - 실패해도 throw하지 않고 콘솔에만 기록한다.
// 호출부(App.tsx)는 이미 로컬 상태 + localStorage에 반영한 뒤 이 함수들을 fire-and-forget으로 호출한다.
// ----------------------------------------------------------------------------------

export async function persistReservation(reservation: Reservation): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('reservations').upsert(reservationToRow(reservation))
  if (error) console.error('[cloudSync] 예약 저장 실패:', error.message)
}

export async function deleteReservationRemote(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('reservations').delete().eq('id', id)
  if (error) console.error('[cloudSync] 예약 삭제 실패:', error.message)
}

export async function persistCamera(camera: CameraInfo): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('cameras').upsert(camera)
  if (error) console.error('[cloudSync] 카메라 저장 실패:', error.message)
}

export async function deleteCameraRemote(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('cameras').delete().eq('id', id)
  if (error) console.error('[cloudSync] 카메라 삭제 실패:', error.message)
}

export async function persistAccessory(item: AccessoryItem): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('accessories').upsert(item)
  if (error) console.error('[cloudSync] 부가 장비 저장 실패:', error.message)
}

export async function deleteAccessoryRemote(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('accessories').delete().eq('id', id)
  if (error) console.error('[cloudSync] 부가 장비 삭제 실패:', error.message)
}

export async function persistTeamName(id: TeamId, name: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('team_names').upsert({ id, name })
  if (error) console.error('[cloudSync] 조 이름 저장 실패:', error.message)
}

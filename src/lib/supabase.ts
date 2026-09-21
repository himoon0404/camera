import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// .env 값 끝에 실수로 붙은 공백/개행이 URL 파싱을 깨뜨리지 않도록 항상 trim한다.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

function looksConfigured(value: string | undefined): value is string {
  return !!value && value.length > 0 && !value.includes('여기에_')
}

// .env가 비어있거나 플레이스홀더 그대로면 클라우드 동기화를 건너뛰고
// App.tsx가 localStorage 전용 모드로 동작하도록 null을 내려준다.
export const supabase: SupabaseClient | null =
  looksConfigured(supabaseUrl) && looksConfigured(supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      })
    : null

export const isSupabaseConfigured = supabase !== null

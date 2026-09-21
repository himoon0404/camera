# 영상 촬영 장비 예약 및 스케줄 관리 웹 애플리케이션

**Vite + React (TypeScript) + Tailwind CSS**로 만든 촬영 장비 예약 관리 앱입니다. Toss 스타일 UI를 사용하며, Supabase를 통해 모든 사용자가 실시간으로 같은 예약/장비 데이터를 공유합니다. Supabase가 설정되지 않았거나 연결에 실패하면 브라우저 **localStorage**로 자동 폴백해 오프라인에서도 동작합니다.

## 주요 기능

- **참여 팀**: 1조 ~ 5조, 조별 고유 파스텔 테마 컬러, 커스텀 팀명 지정 가능
- **내 조 선택**: 상단에서 내 조를 선택하면(localStorage 저장) 다른 조의 예약은 수정/취소/반납할 수 없음 (관리자 모드는 예외)
- **장비**: 카메라 3대(Sony FX3 · Canon R6 Mark II · Lumix S5II) + 라벨 번호 단위로 관리되는 부가 장비(SD카드, 배터리, 마이크, 삼각대 등), 품목별 아코디언 UI
- **예약 등록/변경**: 카메라·부가장비 중복 예약 차단, 방송국 단독 사용 시간대 충돌 차단
- **반납 워크플로우**: 배터리 충전 완료 + 장비 정리 완료 2가지를 모두 체크해야 반납 완료 가능
- **관리자 모드**: 비밀번호(`9126`)로 카메라/부가장비 추가·삭제
- **실시간 동기화**: Supabase 연동 시 여러 브라우저에서 동시에 같은 데이터를 보고 즉시 반영됨

## 1. 로컬 개발 환경 세팅

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/camera/` 접속하면 확인할 수 있습니다.

### 프로젝트 구성

- `src/App.tsx` — UI 전체(탭 화면, 모달, 컨텍스트)가 담긴 메인 컴포넌트
- `src/lib/types.ts` — 도메인 타입 및 기본 시드 데이터
- `src/lib/supabase.ts` — Supabase 클라이언트 생성 (`.env` 미설정 시 `null`)
- `src/lib/cloudSync.ts` — Supabase fetch/upsert/실시간 구독 로직
- `src/index.css` — Tailwind CSS v4 진입점
- `vite.config.ts` — `@tailwindcss/vite` 플러그인 + GitHub Pages용 `base` 경로 설정

## 2. Supabase 연동 (선택 사항, 실시간 공유가 필요할 때)

### 2-1. 프로젝트 생성 및 키 발급

[supabase.com](https://supabase.com)에서 새 프로젝트를 만들고, **Project Settings → API**에서 Project URL과 anon(public) key를 확인합니다.

### 2-2. 환경변수 설정

루트에 `.env` 파일을 만들고 (`.env.example` 참고, 이 파일은 git에 커밋되지 않습니다):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=발급받은_anon_key
```

### 2-3. 테이블 및 RLS 정책 생성

Supabase **SQL Editor**에서 실행:

```sql
create table if not exists reservations (
  id text primary key,
  team_id text not null,
  camera_id text not null,
  accessories jsonb not null default '[]',
  is_broadcast boolean not null default false,
  start_at text not null,
  end_at text not null,
  purpose text not null default '',
  status text not null default '대여중',
  created_at text not null,
  returned_at text
);

create table if not exists cameras (
  id text primary key,
  label text not null,
  model text not null
);

create table if not exists accessories (
  id text primary key,
  category text not null,
  label text not null
);

create table if not exists team_names (
  id text primary key,
  name text not null
);

alter table reservations replica identity full;
alter table cameras replica identity full;
alter table accessories replica identity full;
alter table team_names replica identity full;

alter publication supabase_realtime add table reservations, cameras, accessories, team_names;

-- 로그인 시스템이 없는 앱이므로 anon 권한에 전체 읽기/쓰기를 허용합니다.
alter table reservations enable row level security;
alter table cameras enable row level security;
alter table accessories enable row level security;
alter table team_names enable row level security;

create policy "public full access" on reservations for all to public using (true) with check (true);
create policy "public full access" on cameras for all to public using (true) with check (true);
create policy "public full access" on accessories for all to public using (true) with check (true);
create policy "public full access" on team_names for all to public using (true) with check (true);
```

RLS 정책을 빠뜨리면 조회는 되지만(빈 결과) 쓰기 시 `42501`/401 오류가 발생합니다.

## 3. GitHub Pages 배포

### 3-1. base 경로 확인

저장소 이름이 `camera`가 아니라면 `vite.config.ts`의 `base`와 `package.json`의 `homepage`를 실제 저장소 이름에 맞게 수정하세요.

### 3-2. 배포 명령어

```bash
git push origin main
npm run deploy
```

`npm run deploy`는 `predeploy` 단계에서 `npm run build`를 실행한 뒤 `gh-pages` 패키지로 `dist` 폴더를 `gh-pages` 브랜치에 배포합니다. **배포는 정적 프론트엔드 코드만 교체하며 Supabase에 저장된 데이터에는 영향을 주지 않습니다.**

`.env`는 커밋되지 않으므로, 배포 전 로컬에 실제 Supabase 값이 채워진 `.env`가 있어야 빌드 결과물에 반영됩니다.

## 기술 스택

| 항목 | 내용 |
| --- | --- |
| 빌드 도구 | Vite |
| 프레임워크 | React 19 + TypeScript |
| 스타일 | Tailwind CSS v4 (`@tailwindcss/vite`), Toss 스타일 디자인 |
| 아이콘 | lucide-react |
| 배포 | gh-pages (GitHub Pages) |
| 데이터 저장 | Supabase (PostgreSQL + Realtime), 미설정/연결 실패 시 브라우저 localStorage로 자동 폴백 |

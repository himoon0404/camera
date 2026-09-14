# 영상 촬영 장비 예약 및 스케줄 관리 웹 애플리케이션

외부 백엔드/DB 없이 **Vite + React (TypeScript) + Tailwind CSS**만으로 만든 촬영 장비 예약 관리 앱입니다. 모든 데이터는 브라우저 **localStorage**에 저장되며, GitHub Pages로 무료 배포할 수 있습니다.

## 주요 기능

- **참여 팀**: 1조 ~ 5조, 조별 고유 테마 컬러 (1조 Blue · 2조 Emerald · 3조 Amber · 4조 Purple · 5조 Rose)
- **장비**: Camera A (Sony FX3) · Camera B (Canon R6 Mark II) · Camera C (Lumix S5II)
- **부속 기자재**: 무선 마이크 세트, 삼각대, 추가 배터리(2구), LED 지속광 조명, 샷건 마이크
- **중복 예약 차단**: 동일 카메라의 대여 시간이 기존 예약과 1분이라도 겹치면 경고 후 등록 차단
- **반납 워크플로우**: SD카드 포맷 완료 / 배터리 충전 여부 / 특이사항 메모 체크 후 원클릭 반납 처리
- **뷰 전환**: 타임라인 뷰(카메라·조별 색상 라벨) / 목록 관리 뷰(상태·조 필터링, 취소·삭제)
- **데이터 유지**: localStorage 연동, 새로고침해도 데이터 유지, 최초 실행 시 더미 예약 4건 자동 세팅

## 1. 로컬 개발 환경 세팅

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속하면 바로 확인할 수 있습니다.

### 프로젝트 구성

- `src/App.tsx` — 전체 기능이 담긴 단일 파일 컴포넌트 (타입, 모달, 탭 화면 포함)
- `src/index.css` — Tailwind CSS v4 진입점 (`@import "tailwindcss";`)
- `vite.config.ts` — `@tailwindcss/vite` 플러그인 + GitHub Pages용 `base` 경로 설정

## 2. GitHub Pages 배포

### 2-1. base 경로 확인

`vite.config.ts`와 `package.json`의 `homepage` 값은 저장소 이름이 `camera`라고 가정하고 `/camera/`로 설정되어 있습니다. 저장소 이름이 다르다면 두 곳을 실제 저장소 이름에 맞게 수정하세요.

```ts
// vite.config.ts
export default defineConfig({
  base: '/저장소이름/',
  ...
})
```

```json
// package.json
"homepage": "https://<GitHub 사용자명>.github.io/저장소이름/"
```

### 2-2. 배포 명령어

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/himoon/camera.git
git push -u origin main

npm run deploy
```

`npm run deploy`는 `predeploy` 단계에서 자동으로 `npm run build`를 실행한 뒤, `gh-pages` 패키지를 이용해 `dist` 폴더를 `gh-pages` 브랜치로 배포합니다.

배포 후 GitHub 저장소 **Settings → Pages**에서 Source가 `gh-pages` 브랜치로 지정되어 있는지 확인하세요. 몇 분 뒤 `https://<사용자명>.github.io/<저장소이름>/`에서 접속할 수 있습니다.

## 기술 스택

| 항목 | 내용 |
| --- | --- |
| 빌드 도구 | Vite |
| 프레임워크 | React 19 + TypeScript |
| 스타일 | Tailwind CSS v4 (`@tailwindcss/vite`) |
| 아이콘 | lucide-react |
| 배포 | gh-pages (GitHub Pages) |
| 데이터 저장 | 브라우저 localStorage (백엔드/DB 없음) |

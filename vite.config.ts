import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// GitHub Pages 배포 시 저장소 이름에 맞춰 base 값을 수정하세요.
// 예: https://<username>.github.io/camera/ 로 배포한다면 '/camera/'
export default defineConfig({
  base: '/camera/',
  plugins: [react(), tailwindcss()],
})

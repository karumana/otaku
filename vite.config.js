import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 배포 시 레포지토리 이름을 base에 입력하세요.
// 예: 레포 이름이 'memebox' 이면 '/memebox/'
// 커스텀 도메인 사용 시 '/' 로 변경
export default defineConfig({
  plugins: [react()],
  base: '/otaku/',
})

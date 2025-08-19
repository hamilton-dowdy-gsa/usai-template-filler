import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/usai': {
        target: 'https://api.prod.gsai.mcaas.fcs.gsa.gov',
        changeOrigin: true,
        secure: true,
        // /usai/...  ->  /api/v1/...
        rewrite: (path) => path.replace(/^\/usai/, '/api/v1'),
      },
    },
  },
})




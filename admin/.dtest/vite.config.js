import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
const admin = path.resolve(__dirname, '..')
export default defineConfig({
  root: __dirname, plugins: [react()], css: { postcss: admin },
  resolve: { alias: [
    { find: /^@\/lib\/api$/, replacement: path.resolve(__dirname, 'mockApi.js') },
    { find: '@shared', replacement: path.resolve(admin, '../shared') },
    { find: '@', replacement: path.resolve(admin, 'src') },
  ] },
  server: { port: 5199, fs: { allow: [path.resolve(admin, '..')] } },
})

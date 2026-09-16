import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径，构建产物可在本机浏览器直接打开
export default defineConfig({
  plugins: [react()],
  base: './',
});

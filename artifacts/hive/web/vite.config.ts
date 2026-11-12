import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep the large grid and chart libraries in their own cacheable files.
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes('ag-studio') || id.includes('ag-grid-enterprise') || id.includes('ag-charts-enterprise') || id.includes('node_modules/ag-stack') ? 'ag-studio' : id.includes('ag-grid') ? 'ag-grid' : id.includes('ag-charts') ? 'ag-charts' : id.includes('node_modules') ? 'vendor' : undefined) } },
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});

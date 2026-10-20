import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

/**
 * Декодери JPEG 2000 і JBIG2 для PDF.js у JS-варіанті: WebAssembly потребував би 'wasm-unsafe-eval' у CSP.
 * PDF.js імпортує їх сам із /pdfjs/ (у dev — прямо з node_modules).
 */
function pdfjsDecoders(): Plugin {
  const dir = join(import.meta.dirname, 'node_modules', 'pdfjs-dist', 'wasm')
  return {
    name: 'pdfjs-decoders',
    generateBundle() {
      for (const file of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js'])
        this.emitFile({ type: 'asset', fileName: `pdfjs/${file}`, source: readFileSync(join(dir, file)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsDecoders()],
  build: { chunkSizeWarningLimit: 1500 },
})

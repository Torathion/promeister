import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['./src/index.ts'],
    format: ['esm', 'cjs'],
    dts: false,
    minify: true,
    platform: 'node',
    target: 'es2022',
    clean: true,
    outDir: 'dist',
    outputOptions: {
      exports: 'named'
    }
  }
])

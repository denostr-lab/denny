import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasm } from '@rollup/plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import inject from '@rollup/plugin-inject';
import { svgLoader } from './viteSvgLoader';

const copyFiles = {
  targets: [
    {
      src: 'node_modules/@matrix-org/olm/olm.wasm',
      dest: '',
    },
    {
      src: '_redirects',
      dest: '',
    },
    {
      src: 'config.json',
      dest: '',
    },
    {
      src: 'public/res/android',
      dest: 'public/',
    }
  ],
}

export default defineConfig({
  appType: 'spa',
  publicDir: false,
  base: "",
  server: {
    port: 8081,
    host: true,
  },
  plugins: [
    viteStaticCopy(copyFiles),
    svgLoader(),
    wasm(),
    react(),
    {
      name: "singleHMR",
      handleHotUpdate({ modules }) {
        modules.map((m) => {
          m.importedModules = new Set();
          m.importers = new Set();
        });

        return modules;
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      },
      plugins: [
        // Enable esbuild polyfill plugins
        NodeGlobalsPolyfillPlugin({
          process: false,
          buffer: true,
        }),
      ]
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    copyPublicDir: false,
    rollupOptions: {
      plugins: [
        inject({ Buffer: ['buffer', 'Buffer'] })
      ]
    }
  },
});

/** Emscripten build of piper-phonemize (eSpeak NG) from @diffusionstudio/piper-wasm. */
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PiperPhonemizeModule {
    callMain(args: string[]): number;
  }
  interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (path: string, prefix: string) => string;
    /** Already-fetched files, so a fresh instance starts without downloading anything. */
    wasmBinary?: ArrayBuffer;
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  }
  const createPiperPhonemize: (opts?: PiperPhonemizeOptions) => Promise<PiperPhonemizeModule>;
  export default createPiperPhonemize;
}

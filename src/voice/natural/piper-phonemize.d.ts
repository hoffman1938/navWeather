/** Emscripten build of piper-phonemize (eSpeak NG) from @diffusionstudio/piper-wasm. */
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PiperPhonemizeModule {
    callMain(args: string[]): number;
  }
  interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (path: string, prefix: string) => string;
  }
  const createPiperPhonemize: (opts?: PiperPhonemizeOptions) => Promise<PiperPhonemizeModule>;
  export default createPiperPhonemize;
}

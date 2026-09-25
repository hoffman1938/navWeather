export type MapTheme = 'light' | 'dark';

/** Basemap source. Swap for a commercial provider without touching the map UI. */
export interface MapProvider {
  readonly name: string;
  getStyleUrl(theme: MapTheme): string;
}

export class StyleUrlMapProvider implements MapProvider {
  constructor(
    readonly name: string,
    private light: string,
    private dark: string,
  ) {}

  getStyleUrl(theme: MapTheme): string {
    return theme === 'dark' ? this.dark : this.light;
  }
}

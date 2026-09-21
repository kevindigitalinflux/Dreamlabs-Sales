declare module 'threejs-components/build/cursors/tubes1.min.js' {
  interface TubesLightsOptions {
    intensity?: number;
    colors?: string[];
  }

  interface TubesCursorOptions {
    tubes?: {
      colors?: string[];
      lights?: TubesLightsOptions;
    };
  }

  interface TubesApp {
    tubes: {
      setColors: (colors: string[]) => void;
      setLightsColors: (colors: string[]) => void;
    };
    dispose: () => void;
  }

  export default function TubesCursor(canvas: HTMLCanvasElement, options?: TubesCursorOptions): TubesApp;
}

export const defaults: {
 bevelRatio:number; width:number; sideWidth:number; heightRatio:number; normalStep:number;
 ior:number; travel:number; sideTravel:number; faceScale:number; rimStrength:number;
 sideRim:number; rimRange:number; dispersion:number; rimDispersion:number;
 thicknessGain:number; curveGain:number; spectralGain:number; blur:number;
};
export type OpticalSettings=Partial<typeof defaults>;
export function renderFilter(filter:SVGFilterElement,w:number,h:number,r:number,settings?:OpticalSettings,options?:{resolution?:number;bands?:3|8;gain?:number}):void;
export function renderContour(canvas:HTMLCanvasElement,w:number,h:number,r:number,options?:{width?:number;retreat?:number;resolution?:number}):void;

import { LIQUID_MATERIAL_CORE } from '../../../../app/shared/visual-design/liquid-material-source';
import { header, footer } from '../webgl/material';
export const materialFragment = header + LIQUID_MATERIAL_CORE.replace(/uniform (?:vec2|float) (?:size|radius|bevel|refractionWidth|pixelScale|padding);/g, '') + footer;
